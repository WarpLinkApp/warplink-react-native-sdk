const mockConfigure = jest.fn();
const mockHandleDeepLink = jest.fn();
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

/**
 * A launch link belongs to the configure() its answer arrived under
 * (warplink-5q3f).
 *
 * Since #314 the launch link waits, before it is delivered, for any newer tap
 * still resolving, because only that tap's answer says whether it was a link
 * that supersedes the launch link or a foreign url that does not. The sink was
 * taken after that wait, so a second configure() landing inside it dropped a
 * launch link that had already answered. Nothing recovers it: the launch url is
 * handed out once (iOS `takePendingURL`, Android `InitialUrlBuffer.settle`), so
 * the second configure()'s getInitialURL returns null.
 *
 * Both natives decide a tap at its answer, and refuse a foreign url before it
 * can claim anything (iOS `WarpLink+Resolve.swift`, the universal link guard
 * ahead of `supersedeInFlightTap()`; Android `AutoLinkHandler.dispatch`, which
 * returns on `!isWarpLinkUri` before `claimLocked`), so both deliver it to the
 * first configure()'s onLink.
 */
let WarpLink: typeof import('../WarpLink').WarpLink;

const VALID_LIVE_KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const URL_A = 'https://aplnk.to/rn11-ios7';
const URL_B = 'https://aplnk.to/rn11-ios27';
const FOREIGN = 'myapp://oauth/callback';

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

const LINK_A = link('18e073e7-09d0-41b4-aeb1-c08a9bb0ca74');
const LINK_B = link('666d04ab-bcb1-41ce-bfa0-b2503a74ab05');

/** Holds a promise open until the test settles it. */
function held<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  const handle = {} as { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
  handle.promise = new Promise<T>((resolve, reject) => {
    handle.resolve = resolve;
    handle.reject = reject;
  });
  return handle;
}

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

function invalidUrl(): Error & { code: string } {
  const error = new Error('Invalid URL') as Error & { code: string };
  error.code = ErrorCodes.E_INVALID_URL;
  return error;
}

/** A one-line picture of what a sink received, in order. */
function received(events: DeepLinkEvent[]): string[] {
  return events.map((e) =>
    e.deepLink ? `link:${e.deepLink.linkId}` : `error:${e.error?.code}`
  );
}

describe('a launch link across a second configure() (warplink-5q3f)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
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

  it('keeps a launch link that answered for the first onLink while a foreign url is refused', async () => {
    const first: DeepLinkEvent[] = [];
    const second: DeepLinkEvent[] = [];
    const open = heldResolves();
    mockGetInitialURL.mockResolvedValueOnce(URL_A);

    const configuring = WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => first.push(event),
    });
    await flushPromises();
    emitNativeEvent({ url: FOREIGN });
    await flushPromises();
    open.get(URL_A)?.resolve(LINK_A);
    await flushPromises();
    const reconfiguring = WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => second.push(event),
    });
    await flushPromises();
    open.get(FOREIGN)?.reject(invalidUrl());
    await Promise.all([configuring, reconfiguring]);

    expect(received(first)).toEqual([`link:${LINK_A.linkId}`]);
    expect(received(second)).toEqual([]);
  });

  /**
   * The same crossing, with a throw from the first onLink: it still leaves
   * through the first configure(), as that configure() promises.
   */
  it('rejects the first configure() with a throw from its onLink on that launch link', async () => {
    const open = heldResolves();
    mockGetInitialURL.mockResolvedValueOnce(URL_A);
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
    await flushPromises();
    const reconfiguring = WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: () => undefined });
    await flushPromises();
    open.get(FOREIGN)?.reject(invalidUrl());
    await reconfiguring;

    expect(await outcome).toBe(hostError);
  });

  /**
   * The guard must not overshoot. A launch link still resolving when the second
   * configure() lands was never answered under the first, and belongs to
   * neither: iOS cancels it in that configure(), and the WL-S07 rule already
   * held here.
   */
  it('drops a launch link that answers after the second configure()', async () => {
    const first: DeepLinkEvent[] = [];
    const second: DeepLinkEvent[] = [];
    const open = heldResolves();
    mockGetInitialURL.mockResolvedValueOnce(URL_A);

    const configuring = WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => first.push(event),
    });
    await flushPromises();
    const reconfiguring = WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => second.push(event),
    });
    await flushPromises();
    open.get(URL_A)?.resolve(LINK_A);
    await Promise.all([configuring, reconfiguring]);

    expect(received(first)).toEqual([]);
    expect(received(second)).toEqual([]);
  });

  /** A newer link still supersedes the launch link across the second configure(). */
  it('still drops a launch link a newer warm link superseded', async () => {
    const first: DeepLinkEvent[] = [];
    const open = heldResolves();
    mockGetInitialURL.mockResolvedValueOnce(URL_A);

    const configuring = WarpLink.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (event) => first.push(event),
    });
    await flushPromises();
    emitNativeEvent({ url: URL_B });
    await flushPromises();
    open.get(URL_A)?.resolve(LINK_A);
    await flushPromises();
    const reconfiguring = WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink: () => undefined });
    await flushPromises();
    open.get(URL_B)?.resolve(LINK_B);
    await Promise.all([configuring, reconfiguring]);

    expect(received(first)).not.toContain(`link:${LINK_A.linkId}`);
  });
});
