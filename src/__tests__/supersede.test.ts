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
import { classifyLikeNative } from '../../test-utils/classify-like-native';

/**
 * The TypeScript layer keeps its emitter subscription and its dedupe window in
 * module scope, so a suite that re-creates the NativeEventEmitter mock between
 * tests must re-import the module too. Without this the second test registers
 * its handler on a mock the module never sees, and every assertion reads an
 * empty event list for a reason that has nothing to do with the SDK.
 */
let WarpLink: typeof import('../WarpLink').WarpLink;

const VALID_LIVE_KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const URL = 'https://aplnk.to/rn11-leg7';

const LINK = {
  linkId: '39a710b4-68a5-4b2b-ade4-db3aac6e4f6c',
  destination: 'https://warplink.app/docs/sdks/react-native',
  deepLinkUrl: 'warplink-test://product/42',
  customParams: {},
  isDeferred: false,
  matchType: 'deterministic',
  matchConfidence: 1,
  matchGuaranteed: true,
};

function emitNativeEvent(data: Record<string, unknown>): void {
  const handler = mockEmitterListeners.get('onWarpLinkDeepLink');
  if (handler) handler(data);
}

const flushPromises = async (turns = 8): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** The rejection the native module produces when a newer tap cancels an older one. */
function cancellation(message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = ErrorCodes.E_NETWORK_ERROR;
  return error;
}

describe('a superseded tap (warplink-8jih)', () => {
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      WarpLink = (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
    });
  });

  /**
   * Observed on hardware, device pass leg 9a: two taps of one link 0.4 s apart.
   *
   * The duplicate used to reach the native module, which cancelled the tap
   * already in flight. The host was then handed that cancellation as an
   * `E_NETWORK_ERROR` for a network that never failed, and the newer tap's real
   * answer was discarded as a repeat. The native SDKs dedupe before the
   * request, which is why the native test app saw one resolve and one delivery.
   */
  it('makes one native call for two taps inside the dedupe window', async () => {
    mockHandleDeepLink.mockResolvedValue(LINK);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: jest.fn(),
    });

    emitNativeEvent({ url: URL });
    emitNativeEvent({ url: URL });
    await flushPromises();

    expect(mockHandleDeepLink).toHaveBeenCalledTimes(1);
  });

  it('delivers the link once, and no failure, for two taps inside the window', async () => {
    const events: DeepLinkEvent[] = [];
    mockHandleDeepLink.mockResolvedValue(LINK);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL });
    emitNativeEvent({ url: URL });
    await flushPromises();

    expect(events.filter((e) => e.error)).toHaveLength(0);
    expect(events.filter((e) => e.deepLink)).toHaveLength(1);
    expect(events[0]?.deepLink?.linkId).toBe(LINK.linkId);
  });

  /**
   * The other shape, observed on hardware as the re-tap leg: the second tap
   * lands 2.0 s later, PAST the 1500 ms dedupe window, so it is a fresh
   * navigation rather than a duplicate. It still supersedes the first tap, and
   * the first tap's cancellation still reached the host as a spurious
   * `Socket closed`. Two taps must produce one answer, not one answer and one
   * phantom failure.
   */
  it('does not deliver an older tap cancelled by a re-tap past the window', async () => {
    const events: DeepLinkEvent[] = [];
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);

    mockHandleDeepLink
      .mockRejectedValueOnce(cancellation('Network request failed: Socket closed'))
      .mockResolvedValueOnce(LINK);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL });
    // 2.0 s later: past DEDUPE_WINDOW_MS, so this is a new navigation.
    now.mockReturnValue(1_002_000);
    emitNativeEvent({ url: URL });
    await flushPromises();

    now.mockRestore();

    expect(events.filter((e) => e.error)).toHaveLength(0);
    expect(events.filter((e) => e.deepLink)).toHaveLength(1);
  });

  /**
   * The path an explicit `onDeepLink()` subscriber keeps open.
   *
   * A repeat arrival inside the dedupe window is not delivered to the automatic
   * sink, but an explicit subscriber asked for every event, so the resolve still
   * has to run. That native call cancels the tap already in flight, and the
   * cancelled tap's number was still the newest for its url, so its rejection
   * was handed to the automatic sink as a `networkError` for a network that
   * never failed. Same defect as leg 9a, reached through a different door.
   *
   * Any arrival that reaches the native module must therefore claim a tap and
   * supersede the one before it, because the native module will cancel that one.
   */
  it('does not hand the automatic sink a cancellation when an explicit subscriber forces the resolve', async () => {
    const events: DeepLinkEvent[] = [];
    const explicit: DeepLinkEvent[] = [];
    mockHandleDeepLink
      .mockRejectedValueOnce(cancellation('Network request failed: Canceled'))
      .mockResolvedValueOnce(LINK);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });
    WarpLink.onDeepLink((event) => explicit.push(event));

    emitNativeEvent({ url: URL });
    emitNativeEvent({ url: URL });
    await flushPromises();

    expect(events.filter((e) => e.error)).toHaveLength(0);
    expect(events.filter((e) => e.deepLink)).toHaveLength(1);
    expect(events[0]?.deepLink?.linkId).toBe(LINK.linkId);
  });

  /**
   * The other half of the same case: the explicit subscriber is not the
   * automatic path and is not deduped or superseded. It asked for every event
   * and it gets every event, including the failure.
   */
  it('still gives an explicit subscriber every event', async () => {
    const explicit: DeepLinkEvent[] = [];
    mockHandleDeepLink
      .mockRejectedValueOnce(cancellation('Network request failed: Canceled'))
      .mockResolvedValueOnce(LINK);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: jest.fn(),
    });
    WarpLink.onDeepLink((event) => explicit.push(event));

    emitNativeEvent({ url: URL });
    emitNativeEvent({ url: URL });
    await flushPromises();

    expect(mockHandleDeepLink).toHaveBeenCalledTimes(2);
    expect(explicit).toHaveLength(2);
    expect(explicit.filter((e) => e.error)).toHaveLength(1);
    expect(explicit.filter((e) => e.deepLink)).toHaveLength(1);
  });

  /**
   * A genuine network failure is still the host's to see. WL-S21 requires it,
   * and leg 16 depends on it: an offline deferred check reports
   * `E_NETWORK_ERROR` through `onLink`. Only a cancellation caused by this
   * SDK superseding its own request is suppressed.
   */
  it('still reports a real network failure', async () => {
    const events: DeepLinkEvent[] = [];
    mockHandleDeepLink.mockRejectedValue(
      cancellation('Network request failed: attempt abandoned after 3000ms')
    );

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL });
    await flushPromises();

    const failures = events.filter((e) => e.error);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.error?.code).toBe(ErrorCodes.E_NETWORK_ERROR);
  });
});
