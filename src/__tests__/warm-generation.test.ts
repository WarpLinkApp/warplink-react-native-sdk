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
 * A warm tap still resolving when configure() runs again belongs to the
 * configuration it arrived under, and is never handed to the new one
 * (warplink-4uzm).
 *
 * The cold and deferred paths already stay silent once their configure() is
 * no longer current (WL-S07, `currentSink(generation)`). The warm path had no
 * such guard: the same automatic handler is registered again by the new
 * configure(), so an answer that arrived after it fanned out to the new sink.
 *
 * Neither native SDK does that. iOS cancels the tap in flight when configure()
 * runs (`WarpLink.swift`, `supersedeInFlightTap()`), so the old answer is
 * silent; Android delivers it to the handler it was claimed under, never to the
 * new one. The bridge follows iOS, the same rule its cold and deferred paths
 * follow: the answer belongs to a configuration that no longer exists.
 */
let WarpLink: typeof import('../WarpLink').WarpLink;

const VALID_LIVE_KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const URL_A = 'https://aplnk.to/rn11-ios7';

const LINK_A = {
  linkId: '18e073e7-09d0-41b4-aeb1-c08a9bb0ca74',
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

function networkError(): Error & { code: string } {
  const error = new Error('Network request failed') as Error & { code: string };
  error.code = ErrorCodes.E_NETWORK_ERROR;
  return error;
}

/** A one-line picture of what a sink received, in order. */
function received(events: DeepLinkEvent[]): string[] {
  return events.map((e) =>
    e.deepLink ? `link:${e.deepLink.linkId}` : `error:${e.error?.code}`
  );
}

describe('a warm tap still resolving across configure() (warplink-4uzm)', () => {
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

  it('does not hand a link that answers after a new configure() to the new onLink', async () => {
    const first: DeepLinkEvent[] = [];
    const second: DeepLinkEvent[] = [];
    const tapA = held<unknown>();
    mockHandleDeepLink.mockImplementation(() => tapA.promise);

    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: (event) => first.push(event) });
    emitNativeEvent({ url: URL_A });
    await flushPromises();
    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: (event) => second.push(event) });
    tapA.resolve(LINK_A);
    await flushPromises();

    expect(received(first)).toEqual([]);
    expect(received(second)).toEqual([]);
  });

  it('does not hand a failure that arrives after a new configure() to the new onLink', async () => {
    const second: DeepLinkEvent[] = [];
    const tapA = held<unknown>();
    mockHandleDeepLink.mockImplementation(() => tapA.promise);

    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: () => undefined });
    emitNativeEvent({ url: URL_A });
    await flushPromises();
    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: (event) => second.push(event) });
    tapA.reject(networkError());
    await flushPromises();

    expect(received(second)).toEqual([]);
  });

  /**
   * The same crossing while the new configure() is still waiting on the native
   * side: the new sink is already registered, and the old tap is still not its.
   */
  it('does not hand it to a configure() that is still configuring', async () => {
    const second: DeepLinkEvent[] = [];
    const tapA = held<unknown>();
    const nativeConfigure = held<void>();
    mockHandleDeepLink.mockImplementation(() => tapA.promise);

    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: () => undefined });
    emitNativeEvent({ url: URL_A });
    await flushPromises();
    mockConfigure.mockImplementationOnce(() => nativeConfigure.promise);
    const configuring = WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => second.push(event),
    });
    tapA.resolve(LINK_A);
    await flushPromises();
    nativeConfigure.resolve();
    await configuring;

    expect(received(second)).toEqual([]);
  });

  /**
   * The guard must not overshoot the other way either. A link that answered
   * while its configure() was current belongs to that onLink, and a foreign url
   * arriving after it changes nothing about that: it supersedes nothing on
   * either native, and since warplink-0csz nothing here either.
   *
   * The foreign url used to be found out from the `E_INVALID_URL` its resolve
   * came back with, so this test held that resolve open across the second
   * configure(). It is classified before it can claim anything now, so it never
   * reaches the native module at all and there is nothing left to hold open.
   * What the two sinks receive is unchanged.
   */
  it('keeps a link that answered before a new configure() for the old onLink while a foreign url arrives', async () => {
    const first: DeepLinkEvent[] = [];
    const second: DeepLinkEvent[] = [];
    const tapA = held<unknown>();
    mockHandleDeepLink.mockImplementation((url: string) => {
      if (url === URL_A) return tapA.promise;
      throw new Error(`unexpected resolve of: ${url}`);
    });

    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: (event) => first.push(event) });
    emitNativeEvent({ url: URL_A });
    emitNativeEvent({ url: 'myapp://oauth/callback' });
    await flushPromises();
    tapA.resolve(LINK_A);
    await flushPromises();
    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: (event) => second.push(event) });
    await flushPromises();

    expect(mockIsWarpLinkUrl).toHaveBeenCalledWith('myapp://oauth/callback');
    expect(received(first)).toEqual([`link:${LINK_A.linkId}`]);
    expect(received(second)).toEqual([]);
  });

  /** The guard must not overshoot: a tap made after the new configure() is its own. */
  it('delivers a tap made after the new configure() to the new onLink', async () => {
    const first: DeepLinkEvent[] = [];
    const second: DeepLinkEvent[] = [];
    mockHandleDeepLink.mockResolvedValue(LINK_A);

    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: (event) => first.push(event) });
    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: (event) => second.push(event) });
    emitNativeEvent({ url: URL_A });
    await flushPromises();

    expect(received(first)).toEqual([]);
    expect(received(second)).toEqual([`link:${LINK_A.linkId}`]);
  });

  /**
   * Explicit onDeepLink() subscribers are not the automatic path and are not
   * tied to a configure(): they still receive the answer.
   */
  it('still hands the answer to an explicit onDeepLink() subscriber', async () => {
    const explicit: DeepLinkEvent[] = [];
    const tapA = held<unknown>();
    mockHandleDeepLink.mockImplementation(() => tapA.promise);

    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: () => undefined });
    WarpLink.onDeepLink((event) => explicit.push(event));
    emitNativeEvent({ url: URL_A });
    await flushPromises();
    await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: () => undefined });
    tapA.resolve(LINK_A);
    await flushPromises();

    expect(received(explicit)).toEqual([`link:${LINK_A.linkId}`]);
  });
});
