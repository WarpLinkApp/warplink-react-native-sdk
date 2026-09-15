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
 * A tap on a DIFFERENT link supersedes the one in flight, exactly as a re-tap
 * of the same link does (warplink-y2v9).
 *
 * Both native SDKs already work this way. Android's automatic path silences
 * any tap whose claim is no longer the newest, whatever its url
 * (`AutoLinkHandlerSupersedeTest` taps two different links and asserts one
 * dispatch), and iOS's `open()` does the same (`testANewerTapSilencesTheOlderOne`).
 * WL-S27: a superseded tap never reaches the host.
 *
 * The bridge scoped superseding to one url, so the older tap's answer still
 * reached the host. What that answer was depended on the platform underneath:
 *
 * - Android: the bridge's native resolve cancels whatever resolve is in flight,
 *   whatever its url, so the older tap's answer is a cancellation, and the host
 *   was handed an E_NETWORK_ERROR for a network that never failed.
 * - iOS, before warplink-3f0f fixed its bridge to cancel the same way: nothing
 *   was cancelled, so the older tap's answer was its link, and when it
 *   answered after the newer one the host navigated to the link the user
 *   tapped first.
 *
 * Both bridges now cancel an older bridge resolve on every newer call, so this
 * layer's own guard is a second line of defense rather than the only one, kept
 * for an installed native SDK older than the fix. It stays load-bearing on
 * both platforms for a subtler race this bridge-level cancellation does not
 * close by itself: the two native calls can be issued close enough together
 * that the older one's cancellation and the newer one's answer arrive out of
 * order, which is what the ordering tests below (`withholds an older
 * cancellation...`, `withholds an older link...`) exist to pin.
 *
 * Measured on the React Native iOS simulator pass: two different links injected
 * while the first was still resolving, two deliveries.
 */
let WarpLink: typeof import('../WarpLink').WarpLink;

const VALID_LIVE_KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const URL_A = 'https://aplnk.to/rn11-ios7';
const URL_B = 'https://aplnk.to/rn11-ios27';

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

const URL_C = 'https://aplnk.to/rn11-ios11';

const LINK_A = link('18e073e7-09d0-41b4-aeb1-c08a9bb0ca74');
const LINK_B = link('666d04ab-bcb1-41ce-bfa0-b2503a74ab05');
const LINK_C = link('7b013fab-693f-4b72-9247-4c74acf21b33');
const LINK_DEFERRED = { ...link('3df47491-7e1a-4f7a-a164-7fc35f950e36'), isDeferred: true };

/** A native module whose every resolve stays open until the test answers it, by url. */
function heldResolves(): Map<string, ReturnType<typeof held<unknown>>> {
  const open = new Map<string, ReturnType<typeof held<unknown>>>();
  mockHandleDeepLink.mockImplementation((url: string) => {
    const handle = held<unknown>();
    open.set(url, handle);
    return handle.promise;
  });
  return open;
}

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

/** An OAuth callback: it reaches the bridge like any url, and is not a WarpLink link. */
const FOREIGN = 'myapp://oauth/callback';

/** A one-line picture of what the host received, in order. */
function received(events: DeepLinkEvent[]): string[] {
  return events.map((e) =>
    e.deepLink ? `link:${e.deepLink.linkId}` : `error:${e.error?.code}`
  );
}

describe('a tap on a different link while one is in flight (warplink-y2v9)', () => {
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
   * Android underneath: the second native resolve cancels the first, whatever
   * its url (`LinkResolver.kt`, `inFlightTap`), and the first rejects.
   */
  it('does not hand the host the older link\'s cancellation', async () => {
    const events: DeepLinkEvent[] = [];
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
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    emitNativeEvent({ url: URL_B });
    await flushPromises();

    expect(received(events)).toEqual([`link:${LINK_B.linkId}`]);
  });

  /**
   * How iOS behaved before warplink-3f0f, and still the general case this
   * layer must not regress even now that both bridges cancel: whatever the
   * native call does underneath, if the older tap's own answer still reaches
   * this layer after the newer one's, delivering it would navigate the host
   * back to the link the user tapped first.
   */
  it('does not deliver the older link when it answers after the newer one', async () => {
    const events: DeepLinkEvent[] = [];
    const inFlightA: { resolve?: (value: unknown) => void } = {};
    mockHandleDeepLink.mockImplementation((url: string) => {
      if (url === URL_A) {
        return new Promise((resolve) => {
          inFlightA.resolve = resolve;
        });
      }
      return Promise.resolve(LINK_B);
    });

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    emitNativeEvent({ url: URL_B });
    await flushPromises();
    inFlightA.resolve?.(LINK_A);
    await flushPromises();

    expect(received(events)).toEqual([`link:${LINK_B.linkId}`]);
  });

  /**
   * The fix must not overshoot. Two different links tapped one after the
   * other, the first answered before the second arrives, are two navigations
   * and both are delivered. That is WL-S02.
   */
  it('still delivers two different links that do not overlap', async () => {
    const events: DeepLinkEvent[] = [];
    mockHandleDeepLink.mockImplementation((url: string) =>
      Promise.resolve(url === URL_A ? LINK_A : LINK_B)
    );

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();
    emitNativeEvent({ url: URL_B });
    await flushPromises();

    expect(received(events)).toEqual([
      `link:${LINK_A.linkId}`,
      `link:${LINK_B.linkId}`,
    ]);
  });

  /**
   * A real network failure on the newer link is still the host's to see:
   * superseding silences the older tap, never the newer one.
   */
  it('still reports the newer link\'s own failure', async () => {
    const events: DeepLinkEvent[] = [];
    mockHandleDeepLink.mockImplementation((url: string) =>
      url === URL_A
        ? new Promise(() => undefined)
        : Promise.reject(cancellation('Network request failed: attempt abandoned after 3000ms'))
    );

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    emitNativeEvent({ url: URL_B });
    await flushPromises();

    expect(received(events)).toEqual([`error:${ErrorCodes.E_NETWORK_ERROR}`]);
  });

  /**
   * A foreign url, an OAuth callback or a custom scheme, reaches the bridge
   * too, because both host hooks forward every url. Both natives refuse it
   * before it can claim anything, so it must never silence a real link that is
   * still resolving, and since warplink-0csz this layer refuses it at the same
   * point: it is classified before it can claim, so it never reaches the native
   * resolve at all.
   */
  it('does not let a foreign url silence a link that is still resolving', async () => {
    const events: DeepLinkEvent[] = [];
    const inFlightA = held<unknown>();
    mockHandleDeepLink.mockImplementation((url: string) => {
      if (url === URL_A) return inFlightA.promise;
      throw new Error(`unexpected resolve of: ${url}`);
    });

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    emitNativeEvent({ url: FOREIGN });
    await flushPromises();
    inFlightA.resolve(LINK_A);
    await flushPromises();

    expect(mockHandleDeepLink).not.toHaveBeenCalledWith(FOREIGN);
    expect(received(events)).toEqual([`link:${LINK_A.linkId}`]);
  });

  /**
   * The same guard in the other order: the foreign url is classified after the
   * link has already answered, and the link is still delivered.
   *
   * This used to hold the foreign url's RESOLVE open, because its refusal was
   * the only way to learn what it was. Held open now is its classification,
   * which is where the answer comes from (warplink-0csz).
   */
  it('delivers a link that answers before a later foreign url is classified', async () => {
    const events: DeepLinkEvent[] = [];
    const inFlightA = held<unknown>();
    const classifyingForeign = held<boolean>();
    mockHandleDeepLink.mockImplementation((url: string) => {
      if (url === URL_A) return inFlightA.promise;
      throw new Error(`unexpected resolve of: ${url}`);
    });
    mockIsWarpLinkUrl.mockImplementation((url: string) =>
      url === FOREIGN ? classifyingForeign.promise : classifyLikeNative(url)
    );

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    emitNativeEvent({ url: FOREIGN });
    await flushPromises();
    inFlightA.resolve(LINK_A);
    await flushPromises();
    classifyingForeign.resolve(false);
    await flushPromises();

    expect(received(events)).toEqual([`link:${LINK_A.linkId}`]);
  });

  /**
   * The realistic Android order. The newer link's native call cancels the
   * older request at once, so the older cancellation comes back while the
   * newer request is still on the wire, and the older tap has to wait for it.
   */
  it('withholds an older cancellation that arrives before the newer link answers', async () => {
    const events: DeepLinkEvent[] = [];
    const open = new Map<string, ReturnType<typeof held<unknown>>>();
    mockHandleDeepLink.mockImplementation((url: string) => {
      open.get(URL_A)?.reject(cancellation('Network request failed: Canceled'));
      const handle = held<unknown>();
      open.set(url, handle);
      return handle.promise;
    });

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    emitNativeEvent({ url: URL_B });
    await flushPromises();
    expect(received(events)).toEqual([]);

    open.get(URL_B)?.resolve(LINK_B);
    await flushPromises();

    expect(received(events)).toEqual([`link:${LINK_B.linkId}`]);
  });

  /**
   * The order the old code got wrong on the simulator: the older link answers
   * first, while the newer one is still resolving.
   */
  it('withholds an older link that answers before the newer link does', async () => {
    const events: DeepLinkEvent[] = [];
    const open = heldResolves();

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    emitNativeEvent({ url: URL_B });
    await flushPromises();
    open.get(URL_A)?.resolve(LINK_A);
    await flushPromises();
    expect(received(events)).toEqual([]);

    open.get(URL_B)?.resolve(LINK_B);
    await flushPromises();

    expect(received(events)).toEqual([`link:${LINK_B.linkId}`]);
  });

  /**
   * Only a link claimed before an older tap's own answer can silence it. Both
   * natives decide at that answer, so a link tapped afterwards is a later
   * navigation, and a foreign url in between is neither.
   */
  it('keeps a link that answered before a newer link was tapped', async () => {
    const events: DeepLinkEvent[] = [];
    const open = heldResolves();

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    emitNativeEvent({ url: FOREIGN });
    await flushPromises();
    open.get(URL_A)?.resolve(LINK_A);
    await flushPromises();
    emitNativeEvent({ url: URL_C });
    await flushPromises();
    open.get(URL_C)?.resolve(LINK_C);
    await flushPromises();

    expect(open.get(FOREIGN)).toBeUndefined();
    expect(received(events)).toEqual([`link:${LINK_A.linkId}`, `link:${LINK_C.linkId}`]);
  });

  /**
   * The tap counter is never reset. Reset by a reconfigure, a new tap would
   * take the number of the one still in flight, and the two could not be told
   * apart.
   */
  it('keeps counting taps across a configure()', async () => {
    const first: DeepLinkEvent[] = [];
    const second: DeepLinkEvent[] = [];
    const open = heldResolves();

    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: (event) => first.push(event) });
    emitNativeEvent({ url: URL_A });
    await flushPromises();
    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: (event) => second.push(event) });
    emitNativeEvent({ url: URL_B });
    await flushPromises();
    open.get(URL_A)?.resolve(LINK_A);
    await flushPromises();
    open.get(URL_B)?.resolve(LINK_B);
    await flushPromises();

    expect(received(first)).toEqual([]);
    expect(received(second)).toEqual([`link:${LINK_B.linkId}`]);
  });

  /**
   * WL-S04 on React Native is ordered, not raced: the launch link is decided
   * before the deferred check starts and before configure() resolves, and a
   * foreign url arriving in between cannot supersede it.
   *
   * It no longer has to WAIT for that foreign url. This test used to hold the
   * refusal open and assert the launch link stayed undelivered until it came
   * back, because the refusal was the only way to learn the url was foreign.
   * Since warplink-0csz a foreign url is classified before it can claim a tap,
   * so there is no tap for the launch link to wait on, and the deferred check
   * is no longer held up by an unrelated url that was never a link. Both
   * natives are the same: neither ever waits on a url it refused.
   *
   * The ordering the scenario exists to pin is unchanged: the launch link, then
   * the deferred link, then configure() resolving.
   */
  it('decides the launch link before the deferred check, with a foreign url in between', async () => {
    const log: string[] = [];
    const open = heldResolves();
    mockGetInitialURL.mockResolvedValue(URL_A);
    mockIsAttributionComplete.mockResolvedValue(false);
    mockCheckDeferredDeepLink.mockResolvedValue(LINK_DEFERRED);

    const configuring = WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => log.push(...received([event])),
    }).then(() => log.push('configured'));
    await flushPromises();
    emitNativeEvent({ url: FOREIGN });
    await flushPromises();

    // The foreign url reached no resolve at all, so the launch link is still
    // the only thing the deferred check is waiting on.
    expect(open.get(FOREIGN)).toBeUndefined();
    expect(log).toEqual([]);
    expect(mockCheckDeferredDeepLink).not.toHaveBeenCalled();

    open.get(URL_A)?.resolve(LINK_A);
    await configuring;

    expect(log).toEqual([
      `link:${LINK_A.linkId}`,
      `link:${LINK_DEFERRED.linkId}`,
      'configured',
    ]);
  });

  /**
   * The same ordering keeps a throw from onLink on the launch link where
   * configure() promises it: out of the returned promise, never an unhandled
   * rejection. A foreign url arriving in between changes neither half.
   */
  it('rejects configure() with an onLink throw on a launch link decided after a foreign url', async () => {
    const open = heldResolves();
    mockGetInitialURL.mockResolvedValue(URL_A);
    const hostError = new Error('navigation container not mounted');

    const outcome = WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: () => {
        throw hostError;
      },
    }).then(
      () => 'resolved',
      (error: unknown) => error
    );
    await flushPromises();
    emitNativeEvent({ url: FOREIGN });
    await flushPromises();
    open.get(URL_A)?.resolve(LINK_A);

    expect(await outcome).toBe(hostError);
  });

  /**
   * A launch link a newer warm link superseded is dropped, and the deferred
   * check starts once that is known: the host receives the tap it made last
   * and the deferred link, each once.
   */
  it('drops a launch link a newer warm link superseded, then runs the deferred check', async () => {
    const events: DeepLinkEvent[] = [];
    const open = heldResolves();
    mockGetInitialURL.mockResolvedValue(URL_A);
    mockIsAttributionComplete.mockResolvedValue(false);
    mockCheckDeferredDeepLink.mockResolvedValue(LINK_DEFERRED);

    const configuring = WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });
    await flushPromises();
    emitNativeEvent({ url: URL_B });
    await flushPromises();
    open.get(URL_A)?.resolve(LINK_A);
    await flushPromises();
    open.get(URL_B)?.resolve(LINK_B);
    await configuring;

    expect(received(events)).toEqual([
      `link:${LINK_B.linkId}`,
      `link:${LINK_DEFERRED.linkId}`,
    ]);
    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
  });

  /**
   * The launch url arrived before anything configure() will hear, so it is
   * numbered first. Claimed after the native configure and getInitialURL, it
   * was numbered after a warm tap made meanwhile, and silenced the tap the user
   * made last.
   */
  it('numbers the launch link ahead of a warm tap made while the native side configures', async () => {
    const events: DeepLinkEvent[] = [];
    const open = heldResolves();
    const nativeConfigure = held<void>();
    mockConfigure.mockImplementation(() => nativeConfigure.promise);
    mockGetInitialURL.mockResolvedValue(URL_A);

    const configuring = WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });
    await flushPromises();
    emitNativeEvent({ url: URL_B });
    await flushPromises();
    nativeConfigure.resolve();
    await flushPromises();
    open.get(URL_A)?.resolve(LINK_A);
    await flushPromises();
    open.get(URL_B)?.resolve(LINK_B);
    await flushPromises();
    await configuring;

    expect(received(events)).toEqual([`link:${LINK_B.linkId}`]);
  });

  /**
   * The same numbering across a reconfigure: the launch link of a later
   * configure() is newer than a warm tap still in flight from before it.
   */
  it('lets the launch link of a later configure() supersede an older warm tap', async () => {
    const first: DeepLinkEvent[] = [];
    const second: DeepLinkEvent[] = [];
    const open = heldResolves();

    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: (event) => first.push(event) });
    emitNativeEvent({ url: URL_A });
    await flushPromises();
    mockGetInitialURL.mockResolvedValueOnce(URL_C);
    const configuring = WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => second.push(event),
    });
    await flushPromises();
    open.get(URL_C)?.resolve(LINK_C);
    await flushPromises();
    await configuring;
    open.get(URL_A)?.resolve(LINK_A);
    await flushPromises();

    expect(received(first)).toEqual([]);
    expect(received(second)).toEqual([`link:${LINK_C.linkId}`]);
  });
});
