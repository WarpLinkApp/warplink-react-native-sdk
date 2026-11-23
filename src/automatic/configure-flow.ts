import NativeWarpLink from '../NativeWarpLink';
import { mapNativeError } from '../native-error';
import { ErrorCodes, WarpLinkError, type WarpLinkConfig } from '../types';
import { abandonSession, beginSession, currentSink, isCurrentGeneration } from './auto-session';
import { clearStamp } from './dedupe-stamp';
import { dispatchDeferredLink, retryDeferredLink } from './deferred-link';
import {
  configureSignature,
  forgetLiveConfigure,
  joinLiveConfigure,
  liveConfigureFor,
  ownRun,
  recordDeferredRun,
  recordLiveConfigure,
} from './live-configure';
import { dispatchColdStartLink } from './launch-link';
import { subscribeUrlHandler } from './native-subscription';
import { autoDispatchUrl } from './auto-dispatch';
import { claimAutoTap } from './tap-ledger';
import { tetherReadModeWire } from '../tether/read-mode';

const API_KEY_PATTERN = /^wl_(live|test)_[a-zA-Z0-9]{32}$/;
const TEST_KEY_PREFIX = 'wl_test_';

let autoWarmUnsub: (() => void) | null = null;

function teardownAutoWiring(): void {
  if (autoWarmUnsub) {
    autoWarmUnsub();
    autoWarmUnsub = null;
  }
  // Abandons any in-flight dispatch for the same reason configure() does: its
  // result belongs to a configuration that no longer exists. The tap counters
  // are deliberately NOT reset: a tap still in flight across a reconfigure must
  // never share a number with a new one.
  abandonSession();
  clearStamp();
}

function buildNativeConfig(options: WarpLinkConfig): Record<string, unknown> {
  const config: Record<string, unknown> = {
    apiKey: options.apiKey,
  };
  if (options.apiEndpoint !== undefined) {
    config['apiEndpoint'] = options.apiEndpoint;
  }
  if (options.debugLogging !== undefined) {
    config['debugLogging'] = options.debugLogging;
  }
  // Forwarded verbatim, deliberately. Normalizing here would make a third
  // dialect that can drift from the two native ones, and the native SDKs have
  // to normalize anyway for the domains declared in Info.plist / the Android
  // manifest, which never pass through JavaScript.
  if (options.linkDomains !== undefined) {
    config['linkDomains'] = options.linkDomains;
  }
  // Sent only when the host chose a mode, like every other optional field. The
  // native default is the paste button, so omitting it changes nothing. A value
  // that is not a mode is sent as the paste button, never as a read.
  if (options.tetherReadMode !== undefined) {
    config['tetherReadMode'] = tetherReadModeWire(options.tetherReadMode);
  }
  // matchWindowHours is intentionally NOT forwarded: the match window is
  // server-side (per link in the dashboard) and the native SDKs no longer
  // accept the option. The deprecated config field is kept as a no-op so
  // existing integrations keep compiling.
  return config;
}

function reportInvalidKey(options: WarpLinkConfig): void {
  const error = new WarpLinkError(
    ErrorCodes.E_INVALID_API_KEY_FORMAT,
    'Invalid API key format. Expected: wl_live_xxx or wl_test_xxx (32 alphanumeric characters after prefix)'
  );
  // Report and return, matching iOS and Android. A bad key is a setup mistake,
  // and crashing the host app over it is worse than leaving the SDK
  // unconfigured and saying so. Always logged, so a host with no onLink still
  // sees it.
  console.warn(`[WarpLink] ${error.message}`);
  options.onLink?.({ error });
}

/**
 * Configures the native module. Resolves true when the rest of the launch is to
 * go ahead. A failure goes to the sink when auto-wiring is on, and otherwise
 * rejects so an awaiting caller sees it: never a bare unhandled rejection.
 */
async function configureNative(
  config: Record<string, unknown>,
  generation: number
): Promise<boolean> {
  try {
    await NativeWarpLink.configure(config);
    return true;
  } catch (error) {
    forgetLiveConfigure(generation);
    const err = mapNativeError(error);
    const sink = currentSink(generation);
    if (sink) {
      sink({ error: err });
      return false;
    }
    // Superseded mid-flight: a later configure() owns the SDK now, so this
    // failure is not the caller's to act on and must not reach the new sink.
    if (!isCurrentGeneration(generation)) {
      return false;
    }
    throw err;
  }
}

async function finishConfigure(
  config: Record<string, unknown>,
  wantDeepLinks: boolean,
  wantDeferred: boolean,
  generation: number,
  coldTap: number | null
): Promise<void> {
  if (!(await configureNative(config, generation))) {
    return;
  }
  try {
    if (wantDeepLinks && coldTap !== null && currentSink(generation)) {
      await dispatchColdStartLink(generation, coldTap);
    }
  } finally {
    // The deferred check runs even when the cold-start host callback threw
    // (routine in React Native when the navigation container is not mounted
    // yet). Skipping it would mean no attribution request for this launch.
    // A throw from the deferred dispatch's own host callback still
    // propagates; when both throw it is the one configure() rejects with.
    if (wantDeferred && isCurrentGeneration(generation)) {
      // With a sink, await so a host callback throw still rejects configure().
      // Without one there is nothing to deliver, so fire and forget. Awaiting
      // would block configure() on a full attribution round trip.
      if (currentSink(generation)) {
        await dispatchDeferredLink(generation);
      } else {
        recordDeferredRun(generation, dispatchDeferredLink(generation));
      }
    }
  }
}

/** The body of `WarpLink.configure`: see its documentation. */
export function configureSdk(options: WarpLinkConfig): Promise<void> {
  if (!options.apiKey || !API_KEY_PATTERN.test(options.apiKey)) {
    reportInvalidKey(options);
    return Promise.resolve();
  }

  const config = buildNativeConfig(options);
  const wantDeepLinks = options.onLink != null && options.automaticDeepLinks !== false;
  const wantDeferred = options.automaticDeferredDeepLinks !== false;

  // The same key and options again is the session already running.
  const signature = configureSignature(config, wantDeepLinks, wantDeferred);
  const running = liveConfigureFor(signature);
  if (running) {
    return joinLiveConfigure(running, options.onLink, wantDeferred ? retryDeferredLink : null);
  }

  // Reset any prior auto-wiring so reconfiguration is clean.
  teardownAutoWiring();

  // Claim a generation BEFORE any await: everything this call starts is
  // tagged with it, and a later configure() invalidates the lot.
  const generation = beginSession(options.onLink ?? null, {
    testKey: options.apiKey.startsWith(TEST_KEY_PREFIX),
    restartDeferred: wantDeferred,
  });

  // Register the warm-start listener synchronously so events that arrive
  // during/after native configuration are captured.
  if (wantDeepLinks) {
    autoWarmUnsub = subscribeUrlHandler(autoDispatchUrl);
  }

  // The launch url arrived before anything this configure() will hear, so its
  // tap is claimed now, ahead of any warm tap made while the native side
  // configures. Claimed after that await it would be numbered behind such a tap
  // and could silence the tap the user made last. Claimed with no url yet, let
  // alone a classification of one: the launch link records the tap as unused
  // when the url turns out to be foreign, or a duplicate of a warm arrival.
  const coldTap = wantDeepLinks ? claimAutoTap() : null;

  const settled = finishConfigure(config, wantDeepLinks, wantDeferred, generation, coldTap);
  recordLiveConfigure(signature, generation, settled);
  return ownRun(settled);
}
