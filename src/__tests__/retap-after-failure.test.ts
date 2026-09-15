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
 * A re-tap of the same url inside the dedupe window, after the FIRST tap's
 * resolve failed, must reach the native module (warplink-l2vc).
 *
 * shouldAutoDispatch stamps (lastAutoUrl, lastAutoAt) the instant a url
 * arrives and, before this fix, never let go of the stamp when the resolve
 * that followed failed. A retry the user makes themselves, offline or during
 * a server error, was then silently swallowed for the rest of the 1500ms
 * window, and onLink kept only the failure.
 *
 * Both native SDKs already drop their claim on a failed resolve, because a
 * failure is not a duplicate to suppress:
 * - Android `AutoLinkHandler.settle` sets `lastUri = null` for a failed
 *   current claim.
 * - iOS `releaseDuplicateClaim` (`WarpLink+Supersede.swift`) drops the claim
 *   after a failed resolve, called from `WarpLink+Resolve.swift` only while
 *   the failing tap still owns it.
 *
 * Bead: warplink-l2vc.
 */
let WarpLink: typeof import('../WarpLink').WarpLink;

const VALID_LIVE_KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const URL_A = 'https://aplnk.to/rn12-retap';
const URL_B = 'https://aplnk.to/rn12-other';

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

const LINK_A = link('9c1b0e2a-1f3d-4b8e-8a2c-4e6f7d9b1a3c');
const LINK_B = link('2d4f6a8b-3c5e-47d1-9b0a-6f8d1c2e4b5a');

function emitNativeEvent(data: Record<string, unknown>): void {
  const handler = mockEmitterListeners.get('onWarpLinkDeepLink');
  if (handler) handler(data);
}

const flushPromises = async (turns = 8): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** Any rejection the native module produces, by code. */
function nativeError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

/** An OAuth callback: it reaches the bridge like any url, and is not a WarpLink link. */
const FOREIGN = 'myapp://oauth/callback';

/** A one-line picture of what the host received, in order. */
function received(events: DeepLinkEvent[]): string[] {
  return events.map((e) =>
    e.deepLink ? `link:${e.deepLink.linkId}` : `error:${e.error?.code}`
  );
}

describe('a re-tap after a failed resolve (warplink-l2vc)', () => {
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
    jest.restoreAllMocks();
  });

  it('reaches the native module again when the same url is re-tapped 800ms after a failed resolve', async () => {
    const events: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    mockHandleDeepLink
      .mockRejectedValueOnce(nativeError(ErrorCodes.E_NETWORK_ERROR, 'offline'))
      .mockResolvedValueOnce(LINK_A);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();

    // 800ms later, well inside the 1500ms dedupe window.
    nowSpy.mockReturnValue(1800);
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    expect(mockHandleDeepLink).toHaveBeenCalledTimes(2);
    expect(received(events)).toEqual([
      `error:${ErrorCodes.E_NETWORK_ERROR}`,
      `link:${LINK_A.linkId}`,
    ]);
  });

  /**
   * The fix must not overshoot: a SUCCESSFUL first tap keeps its stamp, so a
   * re-tap of the same url inside the window is still a duplicate. WL-S03.
   */
  it('still dedupes a successful tap re-tapped 800ms later', async () => {
    const events: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    mockHandleDeepLink.mockResolvedValue(LINK_A);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();

    nowSpy.mockReturnValue(1800);
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    expect(mockHandleDeepLink).toHaveBeenCalledTimes(1);
    expect(received(events)).toEqual([`link:${LINK_A.linkId}`]);
  });

  /**
   * The foreign-url case this file used to own, rewritten for warplink-0csz.
   *
   * `E_INVALID_URL` was the native module refusing a FOREIGN url, and this file
   * asserted the stamp such a url left behind was kept, so a repeat of the same
   * foreign url was deduped against it. That premise is gone: a foreign url is
   * now classified before anything is stamped, so it leaves no stamp, claims no
   * tap, and with only the automatic sink wired is never resolved at all. Both
   * natives behave exactly this way, and neither ever dedupes one foreign url
   * against another, because neither ever records one.
   *
   * The rule this file exists for is unaffected: a FAILED resolve of a real
   * link still clears the stamp, which is the case above and below.
   */
  it('never resolves a foreign url, so it leaves no stamp for a repeat to match', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    mockHandleDeepLink.mockResolvedValue(LINK_A);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: () => undefined,
    });

    emitNativeEvent({ url: FOREIGN });
    await flushPromises();

    nowSpy.mockReturnValue(1800);
    emitNativeEvent({ url: FOREIGN });
    await flushPromises();

    expect(mockIsWarpLinkUrl).toHaveBeenCalledWith(FOREIGN);
    expect(mockHandleDeepLink).not.toHaveBeenCalled();

    // Nothing was stamped, so the real link tapped next is a first arrival.
    nowSpy.mockReturnValue(1900);
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    expect(mockHandleDeepLink).toHaveBeenCalledTimes(1);
  });

  /**
   * Only the tap that owns the current stamp may clear it. A newer tap on a
   * DIFFERENT url overwrites the stamp before the older tap's failure comes
   * back, so the older tap's failure must leave the newer tap's stamp alone:
   * the stamp belongs to the newer tap now, not to the one that failed.
   */
  it('does not clear a newer tap\'s stamp when the older tap it replaced fails', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const inFlightA = held<unknown>();
    mockHandleDeepLink.mockImplementation((url: string) =>
      url === URL_A ? inFlightA.promise : Promise.resolve(LINK_B)
    );

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: () => undefined,
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();

    nowSpy.mockReturnValue(1500);
    emitNativeEvent({ url: URL_B });
    await flushPromises();

    // A's failure arrives after B has already claimed the stamp.
    inFlightA.reject(nativeError(ErrorCodes.E_NETWORK_ERROR, 'offline'));
    await flushPromises();

    // Still inside B's own dedupe window: a repeat of B must stay suppressed.
    nowSpy.mockReturnValue(1600);
    emitNativeEvent({ url: URL_B });
    await flushPromises();

    expect(mockHandleDeepLink).toHaveBeenCalledTimes(2);
  });
});
