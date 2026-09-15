const mockConfigure = jest.fn();
const mockHandleDeepLink = jest.fn();
const mockIsWarpLinkUrl = jest.fn();
const mockCheckDeferredDeepLink = jest.fn();
const mockGetAttributionResult = jest.fn();
const mockIsConfigured = jest.fn();
const mockIsAttributionComplete = jest.fn();
const mockGetInitialURL = jest.fn();

type EventHandler = (event: Record<string, unknown>) => void;

let mockEmitterListeners: Map<string, EventHandler>;
const mockRemoveSubscription = jest.fn();
const mockNativeEventEmitter = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    WarpLinkModule: {
      configure: mockConfigure,
      handleDeepLink: mockHandleDeepLink,
      isWarpLinkUrl: mockIsWarpLinkUrl,
      checkDeferredDeepLink: mockCheckDeferredDeepLink,
      getAttributionResult: mockGetAttributionResult,
      isConfigured: mockIsConfigured,
      isAttributionComplete: mockIsAttributionComplete,
      getInitialURL: mockGetInitialURL,
    },
  },
  Platform: {
    select: jest.fn((obj: Record<string, string>) => obj['default'] ?? ''),
  },
  NativeEventEmitter: mockNativeEventEmitter,
}));

import { ErrorCodes, type DeepLinkEvent } from '../types';
import { held } from '../../test-utils/held';
import { classifyLikeNative } from '../../test-utils/classify-like-native';

/**
 * A host's own `handleDeepLink` / `getInitialDeepLink` call resolves through
 * the same native module as the automatic path, so on Android it cancels
 * whatever automatic tap is in flight (`LinkResolver.resolveDeepLink`,
 * `inFlightTap.getAndSet(null)?.cancel()`), and the bridge routes every
 * `handleDeepLink` through it. Before this fix, the manual call never claimed
 * a tap of its own, so the automatic tap it cancelled was never superseded,
 * and its cancellation reached `onLink` as an `E_NETWORK_ERROR` for a network
 * that never failed: the warplink-8jih symptom, reached through the manual
 * API instead of a second automatic tap.
 *
 * The fix reuses the silent-claim mechanism `claimAutoTap(true)` added for
 * warplink-z07t: a manual resolve counts as a newer tap for supersession,
 * exactly like a forced repeat, but its own answer is never delivered to the
 * automatic sink. The manual call's own promise still settles from its own
 * native answer, unaffected by whether it superseded anything.
 *
 * Bead: warplink-17r7.
 */
let WarpLink: typeof import('../WarpLink').WarpLink;

const VALID_LIVE_KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const URL_A = 'https://aplnk.to/rn17-auto';
const URL_B = 'https://aplnk.to/rn17-manual';

const link = (linkId: string) => ({
  linkId,
  destination: 'https://warplink.app/docs/sdks/react-native',
  deepLinkUrl: 'warplink-test://product/42',
  customParams: {},
  isDeferred: false,
  matchType: 'deterministic',
  matchConfidence: 1,
  matchGuaranteed: true,
});

const LINK_A = link('a19b8f3e-3c1d-4f2a-9b7e-1d2c3e4f5a6b');
const LINK_B = link('b29c9f4e-4d2e-5f3b-ac8f-2e3d4f5a6b7c');

const URL_C = 'https://aplnk.to/rn17-newer';

/** An OAuth callback: it reaches the bridge like any url, and is not a WarpLink link. */
const FOREIGN = 'myapp://oauth/callback';

function emitNativeEvent(data: Record<string, unknown>): void {
  const handler = mockEmitterListeners.get('onWarpLinkDeepLink');
  if (handler) handler(data);
}

const flushPromises = async (turns = 8): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** The rejection the Android native module produces when a newer resolve cancels an older one. */
function cancellation(message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = ErrorCodes.E_NETWORK_ERROR;
  return error;
}

/** Any rejection the native module produces, by code. */
function nativeError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

/** A one-line picture of what the host received, in order. */
function received(events: DeepLinkEvent[]): string[] {
  return events.map((e) =>
    e.deepLink ? `link:${e.deepLink.linkId}` : `error:${e.error?.code}`
  );
}

describe('a manual resolve supersedes the automatic tap it cancels (warplink-17r7)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockIsWarpLinkUrl.mockImplementation(classifyLikeNative);
    mockConfigure.mockResolvedValue(undefined);
    mockIsAttributionComplete.mockResolvedValue(true);
    mockGetInitialURL.mockResolvedValue(null);
    mockEmitterListeners = new Map();
    mockNativeEventEmitter.mockImplementation(() => ({
      addListener: jest.fn((eventName: string, handler: EventHandler) => {
        mockEmitterListeners.set(eventName, handler);
        return { remove: mockRemoveSubscription };
      }),
      removeAllListeners: jest.fn(),
    }));

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      WarpLink = (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
    });
  });

  /**
   * Android model: `handleDeepLink(URL_B)` resolving cancels the automatic
   * tap on URL_A still in flight, and that cancellation comes back as a
   * rejected promise. Expected FAIL before the fix: `onLink` receives
   * `error:E_NETWORK_ERROR` for URL_A, because the manual call never claimed
   * a tap to supersede it.
   */
  it('supersedes the automatic tap it cancels, without reporting the cancellation to onLink', async () => {
    const onLinkEvents: DeepLinkEvent[] = [];
    const inFlightA: { reject?: (error: unknown) => void } = {};
    mockHandleDeepLink.mockImplementation((url: string) => {
      if (url === URL_A) {
        return new Promise((_resolve, reject) => {
          inFlightA.reject = reject;
        });
      }
      inFlightA.reject?.(cancellation('Network request failed: Canceled'));
      return Promise.resolve(LINK_B);
    });

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => onLinkEvents.push(event),
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();

    const manualResult = await WarpLink.handleDeepLink(URL_B);

    await flushPromises();

    expect(manualResult).toEqual(
      expect.objectContaining({ linkId: LINK_B.linkId })
    );
    expect(received(onLinkEvents)).toEqual([]);
  });

  /**
   * A manual call on a FOREIGN url must supersede nothing: the native module
   * refuses it before it can claim or cancel anything (Android's
   * `UriParser.isWarpLinkUri` check runs before `tapGeneration` is touched),
   * so the automatic tap in flight still delivers its own link. The manual
   * promise rejects with the native's own `E_INVALID_URL`.
   */
  it('does not supersede an automatic tap when the manual url is foreign', async () => {
    const onLinkEvents: DeepLinkEvent[] = [];
    const inFlightA = held<unknown>();
    mockHandleDeepLink.mockImplementation((url: string) =>
      url === FOREIGN
        ? Promise.reject(nativeError(ErrorCodes.E_INVALID_URL, 'Invalid URL'))
        : inFlightA.promise
    );

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => onLinkEvents.push(event),
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();

    await expect(WarpLink.handleDeepLink(FOREIGN)).rejects.toMatchObject({
      name: 'WarpLinkError',
      code: ErrorCodes.E_INVALID_URL,
    });

    inFlightA.resolve(LINK_A);
    await flushPromises();

    expect(received(onLinkEvents)).toEqual([`link:${LINK_A.linkId}`]);
  });

  /**
   * `getInitialDeepLink()` resolves the url it reads, so a host calling it
   * manually (advanced use, alongside the automatic path already wired) is
   * the same manual-resolve shape as `handleDeepLink`, reached through
   * `getInitialURL()` instead of a url the host already has.
   */
  it('supersedes the automatic tap it cancels through getInitialDeepLink too', async () => {
    const onLinkEvents: DeepLinkEvent[] = [];
    const inFlightA: { reject?: (error: unknown) => void } = {};
    mockHandleDeepLink.mockImplementation((url: string) => {
      if (url === URL_A) {
        return new Promise((_resolve, reject) => {
          inFlightA.reject = reject;
        });
      }
      inFlightA.reject?.(cancellation('Network request failed: Canceled'));
      return Promise.resolve(LINK_B);
    });
    // configure()'s own cold-start check finds nothing; URL_B is supplied to
    // the manual getInitialDeepLink() call below instead.
    mockGetInitialURL.mockResolvedValueOnce(null);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => onLinkEvents.push(event),
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();

    mockGetInitialURL.mockResolvedValueOnce(URL_B);
    const manualResult = await WarpLink.getInitialDeepLink();

    await flushPromises();

    expect(manualResult).toEqual(
      expect.objectContaining({ linkId: LINK_B.linkId })
    );
    expect(received(onLinkEvents)).toEqual([]);
  });
});

/**
 * `isSuperseded` waits for every newer tap in range to settle before deciding
 * an older tap's fate. A tap that never settles at all, not merely a slow
 * one, used to leave that `await` unresolved forever, so the older tap's
 * delivery to `onLink` hung silently.
 *
 * This hazard predates warplink-17r7 (a stuck automatic or forced-repeat tap
 * could already trigger it), but the fix above newly reaches it through the
 * public `handleDeepLink` / `getInitialDeepLink` API: nothing bounds how long
 * a host's own native call may take to answer, so a manual resolve that never
 * settles is now a realistic way to hang an unrelated automatic delivery.
 *
 * `isSuperseded` bounds the wait on `SUPERSEDE_WAIT_CEILING_MS`: a newer tap
 * still unsettled once the ceiling passes is treated as not-a-link for that
 * one decision, so the older tap delivers instead of hanging.
 */
describe('a newer tap that never settles cannot block an older tap forever (warplink-17r7)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockIsWarpLinkUrl.mockImplementation(classifyLikeNative);
    mockConfigure.mockResolvedValue(undefined);
    mockIsAttributionComplete.mockResolvedValue(true);
    mockGetInitialURL.mockResolvedValue(null);
    mockEmitterListeners = new Map();
    mockNativeEventEmitter.mockImplementation(() => ({
      addListener: jest.fn((eventName: string, handler: EventHandler) => {
        mockEmitterListeners.set(eventName, handler);
        return { remove: mockRemoveSubscription };
      }),
      removeAllListeners: jest.fn(),
    }));

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      WarpLink = (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
    });
  });

  afterEach(() => {
    // Scoped to these tests: every other test in this file relies on real
    // timers for flushPromises' setImmediate loop.
    jest.useRealTimers();
  });

  /**
   * The manual case: a host's own `handleDeepLink(URL_B)` whose native
   * promise never answers must not hang the automatic tap on URL_A it
   * claimed a superseding tap over. Expected FAIL before this fix: the test
   * times out, because `isSuperseded` awaits `URL_B`'s tap forever.
   */
  it('delivers an automatic tap once a manual resolve that never settles passes the ceiling', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const onLinkEvents: DeepLinkEvent[] = [];
    const inFlightA = held<unknown>();
    mockHandleDeepLink.mockImplementation((url: string) =>
      url === URL_A ? inFlightA.promise : new Promise(() => undefined)
    );

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => onLinkEvents.push(event),
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();

    // Never awaited: this native call never answers, on purpose.
    void WarpLink.handleDeepLink(URL_B);
    await flushPromises();

    inFlightA.resolve(LINK_A);
    await flushPromises();
    expect(onLinkEvents).toHaveLength(0);

    jest.advanceTimersByTime(15_000);
    await flushPromises();

    expect(received(onLinkEvents)).toEqual([`link:${LINK_A.linkId}`]);
  }, 10_000);

  /**
   * The symmetric automatic case: a newer WARM tap (URL_C) whose native
   * promise never answers must not hang an older automatic tap (URL_A)
   * either. No manual call involved; this is the pre-existing latent hazard
   * the review flagged alongside warplink-17r7.
   */
  it('delivers an older automatic tap once a newer automatic tap that never settles passes the ceiling', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const onLinkEvents: DeepLinkEvent[] = [];
    const inFlightA = held<unknown>();
    mockHandleDeepLink.mockImplementation((url: string) =>
      url === URL_A ? inFlightA.promise : new Promise(() => undefined)
    );

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => onLinkEvents.push(event),
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();
    emitNativeEvent({ url: URL_C });
    await flushPromises();

    inFlightA.resolve(LINK_A);
    await flushPromises();
    expect(onLinkEvents).toHaveLength(0);

    jest.advanceTimersByTime(15_000);
    await flushPromises();

    expect(received(onLinkEvents)).toEqual([`link:${LINK_A.linkId}`]);
  }, 10_000);
});
