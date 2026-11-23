const mockConfigure = jest.fn();
const mockClearAttribution = jest.fn();
const mockCheckDeferredDeepLink = jest.fn();
const mockIsAttributionComplete = jest.fn();
const mockGetInitialURL = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    WarpLinkModule: {
      configure: mockConfigure,
      clearAttribution: mockClearAttribution,
      checkDeferredDeepLink: mockCheckDeferredDeepLink,
      isAttributionComplete: mockIsAttributionComplete,
      getInitialURL: mockGetInitialURL,
    },
  },
  Platform: { select: jest.fn(() => '') },
  NativeEventEmitter: jest.fn(() => ({
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    removeAllListeners: jest.fn(),
  })),
}));

import { ErrorCodes, type DeepLinkEvent } from '../types';
import { nativeError, nativeMatch } from '../../test-utils/referral-native';
import { settleEventLoop, waitFor } from '../../test-utils/wait-for';

let WarpLink: typeof import('../WarpLink').WarpLink;

const TEST_KEY = 'wl_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const LIVE_KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';

// Every held promise is released after each test with its fallback, so a failed waitFor cannot leave configure() pending.
const releaseAll: Array<() => void> = [];

function held<T>(fallback: T): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  releaseAll.push(() => resolve(fallback));
  return { promise, resolve };
}

describe('clearAttribution', () => {
  let events: DeepLinkEvent[];

  const configureWith = async (apiKey: string, extra = {}): Promise<void> => {
    await WarpLink.configure({ apiKey, onLink: (event) => events.push(event), ...extra });
    events.length = 0;
  };

  afterEach(() => {
    for (const release of releaseAll.splice(0)) release();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    events = [];
    mockConfigure.mockResolvedValue(undefined);
    mockClearAttribution.mockResolvedValue(undefined);
    mockIsAttributionComplete.mockResolvedValue(true);
    mockCheckDeferredDeepLink.mockResolvedValue(null);
    mockGetInitialURL.mockResolvedValue(null);
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      WarpLink = (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
    });
  });

  it('WL-S50 forwards one reset to the native SDK and resolves', async () => {
    await configureWith(TEST_KEY);

    await expect(WarpLink.clearAttribution()).resolves.toBeUndefined();

    expect(mockClearAttribution).toHaveBeenCalledTimes(1);
  });

  it('WL-S50 a live key resolves and delivers nothing', async () => {
    await configureWith(LIVE_KEY);

    await expect(WarpLink.clearAttribution()).resolves.toBeUndefined();
    // Absence check: a live reset starts no check, so nothing announces that one did not run.
    await settleEventLoop();

    expect(mockClearAttribution).toHaveBeenCalledTimes(1);
    expect(mockCheckDeferredDeepLink).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('WL-S51 a Test reset starts a fresh check and delivers its match', async () => {
    await configureWith(TEST_KEY);
    mockCheckDeferredDeepLink.mockResolvedValue(nativeMatch({ linkId: 'fresh-1' }));
    mockIsAttributionComplete.mockResolvedValue(false);

    await WarpLink.clearAttribution();
    await waitFor(() => expect(events).toHaveLength(1));

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.deepLink?.linkId).toBe('fresh-1');
  });

  it('WL-S51 no fresh check when the automatic deferred check is off', async () => {
    await configureWith(TEST_KEY, { automaticDeferredDeepLinks: false });

    await WarpLink.clearAttribution();
    // Absence check: the automatic check is off, so nothing announces that none was started.
    await settleEventLoop();

    expect(mockCheckDeferredDeepLink).not.toHaveBeenCalled();
  });

  it('WL-S51 a check already in flight is discarded by a Test reset', async () => {
    const open = held<unknown>(null);
    mockIsAttributionComplete.mockResolvedValue(false);
    mockCheckDeferredDeepLink.mockReturnValueOnce(open.promise);
    // configure() waits on the open check, so it is awaited only once the check has answered.
    const configuring = WarpLink.configure({ apiKey: TEST_KEY, onLink: (event) => events.push(event) });
    await waitFor(() => expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1));

    await WarpLink.clearAttribution();
    open.resolve(nativeMatch({ linkId: 'stale-1' }));
    await configuring;

    expect(events.map((event) => event.deepLink?.linkId)).not.toContain('stale-1');
  });

  it('WL-S51 a reset while the completion status is pending starts no native check', async () => {
    const status = held<boolean>(false);
    mockIsAttributionComplete.mockReturnValueOnce(status.promise);
    const configuring = WarpLink.configure({ apiKey: TEST_KEY, onLink: (event) => events.push(event) });
    await waitFor(() => expect(mockIsAttributionComplete).toHaveBeenCalledTimes(1));
    mockIsAttributionComplete.mockResolvedValue(true);

    await WarpLink.clearAttribution();
    status.resolve(false);
    await configuring;

    expect(mockCheckDeferredDeepLink).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('WL-S51 a key change while the completion status is pending starts no native check', async () => {
    const status = held<boolean>(false);
    mockIsAttributionComplete.mockReturnValueOnce(status.promise);
    const configuring = WarpLink.configure({ apiKey: TEST_KEY, onLink: (event) => events.push(event) });
    await waitFor(() => expect(mockIsAttributionComplete).toHaveBeenCalledTimes(1));
    mockIsAttributionComplete.mockResolvedValue(true);

    await WarpLink.configure({ apiKey: LIVE_KEY, onLink: (event) => events.push(event) });
    status.resolve(false);
    await configuring;

    expect(mockCheckDeferredDeepLink).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('WL-S51 a check already in flight survives a live reset', async () => {
    const open = held<unknown>(null);
    mockIsAttributionComplete.mockResolvedValue(false);
    mockCheckDeferredDeepLink.mockReturnValueOnce(open.promise);
    // configure() waits on the open check, so it is awaited only once the check has answered.
    const configuring = WarpLink.configure({ apiKey: LIVE_KEY, onLink: (event) => events.push(event) });
    await waitFor(() => expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1));

    await WarpLink.clearAttribution();
    open.resolve(nativeMatch({ linkId: 'live-1' }));
    await configuring;

    expect(events.map((event) => event.deepLink?.linkId)).toEqual(['live-1']);
  });

  it('WL-S52 a storage failure rejects with E_STORAGE_ERROR and keeps the message', async () => {
    await configureWith(TEST_KEY);
    mockClearAttribution.mockRejectedValue(
      nativeError('E_STORAGE_ERROR', 'Could not delete a stored item.')
    );

    await expect(WarpLink.clearAttribution()).rejects.toMatchObject({
      name: 'WarpLinkError',
      code: ErrorCodes.E_STORAGE_ERROR,
      message: 'Could not delete a stored item.',
    });
    // Absence check: a failed reset starts no check, so nothing announces that none was started.
    await settleEventLoop();

    expect(mockCheckDeferredDeepLink).not.toHaveBeenCalled();
  });

  it('WL-S52 a call before configure rejects with E_NOT_CONFIGURED', async () => {
    mockClearAttribution.mockRejectedValue(
      nativeError('E_NOT_CONFIGURED', 'SDK not configured')
    );

    await expect(WarpLink.clearAttribution()).rejects.toMatchObject({
      code: ErrorCodes.E_NOT_CONFIGURED,
    });
  });
});
