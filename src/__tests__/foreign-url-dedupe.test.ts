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
 * A foreign url must not stamp the dedupe window (warplink-0csz).
 *
 * `shouldAutoDispatch` used to stamp `(lastAutoUrl, lastAutoAt)` the instant ANY
 * url arrived, before anything had said whether it was a WarpLink link or a
 * foreign one (an OAuth callback, an unrelated custom scheme). Once a foreign
 * url arrived it held that stamp for the rest of the window, so a re-tap of the
 * link tapped just before it no longer matched and read as a fresh navigation:
 * two resolves, two tap ids, two clicks billed for one tap.
 *
 * Neither native SDK can reach that state, because each knows what a url is
 * BEFORE it touches its claim:
 * - Android `AutoLinkHandler.dispatch` returns on `!isWarpLinkUri(uri)` before
 *   `claimLocked` ever runs (`AutoLinkHandler.kt`).
 * - iOS `open()` returns on `!isWarpLinkURL(url)` before
 *   `shouldSuppressDuplicate` ever runs (`WarpLink+Resolve.swift`).
 *
 * The fix gives this layer the same check to ask, as
 * `NativeWarpLink.isWarpLinkUrl`, and asks it FIRST. A foreign url now stamps
 * nothing, claims no tap, supersedes nothing, and never reaches the automatic
 * sink. Arrivals are serialized through one queue, so each classification has
 * settled before the next arrival decides anything.
 *
 * An earlier attempt stamped at arrival and tried to restore the previous stamp
 * once `E_INVALID_URL` came back. Scenarios (b) and (e) below are the two it
 * could not satisfy, and are why the classification has to come first.
 *
 * Bead: warplink-0csz.
 */
let WarpLink: typeof import('../WarpLink').WarpLink;

const VALID_LIVE_KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const URL_A = 'https://aplnk.to/rn0csz-a';
const URL_B = 'https://aplnk.to/rn0csz-b';
const URL_LAUNCH = 'https://aplnk.to/rn0csz-launch';

/** OAuth callbacks: they reach the bridge like any url, and are not WarpLink links. */
const FOREIGN = 'myapp://oauth/callback';
const FOREIGN_2 = 'myapp://oauth/other';

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

const LINK_A = link('a1a1a1a1-1111-4a1a-8a1a-a1a1a1a1a1a1');
const LINK_B = link('b2b2b2b2-2222-4b2b-8b2b-b2b2b2b2b2b2');

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

/** A one-line picture of what the host received, in order. */
function received(events: DeepLinkEvent[]): string[] {
  return events.map((e) =>
    e.deepLink ? `link:${e.deepLink.linkId}` : `error:${e.error?.code}`
  );
}

/** How many times the native module was asked to resolve `url`. */
function resolvesOf(url: string): number {
  return mockHandleDeepLink.mock.calls.filter(([called]) => called === url)
    .length;
}

describe('a foreign url does not stamp the dedupe window (warplink-0csz)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockConfigure.mockResolvedValue(undefined);
    mockIsAttributionComplete.mockResolvedValue(true);
    mockGetInitialURL.mockResolvedValue(null);
    mockIsWarpLinkUrl.mockImplementation(classifyLikeNative);
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

  afterEach(() => {
    // Scoped here rather than per test: only the wedged-classification test
    // fakes timers, and every other test needs real ones for flushPromises'
    // setImmediate loop.
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** (a) The bead's own repro: A, a foreign url, then A again inside the window. */
  it('resolves A once when a foreign url arrives between two taps of A 500ms apart', async () => {
    const events: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    mockHandleDeepLink.mockImplementation((url: string) => {
      if (url === URL_A) return Promise.resolve(LINK_A);
      throw new Error(`unexpected resolve of: ${url}`);
    });

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();

    nowSpy.mockReturnValue(1200);
    emitNativeEvent({ url: FOREIGN });
    await flushPromises();

    // 500ms after the FIRST tap of A, well inside the 1500ms window that tap
    // stamped. The foreign url in between must not have reset it.
    nowSpy.mockReturnValue(1500);
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    expect(resolvesOf(URL_A)).toBe(1);
    expect(received(events)).toEqual([`link:${LINK_A.linkId}`]);
  });

  /**
   * (b) The sequence no after-the-fact restore can fix, and the reason
   * classification has to come first.
   *
   * A is still resolving when the foreign url arrives, and A is tapped again
   * before that foreign url has been classified. Stamping at arrival put the
   * foreign url in the window at exactly that moment, so the second A read as
   * fresh and resolved again: the bead's exact bug, one tap billed twice. No
   * later restore can undo it, because the damage is done while the foreign url
   * still owns the window.
   */
  it('suppresses a re-tap of A that arrives before a foreign url has been classified', async () => {
    const events: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
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
    await flushPromises();

    nowSpy.mockReturnValue(1200);
    emitNativeEvent({ url: FOREIGN });
    await flushPromises();

    // The re-tap lands while the foreign url is still unclassified.
    nowSpy.mockReturnValue(1300);
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    classifyingForeign.resolve(false);
    await flushPromises();
    inFlightA.resolve(LINK_A);
    await flushPromises();

    expect(resolvesOf(URL_A)).toBe(1);
    expect(received(events)).toEqual([`link:${LINK_A.linkId}`]);
  });

  /**
   * (c) A real link claims the window outright, and a foreign url classified
   * afterwards must not hand it back.
   *
   * Both natives keep ONE global slot, not a per-url map:
   * `AutoLinkHandler.claimLocked` overwrites `lastUri`/`lastAt` unconditionally
   * once the equality-and-window check fails, and `shouldSuppressDuplicate`
   * does the same to `lastHandledURLString`/`lastHandledURLAt`. So B's tap owns
   * the window, and a later A is a fresh navigation on both natives.
   */
  it('leaves a later real link holding the stamp when a foreign url is classified after it', async () => {
    const events: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const classifyingForeign = held<boolean>();
    mockHandleDeepLink.mockImplementation((url: string) => {
      if (url === URL_A) return Promise.resolve(LINK_A);
      if (url === URL_B) return Promise.resolve(LINK_B);
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
    await flushPromises();

    nowSpy.mockReturnValue(1100);
    emitNativeEvent({ url: FOREIGN });
    await flushPromises();

    // B is queued behind the unclassified foreign url; releasing it lets both
    // through, in arrival order, and B ends up owning the window.
    nowSpy.mockReturnValue(1200);
    emitNativeEvent({ url: URL_B });
    classifyingForeign.resolve(false);
    await flushPromises();

    // Inside B's own window, so a repeat of B is still suppressed.
    nowSpy.mockReturnValue(1300);
    emitNativeEvent({ url: URL_B });
    await flushPromises();

    // A is no longer the window's url, so this is a fresh navigation.
    nowSpy.mockReturnValue(1700);
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    expect(resolvesOf(URL_B)).toBe(1);
    expect(resolvesOf(URL_A)).toBe(2);
    expect(received(events)).toEqual([
      `link:${LINK_A.linkId}`,
      `link:${LINK_B.linkId}`,
      `link:${LINK_A.linkId}`,
    ]);
  });

  /**
   * (d) A different REAL link legitimately resets the window, here as on
   * native, for the single-slot reason spelled out in (c). This case never
   * involved a foreign url and must not change.
   */
  it('still resolves A twice when a different real link B arrives in between', async () => {
    const events: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    mockHandleDeepLink.mockImplementation((url: string) => {
      if (url === URL_A) return Promise.resolve(LINK_A);
      if (url === URL_B) return Promise.resolve(LINK_B);
      throw new Error(`unexpected resolve of: ${url}`);
    });

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();

    nowSpy.mockReturnValue(1200);
    emitNativeEvent({ url: URL_B });
    await flushPromises();

    nowSpy.mockReturnValue(1500);
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    expect(resolvesOf(URL_A)).toBe(2);
    expect(received(events)).toEqual([
      `link:${LINK_A.linkId}`,
      `link:${LINK_B.linkId}`,
      `link:${LINK_A.linkId}`,
    ]);
  });

  /**
   * (e) Two foreign urls in flight at once, the other sequence a stamp-restore
   * could not fix: whichever settled first handed the window to the OTHER
   * foreign url rather than back to A. Classified first, neither ever holds it.
   *
   * Run in both settlement orders, because the broken shape was asymmetric.
   */
  it.each([
    ['first-in first-out', [0, 1]],
    ['last-in first-out', [1, 0]],
  ])('resolves A once when two foreign urls settle %s', async (_name, order) => {
    const events: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const foreigns = [FOREIGN, FOREIGN_2];
    const classifying = new Map([
      [FOREIGN, held<boolean>()],
      [FOREIGN_2, held<boolean>()],
    ]);
    mockHandleDeepLink.mockImplementation((url: string) => {
      if (url === URL_A) return Promise.resolve(LINK_A);
      throw new Error(`unexpected resolve of: ${url}`);
    });
    mockIsWarpLinkUrl.mockImplementation((url: string) => {
      const pending = classifying.get(url);
      return pending ? pending.promise : classifyLikeNative(url);
    });

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();

    nowSpy.mockReturnValue(1100);
    emitNativeEvent({ url: FOREIGN });
    nowSpy.mockReturnValue(1200);
    emitNativeEvent({ url: FOREIGN_2 });
    await flushPromises();

    for (const index of order as number[]) {
      classifying.get(foreigns[index] as string)?.resolve(false);
      await flushPromises();
    }

    nowSpy.mockReturnValue(1500);
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    expect(resolvesOf(URL_A)).toBe(1);
    expect(received(events)).toEqual([`link:${LINK_A.linkId}`]);
  });

  /**
   * (f) A foreign url on its own, with only the automatic sink wired. There is
   * nobody to deliver it to, so nothing is resolved at all: the native module
   * is asked what the url is, and that is the end of it. Both natives do
   * exactly this.
   */
  it('never resolves a foreign url when only the automatic sink is wired', async () => {
    const events: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    mockHandleDeepLink.mockImplementation((url: string) => {
      if (url === URL_A) return Promise.resolve(LINK_A);
      throw new Error(`unexpected resolve of: ${url}`);
    });

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: FOREIGN });
    await flushPromises();

    expect(mockIsWarpLinkUrl).toHaveBeenCalledWith(FOREIGN);
    expect(mockHandleDeepLink).not.toHaveBeenCalled();
    expect(events).toEqual([]);

    // It stamped nothing and claimed nothing, so the link tapped next is a
    // first arrival: it resolves, and nothing silences it.
    nowSpy.mockReturnValue(1100);
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    expect(resolvesOf(URL_A)).toBe(1);
    expect(received(events)).toEqual([`link:${LINK_A.linkId}`]);
  });

  /**
   * (g) A failed resolve clears the stamp (warplink-l2vc), and a foreign url
   * afterwards must not put anything in its place. The user's own re-tap has to
   * reach the native module.
   */
  it('reaches native again for a re-tap after a failed resolve and a foreign url', async () => {
    const events: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    mockHandleDeepLink
      .mockRejectedValueOnce(nativeError(ErrorCodes.E_NETWORK_ERROR, 'offline'))
      .mockResolvedValueOnce(LINK_A);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    nowSpy.mockReturnValue(1100);
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    nowSpy.mockReturnValue(1200);
    emitNativeEvent({ url: FOREIGN });
    await flushPromises();

    nowSpy.mockReturnValue(1600);
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    expect(resolvesOf(URL_A)).toBe(2);
    expect(received(events)).toEqual([
      `error:${ErrorCodes.E_NETWORK_ERROR}`,
      `link:${LINK_A.linkId}`,
    ]);
  });

  /**
   * (h) Two real taps 10ms apart. Classification is a native round trip now, so
   * the second arrival decides after an await, and it still has to see the
   * window the first one stamped. That is what the arrival queue is for.
   */
  it('resolves once for two taps of the same link 10ms apart', async () => {
    const events: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    mockHandleDeepLink.mockResolvedValue(LINK_A);

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    nowSpy.mockReturnValue(1010);
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    expect(resolvesOf(URL_A)).toBe(1);
    expect(received(events)).toEqual([`link:${LINK_A.linkId}`]);
  });

  /**
   * The queue's other job: arrivals are admitted in the order they arrived, not
   * in the order the native module happens to answer.
   *
   * A is classified slowly and B quickly. Unqueued, B would take the window
   * first and A would then overwrite it with its own, older, url, and a repeat
   * of B inside the window would read as fresh and resolve a second time.
   */
  it('admits arrivals in order even when a later classification answers first', async () => {
    const events: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const classifyingA = held<boolean>();
    mockHandleDeepLink.mockImplementation((url: string) =>
      Promise.resolve(url === URL_A ? LINK_A : LINK_B)
    );
    mockIsWarpLinkUrl.mockImplementation((url: string) =>
      url === URL_A ? classifyingA.promise : classifyLikeNative(url)
    );

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    nowSpy.mockReturnValue(1010);
    emitNativeEvent({ url: URL_B });
    await flushPromises();

    classifyingA.resolve(true);
    await flushPromises();

    // B arrived last, so B owns the window: a repeat of B is a duplicate.
    nowSpy.mockReturnValue(1100);
    emitNativeEvent({ url: URL_B });
    await flushPromises();

    expect(resolvesOf(URL_A)).toBe(1);
    expect(resolvesOf(URL_B)).toBe(1);
    expect(events.length).toBeGreaterThan(0);
  });

  /**
   * (i) The manual API keeps Task 3's contract (warplink-17r7): a manual
   * resolve claims a silent tap to supersede the automatic tap its native call
   * cancels. A FOREIGN manual url cancels nothing on either platform, so it
   * claims nothing, and the automatic tap in flight still delivers its link.
   */
  it('claims no tap for a manual handleDeepLink on a foreign url', async () => {
    const events: DeepLinkEvent[] = [];
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    const inFlightA = held<unknown>();
    mockHandleDeepLink.mockImplementation((url: string) =>
      url === FOREIGN
        ? Promise.reject(nativeError(ErrorCodes.E_INVALID_URL, 'Invalid URL'))
        : inFlightA.promise
    );

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();

    // The manual caller still gets the native module's own refusal.
    await expect(WarpLink.handleDeepLink(FOREIGN)).rejects.toMatchObject({
      name: 'WarpLinkError',
      code: ErrorCodes.E_INVALID_URL,
    });

    inFlightA.resolve(LINK_A);
    await flushPromises();

    expect(received(events)).toEqual([`link:${LINK_A.linkId}`]);
  });

  /**
   * The dedupe window belongs to the moment the url ARRIVED, not the moment
   * the native module got round to saying what it was.
   *
   * Both natives read their clock synchronously with the arrival, inside the
   * same call that claims (`AutoLinkHandler.claimLocked`,
   * `shouldSuppressDuplicate`). Classification put an await in front of that
   * read here, so a slow answer moved the comparison AND the new stamp later.
   * A duplicate that arrived 300 ms after the first, classified 1600 ms after
   * arriving, then measured 1900 ms against the window and resolved a second
   * time: the same double billing warplink-0csz is about, reached by the clock
   * instead of by a foreign url.
   */
  it('does not let a slow classification turn a duplicate into a fresh navigation', async () => {
    const events: DeepLinkEvent[] = [];
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const classifyingRetap = held<boolean>();
    let asked = 0;
    mockHandleDeepLink.mockResolvedValue(LINK_A);
    mockIsWarpLinkUrl.mockImplementation((url: string) => {
      asked += 1;
      // The second arrival is the one the native module is slow about.
      return asked === 2 ? classifyingRetap.promise : classifyLikeNative(url);
    });

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    });

    emitNativeEvent({ url: URL_A });
    await flushPromises();

    // The re-tap ARRIVES 300ms later, well inside the 1500ms window.
    nowSpy.mockReturnValue(1300);
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    // The native module answers 1600ms after that, so the clock is now past
    // the window the first tap stamped.
    nowSpy.mockReturnValue(2900);
    classifyingRetap.resolve(true);
    await flushPromises();

    expect(resolvesOf(URL_A)).toBe(1);
    expect(received(events)).toEqual([`link:${LINK_A.linkId}`]);
  });
});

/**
 * A link check that never answers must not wedge everything behind it.
 *
 * Arrivals are serialized, so the classification of the url at the head of the
 * queue gates every later one. `arrivalsSettled` was bounded by the supersede
 * ceiling from the start, but the admission path was not: `classifyUrl` simply
 * awaited the native promise. A native module that accepted the call and never
 * answered therefore stopped the single chain for good. Every later warm url
 * was never classified, never resolved and never delivered, and a launch link
 * queued behind it never resolved either, so `configure()` never settled.
 *
 * The wait is now bounded, and fails OPEN: an unanswered check is treated as a
 * link, exactly as `classifyUrl` already treats a rejection, so a real link is
 * never dropped because the check went missing.
 *
 * The bound is `CLASSIFY_CEILING_MS`, its own and far shorter than the
 * supersede ceiling, because a link check is a synchronous computation on both
 * platforms and only the bridge hop is in front of it. Fifteen seconds of held
 * launch link, and held `configure()`, was not a proportionate price for a
 * question nothing can answer slowly.
 */
describe('an unanswered link check cannot wedge the arrival queue (warplink-0csz)', () => {
  /**
   * Mirrors `CLASSIFY_CEILING_MS` in `src/WarpLink.ts`, which is module
   * private. Same arrangement as the 15_000 the warplink-17r7 ceiling tests
   * carry for `SUPERSEDE_WAIT_CEILING_MS`: a constant exported only for a test
   * to read would be a worse trade than one line kept in step.
   */
  const CLASSIFY_CEILING_MS = 2_000;

  beforeEach(() => {
    jest.resetAllMocks();
    mockIsAttributionComplete.mockResolvedValue(true);
    mockIsWarpLinkUrl.mockImplementation(classifyLikeNative);
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

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('admits the wedged url as a link past the ceiling, and everything queued behind it', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const events: DeepLinkEvent[] = [];
    const nativeConfigure = held<undefined>();
    const wedged = held<boolean>();
    mockConfigure.mockReturnValue(nativeConfigure.promise);
    mockGetInitialURL.mockResolvedValue(URL_LAUNCH);
    mockHandleDeepLink.mockResolvedValue(LINK_A);
    mockIsWarpLinkUrl.mockImplementation((url: string) =>
      url === URL_B ? wedged.promise : classifyLikeNative(url)
    );

    let configured = false;
    const configuring = WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => events.push(event),
    }).then(() => {
      configured = true;
    });

    // The warm listener is registered synchronously, so this url arrives while
    // the native side is still configuring, and takes the head of the queue.
    await flushPromises();
    emitNativeEvent({ url: URL_B });
    await flushPromises();

    // The launch link is queued behind it, and a later warm url behind that.
    nativeConfigure.resolve(undefined);
    await flushPromises();
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    expect(mockHandleDeepLink).not.toHaveBeenCalled();
    expect(configured).toBe(false);

    // Just short of the ceiling, nothing has been given up on yet.
    jest.advanceTimersByTime(CLASSIFY_CEILING_MS - 1);
    await flushPromises();
    expect(mockHandleDeepLink).not.toHaveBeenCalled();
    expect(configured).toBe(false);

    jest.advanceTimersByTime(1);
    await flushPromises();
    await configuring;

    // Failed open: the url nobody would classify is treated as a link.
    expect(resolvesOf(URL_B)).toBe(1);
    expect(resolvesOf(URL_LAUNCH)).toBe(1);
    expect(resolvesOf(URL_A)).toBe(1);
    expect(configured).toBe(true);
  });

  /**
   * The bound is per arrival, not per queue, so k wedged checks in a row cost k
   * ceilings. That is the known limit of bounding each classification on its
   * own, and it is asserted rather than assumed: with three wedged urls ahead
   * of it, a fourth arrival waits three ceilings and no longer.
   *
   * Three simultaneously wedged checks means the native module is not answering
   * at all, at which point nothing else works either. What matters is that the
   * queue still drains, in a time the reader can compute.
   */
  it('costs one ceiling per wedged check, so three of them delay the next by three', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    const wedgedUrls = [
      'https://aplnk.to/rn0csz-w1',
      'https://aplnk.to/rn0csz-w2',
      'https://aplnk.to/rn0csz-w3',
    ];
    const neverAnswers = new Promise<boolean>(() => undefined);
    mockConfigure.mockResolvedValue(undefined);
    mockGetInitialURL.mockResolvedValue(null);
    mockHandleDeepLink.mockResolvedValue(LINK_A);
    mockIsWarpLinkUrl.mockImplementation((url: string) =>
      wedgedUrls.includes(url) ? neverAnswers : classifyLikeNative(url)
    );

    await WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: () => undefined,
    });

    for (const url of wedgedUrls) {
      emitNativeEvent({ url });
    }
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    expect(mockHandleDeepLink).not.toHaveBeenCalled();

    // Each ceiling only starts once the arrival ahead of it has been given up
    // on, so the clock has to be advanced one ceiling at a time.
    for (const [index, url] of wedgedUrls.entries()) {
      jest.advanceTimersByTime(CLASSIFY_CEILING_MS);
      await flushPromises();
      expect(resolvesOf(url)).toBe(1);
      // The arrival behind all three waits for the last of them, and no longer.
      expect(resolvesOf(URL_A)).toBe(index === wedgedUrls.length - 1 ? 1 : 0);
    }
  });
});
