import NativeWarpLink from './NativeWarpLink';
import {
  ErrorCodes,
  WarpLinkError,
  type WarpLinkConfig,
  type WarpLinkDeepLink,
  type AttributionResult,
  type DeepLinkListener,
} from './types';
import { mapNativeError } from './native-error';
import { claimReferral, redeemInvitation } from './referral/referral-calls';
import type { ReferralClaimResult } from './referral/referral-types';
import {
  deserializeAttributionResult,
  deserializeDeepLink,
} from './deserialize';
import { deliverResolved } from './automatic/auto-event';
import { classifyUrl } from './automatic/classify-url';
import { configureSdk } from './automatic/configure-flow';
import { subscribeUrlHandler } from './automatic/native-subscription';
import { resolveClaimed } from './automatic/resolve-claimed';
import { resolveOnce } from './automatic/resolve-once';
import { claimAutoTap } from './automatic/tap-ledger';

export const WarpLink = {
  /**
   * Initialize the SDK. With a bare `configure({ apiKey, onLink })`,
   * cold-start, warm-start, and deferred deep links are all wired
   * automatically and funneled into `onLink`. Disable any piece with
   * `automaticDeepLinks: false` / `automaticDeferredDeepLinks: false`,
   * or omit `onLink` to wire the deep link callbacks yourself.
   *
   * Omitting `onLink` does not switch off install attribution: the deferred
   * check still fires, because that request is what attributes the install.
   * Use `automaticDeferredDeepLinks: false` to switch it off.
   *
   * The API key format is validated synchronously — an invalid key
   * reports a `WarpLinkError` (`E_INVALID_API_KEY_FORMAT`) through `onLink`
   * and leaves the SDK unconfigured, before any
   * async work starts. Native/server configuration happens
   * asynchronously; the returned promise resolves once configuration
   * (and any auto cold-start + deferred dispatch into `onLink`) completes.
   * When a newer tap arrives while the launch link is still resolving, it
   * also waits for that tap's answer, which decides whether the launch link
   * is still the one to deliver.
   * With no `onLink` there is nothing to dispatch, so the deferred check
   * runs in the background and the promise does not wait on it.
   *
   * Native configuration errors are delivered to `onLink` as an
   * `{ error }` event when auto-wiring is on, or reject the returned
   * promise when `onLink` is not provided.
   *
   * An exception thrown by your own `onLink` is never handed back to it as
   * a fabricated error; it propagates out of the returned promise. The
   * automatic deferred check still runs when a cold-start dispatch throws.
   *
   * A malformed key is reported through `onLink` and logged; it does not throw.
   * @returns Promise that resolves when configuration completes.
   *
   * @example
   * ```ts
   * // Opt-out model — everything works with one call:
   * WarpLink.configure({
   *   apiKey: 'wl_live_...',
   *   onLink: ({ deepLink, error }) => {
   *     if (deepLink) navigate(deepLink.deepLinkUrl ?? deepLink.destination);
   *     else if (error) console.error(error.code, error.message);
   *   },
   * });
   * ```
   */
  configure(options: WarpLinkConfig): Promise<void> {
    return configureSdk(options);
  },

  /**
   * A manual resolve reaches the same native module as the automatic path, so
   * on Android it cancels whatever automatic tap is in flight
   * (`LinkResolver.resolveDeepLink`). Claiming a silent tap first
   * (`claimAutoTap(true)`, the mechanism warplink-z07t added for a forced
   * repeat) makes this call count as a newer tap for supersession without
   * ever handing its own answer to the automatic sink: the cancellation it
   * causes is swallowed as a superseded tap instead of reaching `onLink` as a
   * spurious `E_NETWORK_ERROR` (warplink-17r7). This call's own promise still
   * settles from its own native answer, unaffected by whether it superseded
   * anything.
   *
   * A FOREIGN url claims nothing. Neither native ever lets one near a claim
   * (Android `UriParser.isWarpLinkUri` before `tapGeneration`; iOS
   * `isWarpLinkURL` before `supersedeInFlightTap`), and it cancels nothing on
   * either platform, so a silent tap for one would silence an automatic tap
   * that is still the host's. The native resolve runs either way and still
   * rejects a foreign url with its own `E_INVALID_URL` (warplink-0csz).
   */
  async handleDeepLink(url: string): Promise<WarpLinkDeepLink | null> {
    const resolved = (await classifyUrl(url))
      ? await resolveClaimed(url, claimAutoTap(true))
      : await resolveOnce(url);
    if (resolved?.error) {
      throw resolved.error;
    }
    return resolved?.deepLink ?? null;
  },

  /**
   * Checks for a deferred deep link from an install attribution match.
   *
   * With the opt-out model this fires automatically from `configure()`
   * (unless `automaticDeferredDeepLinks: false`). Call it manually only
   * for advanced flows or when you disabled the automatic check.
   *
   * Returns the matched deep link with `isDeferred: true`; once attribution
   * has completed the native SDK returns the same cached match on later
   * launches, and `null` when there was no match. The automatic dispatch from
   * `configure()` delivers a match to `onLink` at most once across launches;
   * this manual call always returns the cached result for advanced flows.
   *
   * `matchGuaranteed` is true only for a deterministic match. Use it, like
   * `matchConfidence`, to pick the destination to route to, not as a
   * credential. Authenticate the user and check authorization separately
   * before showing private data or doing anything sensitive, guaranteed
   * match or not.
   *
   * @returns Deferred deep link or `null`.
   * @throws {WarpLinkError} `E_NOT_CONFIGURED` — SDK not initialized.
   * @throws {WarpLinkError} `E_NETWORK_ERROR` — Attribution API unreachable.
   * @throws {WarpLinkError} `E_SERVER_ERROR` — 5xx from attribution API.
   * @throws {WarpLinkError} `E_DECODING_ERROR` — Malformed API response.
   *
   * @example
   * ```ts
   * const link = await WarpLink.checkDeferredDeepLink();
   * if (link?.isDeferred) {
   *   navigation.navigate(link.deepLinkUrl ?? link.destination);
   * }
   * ```
   */
  async checkDeferredDeepLink(): Promise<WarpLinkDeepLink | null> {
    try {
      const result = await NativeWarpLink.checkDeferredDeepLink();
      return deserializeDeepLink(result);
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  /**
   * Returns install attribution for the current install.
   *
   * Distinguishes a genuine "no attribution" (native returns `null` →
   * this returns `null`) from a decode failure (native returns a
   * non-null but malformed payload → throws `E_DECODING_ERROR`).
   *
   * @returns Attribution data, or `null` when there is no match.
   * @throws {WarpLinkError} `E_NOT_CONFIGURED` — SDK not initialized.
   * @throws {WarpLinkError} `E_DECODING_ERROR` — Malformed native payload.
   * @throws {WarpLinkError} `E_NETWORK_ERROR` / `E_SERVER_ERROR` — API failure.
   */
  async getAttributionResult(): Promise<AttributionResult | null> {
    let raw: unknown;
    try {
      raw = await NativeWarpLink.getAttributionResult();
    } catch (error) {
      throw mapNativeError(error);
    }
    if (raw == null) {
      // Genuine no-match.
      return null;
    }
    const parsed = deserializeAttributionResult(raw);
    if (parsed == null) {
      // A payload was returned but could not be decoded.
      throw new WarpLinkError(
        ErrorCodes.E_DECODING_ERROR,
        'Malformed attribution result from native module'
      );
    }
    return parsed;
  },

  /**
   * The version of the native WarpLink SDK this bridge is running against.
   *
   * Ask the SDK, not the package. React Native pins its native SDK by hand and
   * the pin has drifted before: `@warplink/react-native@1.0.2` shipped an
   * Android SDK that reported `0.1.1` over the wire. This returns what the
   * native SDK actually reports, so a host can see that mismatch instead of
   * being told what the package name claims.
   *
   * @example
   * ```ts
   * console.log(await WarpLink.sdkVersion()); // "1.2.0"
   * ```
   */
  async sdkVersion(): Promise<string> {
    try {
      return await NativeWarpLink.getSdkVersion();
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  /**
   * Whether the deferred attribution check has definitively completed for this
   * install.
   *
   * Scoped to ONE install: it goes back to `false` after the app is deleted and
   * installed again, and after a restore from backup, because a reinstall
   * counts as an install and has to be attributed again.
   *
   * Useful for diagnostics and for a host that drives the deferred check
   * itself. The automatic dispatch already gates on it, so a normal
   * integration does not need to read it.
   */
  async isAttributionComplete(): Promise<boolean> {
    try {
      return await NativeWarpLink.isAttributionComplete();
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  /**
   * Finishes a referral handoff from the text a person pasted.
   *
   * Call it with the text from the system paste control the person taps. The
   * SDK never reads the clipboard on its own. Text that is not an invitation
   * resolves `null` and sends nothing. A valid invitation resolves the matched
   * link with its evidence fields.
   *
   * @throws {WarpLinkError} `E_SERVER_ERROR` when the invitation is invalid or
   *   expired (the message says how to open the link again), or when it could
   *   not be confirmed yet. After a network failure the native SDK keeps the
   *   invitation and tries again on a later launch, a bounded number of times.
   * @throws {WarpLinkError} `E_NOT_CONFIGURED` when the SDK is not configured.
   */
  redeemInvitation(text: string): Promise<WarpLinkDeepLink | null> {
    return redeemInvitation(text);
  },

  /**
   * Claims the referral behind this install for the person who just signed up.
   *
   * `installerId` is your own stable id for that person, 1 to 128 characters,
   * dedicated to WarpLink: never a primary key, an email or other personal
   * data. Calling again with the same id is safe: the server answers the same
   * claim rather than crediting twice. Status `none` is an answer, not an
   * error.
   *
   * @throws {WarpLinkError} `E_SERVER_ERROR` for an empty or too long id, or a
   *   server failure; `E_NETWORK_ERROR`, `E_INVALID_API_KEY` and
   *   `E_NOT_CONFIGURED` as for the other calls.
   */
  claimReferral(installerId: string): Promise<ReferralClaimResult> {
    return claimReferral(installerId);
  },

  async isConfigured(): Promise<boolean> {
    try {
      return await NativeWarpLink.isConfigured();
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  /**
   * Register a listener for warm-start deep links.
   *
   * Advanced/opt-out API. When `configure()` is called with an `onLink`
   * callback and `automaticDeepLinks` is not disabled, warm-start events
   * are already funneled into `onLink` for you.
   *
   * @returns Unsubscribe function.
   */
  onDeepLink(listener: DeepLinkListener): () => void {
    // Explicit subscribers are not the automatic path and are not deduped or
    // superseded: they asked for every event and they get every event.
    return subscribeUrlHandler((_url, resolved) => {
      deliverResolved(listener, resolved);
    });
  },

  async getInitialDeepLink(): Promise<WarpLinkDeepLink | null> {
    try {
      const url = await NativeWarpLink.getInitialURL();
      if (url == null) {
        return null;
      }
      // A manual resolve of whatever url this returns, so it goes through
      // handleDeepLink's own silent-claim supersession (warplink-17r7) rather
      // than a second copy of it.
      return await this.handleDeepLink(url);
    } catch (error) {
      throw mapNativeError(error);
    }
  },
};
