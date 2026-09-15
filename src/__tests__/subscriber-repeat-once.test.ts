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
 * With an explicit onDeepLink() subscriber wired, dispatchNativeEvent still
 * resolves a repeat arrival inside the dedupe window, because the subscriber
 * asked for every event. That resolve claims a tap so it can supersede the
 * one already in flight, and before this fix nothing marked the repeat's own
 * tap as ineligible for onLink: whenever the first tap had already answered,
 * nothing superseded the repeat, and its answer reached onLink a second time
 * for one tap. WL-S03.
 *
 * Bead: warplink-z07t.
 */
let WarpLink: typeof import('../WarpLink').WarpLink;

const VALID_LIVE_KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const URL = 'https://aplnk.to/rn13-repeat';

const LINK = {
  linkId: 'b6e2f9a0-6b1d-4e2a-9c3f-7a8d0e1f2b3c',
  destination: 'https://warplink.app/docs/sdks/react-native',
  deepLinkUrl: 'warplink-test://product/42',
  customParams: {},
  isDeferred: false,
  matchType: 'deterministic',
  matchConfidence: 1,
  matchGuaranteed: true,
};

const OTHER_LINK = {
  ...LINK,
  linkId: 'c7f3a0b1-7c2e-4f3b-ad4f-8b9e1f2a3c4d',
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

/** A one-line picture of what a sink received, in order. */
function received(events: DeepLinkEvent[]): string[] {
  return events.map((e) =>
    e.deepLink ? `link:${e.deepLink.linkId}` : `error:${e.error?.code}`
  );
}

describe('an explicit subscriber and a repeat inside the dedupe window (warplink-z07t)', () => {
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

  /**
   * The bug as reported: the first tap has already answered by the time the
   * repeat arrives, so nothing supersedes it, and the old code handed onLink
   * the same link a second time.
   */
  it('delivers to onLink once when the repeat arrives after the first tap answered', async () => {
    const onLinkEvents: DeepLinkEvent[] = [];
    const explicit: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(10000);
    mockHandleDeepLink.mockResolvedValue(LINK);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => onLinkEvents.push(event),
    });
    WarpLink.onDeepLink((event) => explicit.push(event));

    emitNativeEvent({ url: URL });
    await flushPromises();

    nowSpy.mockReturnValue(10300);
    emitNativeEvent({ url: URL });
    await flushPromises();

    expect(mockHandleDeepLink).toHaveBeenCalledTimes(2);
    expect(received(onLinkEvents)).toEqual([`link:${LINK.linkId}`]);
    expect(received(explicit)).toEqual([
      `link:${LINK.linkId}`,
      `link:${LINK.linkId}`,
    ]);
  });

  /**
   * The other order, already covered for the pure-automatic path by
   * warplink-8jih (supersede.test.ts): with the first tap still in flight when
   * the repeat is forced through, the repeat supersedes it and still has to
   * reach onLink once, never as the cancellation the supersede caused. The fix
   * for the bug above must not overshoot into silencing this case too.
   */
  it('still delivers once, and never a cancellation, while the first tap is in flight', async () => {
    const onLinkEvents: DeepLinkEvent[] = [];
    const explicit: DeepLinkEvent[] = [];
    mockHandleDeepLink
      .mockRejectedValueOnce(cancellation('Network request failed: Canceled'))
      .mockResolvedValueOnce(LINK);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => onLinkEvents.push(event),
    });
    WarpLink.onDeepLink((event) => explicit.push(event));

    emitNativeEvent({ url: URL });
    emitNativeEvent({ url: URL });
    await flushPromises();

    expect(received(onLinkEvents)).toEqual([`link:${LINK.linkId}`]);
    expect(explicit).toHaveLength(2);
    expect(explicit.filter((e) => e.error)).toHaveLength(1);
    expect(explicit.filter((e) => e.deepLink)).toHaveLength(1);
  });

  /**
   * Same "still in flight" order, but with a held-open resolve instead of a
   * rejection, so the assertion does not depend on the exact shape a native
   * cancellation takes.
   */
  it('delivers once when the repeat is claimed before the first tap has answered at all', async () => {
    const onLinkEvents: DeepLinkEvent[] = [];
    const open = new Map<string, ReturnType<typeof held<unknown>>>();
    let calls = 0;
    mockHandleDeepLink.mockImplementation((url: string) => {
      calls += 1;
      const handle = held<unknown>();
      open.set(`${url}#${calls}`, handle);
      return handle.promise;
    });

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => onLinkEvents.push(event),
    });
    WarpLink.onDeepLink(() => undefined);

    emitNativeEvent({ url: URL });
    emitNativeEvent({ url: URL });
    await flushPromises();
    expect(onLinkEvents).toHaveLength(0);

    // The second (repeat) claim's own resolve answers first.
    open.get(`${URL}#2`)?.resolve(LINK);
    await flushPromises();
    expect(received(onLinkEvents)).toEqual([`link:${LINK.linkId}`]);

    // The first claim's cancellation, arriving after, must stay silent.
    open.get(`${URL}#1`)?.reject(cancellation('Network request failed: Canceled'));
    await flushPromises();
    expect(received(onLinkEvents)).toEqual([`link:${LINK.linkId}`]);
  });

  /**
   * Deferred from the review of this fix (#317): a forced repeat's own tap
   * never owns the dedupe stamp, only a `fresh` arrival ever does (see
   * `dispatchNativeEvent`), so its own failure must leave the stamp alone,
   * exactly as `releaseStampOnFailure`'s ownership guard requires. If it did
   * not, the stamp would look cleared, and a third arrival still inside the
   * owner's original window would read as a fresh navigation instead of a
   * repeat, and reach onLink a second time for one tap.
   */
  it('does not clear the dedupe stamp when a forced repeat it does not own fails', async () => {
    const onLinkEvents: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    mockHandleDeepLink
      .mockResolvedValueOnce(LINK)
      .mockRejectedValueOnce(cancellation('Network request failed: Canceled'))
      .mockResolvedValueOnce(OTHER_LINK);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => onLinkEvents.push(event),
    });
    WarpLink.onDeepLink(() => undefined);

    // The owner: fresh, settles first, and sets the stamp.
    emitNativeEvent({ url: URL });
    await flushPromises();

    // A forced repeat, still inside the window, whose own resolve fails. It
    // does not own the stamp (the owner does), so its failure must not clear
    // it.
    nowSpy.mockReturnValue(1300);
    emitNativeEvent({ url: URL });
    await flushPromises();

    // A third arrival, still inside the owner's original window. If the
    // repeat's failure had cleared the stamp, this would read as fresh and
    // deliver OTHER_LINK to onLink a second time.
    nowSpy.mockReturnValue(1400);
    emitNativeEvent({ url: URL });
    await flushPromises();

    expect(mockHandleDeepLink).toHaveBeenCalledTimes(3);
    expect(received(onLinkEvents)).toEqual([`link:${LINK.linkId}`]);
  });

  /**
   * Deferred from the review of this fix (#317): with the owner still in
   * flight, `dispatchNativeEvent`'s `silent` flag never fires (it only fires
   * once the tap that owns the stamp has settled), so two repeats forced
   * through while it is still resolving stack as ordinary, non-silent taps,
   * exactly like two back-to-back taps on a different link
   * (cross-link-supersede.test.ts). The general supersede machinery has to
   * carry that stacking on its own: the newest tap delivers, and both older
   * cancellations it causes stay silent.
   */
  it('delivers exactly once when two forced repeats stack while the owner is still in flight', async () => {
    const onLinkEvents: DeepLinkEvent[] = [];
    const open: Array<ReturnType<typeof held<unknown>>> = [];
    mockHandleDeepLink.mockImplementation(() => {
      const handle = held<unknown>();
      open.push(handle);
      return handle.promise;
    });

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => onLinkEvents.push(event),
    });
    WarpLink.onDeepLink(() => undefined);

    // The owner, then two forced repeats, all claimed while the owner is
    // still resolving.
    emitNativeEvent({ url: URL });
    emitNativeEvent({ url: URL });
    emitNativeEvent({ url: URL });
    await flushPromises();
    expect(onLinkEvents).toHaveLength(0);

    // The newest tap answers first, and is a link: it supersedes both older
    // ones.
    open[2]?.resolve(OTHER_LINK);
    await flushPromises();
    expect(received(onLinkEvents)).toEqual([`link:${OTHER_LINK.linkId}`]);

    // Both older cancellations, arriving after, must stay silent.
    open[1]?.reject(cancellation('Network request failed: Canceled'));
    open[0]?.reject(cancellation('Network request failed: Canceled'));
    await flushPromises();

    expect(received(onLinkEvents)).toEqual([`link:${OTHER_LINK.linkId}`]);
  });
});
