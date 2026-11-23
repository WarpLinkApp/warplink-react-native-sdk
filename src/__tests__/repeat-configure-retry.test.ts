const mockConfigure = jest.fn();
const mockCheckDeferredDeepLink = jest.fn();
const mockIsAttributionComplete = jest.fn();
const mockGetDeferredCheckStatus = jest.fn();
const mockGetInitialURL = jest.fn();
const mockIsWarpLinkUrl = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    WarpLinkModule: {
      configure: mockConfigure,
      checkDeferredDeepLink: mockCheckDeferredDeepLink,
      isAttributionComplete: mockIsAttributionComplete,
      getDeferredCheckStatus: mockGetDeferredCheckStatus,
      getInitialURL: mockGetInitialURL,
      isWarpLinkUrl: mockIsWarpLinkUrl,
    },
  },
  Platform: { select: jest.fn((obj: Record<string, string>) => obj['default'] ?? '') },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    removeAllListeners: jest.fn(),
  })),
}));

import type { DeepLinkEvent } from '../types';
import { held } from '../../test-utils/held';
import { settleEventLoop } from '../../test-utils/wait-for';

/**
 * A repeat of the live configure() keeps the session, and still gives an
 * unfinished check one more chance. Native backoff and the age and give-up
 * limits decide whether the call sends a request, so a repeat never adds a
 * rule of its own.
 */
let WarpLink: typeof import('../WarpLink').WarpLink;

const KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';

const LINK = {
  linkId: 'link-1',
  destination: 'https://example.com/promo',
  deepLinkUrl: 'myapp://promo',
  customParams: {},
  isDeferred: true,
  matchType: 'deterministic',
  matchConfidence: 1,
  matchGuaranteed: true,
};

const networkError = (): Error => Object.assign(new Error('offline'), { code: 'E_NETWORK_ERROR' });

beforeEach(() => {
  jest.resetAllMocks();
  mockConfigure.mockResolvedValue(undefined);
  mockIsAttributionComplete.mockResolvedValue(false);
  mockCheckDeferredDeepLink.mockResolvedValue(null);
  mockGetDeferredCheckStatus.mockResolvedValue({ state: 'notChecked' });
  mockGetInitialURL.mockResolvedValue(null);
  mockIsWarpLinkUrl.mockResolvedValue(false);
  jest.isolateModules(() => {
    WarpLink = (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
  });
});

describe('a same-key repeat after the first run finished', () => {
  it('keeps the session and asks native for one more check', async () => {
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });

    expect(mockConfigure).toHaveBeenCalledTimes(1);
    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(2);
  });

  it('sends a match from the retry to the newer onLink', async () => {
    const first: DeepLinkEvent[] = [];
    const second: DeepLinkEvent[] = [];
    await WarpLink.configure({ apiKey: KEY, onLink: (e) => first.push(e) });
    mockCheckDeferredDeepLink.mockResolvedValue(LINK);

    await WarpLink.configure({ apiKey: KEY, onLink: (e) => second.push(e) });

    expect(first).toEqual([]);
    expect(second.map((e) => e.deepLink?.linkId)).toEqual(['link-1']);
  });

  it.each(['matched', 'noMatch', 'checking'] as const)('asks nothing when the status is %s', async (state) => {
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    mockGetDeferredCheckStatus.mockResolvedValue({ state });

    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    await settleEventLoop(); // absence assertion: nothing announces a check that never starts

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ state: 'waiting', retryAt: 1_800_000_000_000 }],
    [{ state: 'skippedOldInstall' }],
    [{ state: 'stopped' }],
  ])('still asks native when the status is %j, so native decides', async (status) => {
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    mockGetDeferredCheckStatus.mockResolvedValue(status);

    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(2);
  });

  it('asks nothing when the deferred check is switched off', async () => {
    await WarpLink.configure({ apiKey: KEY, automaticDeferredDeepLinks: false, onLink: () => {} });
    await WarpLink.configure({ apiKey: KEY, automaticDeferredDeepLinks: false, onLink: () => {} });

    expect(mockGetDeferredCheckStatus).not.toHaveBeenCalled();
    expect(mockCheckDeferredDeepLink).not.toHaveBeenCalled();
  });

  it('shares one retry between repeats that arrive while it runs', async () => {
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    const answer = held<unknown>();
    mockCheckDeferredDeepLink.mockReturnValue(answer.promise);
    const second: DeepLinkEvent[] = [];

    const secondRun = WarpLink.configure({ apiKey: KEY, onLink: (e) => second.push(e) });
    const thirdRun = WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    answer.resolve(null);
    await Promise.all([secondRun, thirdRun]);

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(2);
  });

  it('delivers a failed retry to the newer onLink as an error event', async () => {
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    mockCheckDeferredDeepLink.mockRejectedValue(networkError());
    const events: DeepLinkEvent[] = [];

    await WarpLink.configure({ apiKey: KEY, onLink: (e) => events.push(e) });

    expect(events.map((e) => e.error?.code)).toEqual(['E_NETWORK_ERROR']);
  });
});

describe('a repeat while the first run is still going', () => {
  it('adds no retry: the running check answers', async () => {
    const answer = held<unknown>();
    mockCheckDeferredDeepLink.mockReturnValue(answer.promise);

    const firstRun = WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    const secondRun = WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    answer.resolve(null);
    await Promise.all([firstRun, secondRun]);

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
    expect(mockGetDeferredCheckStatus).not.toHaveBeenCalled();
  });
});
