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
 * Configure twice with the same key and options is one session.
 *
 * Android and iOS 1.4.0 ignore a repeated configure and keep the check that is
 * running. The wrapper turns the native automatic check off and drives the
 * check itself, so it has to hold the same rule: no second native configure and
 * no second native check. A different key or different options still rebuilds.
 */
let WarpLink: typeof import('../WarpLink').WarpLink;

const KEY_A = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const KEY_B = 'wl_live_b1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';

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

beforeEach(() => {
  jest.resetAllMocks();
  mockConfigure.mockResolvedValue(undefined);
  mockIsAttributionComplete.mockResolvedValue(false);
  mockCheckDeferredDeepLink.mockResolvedValue(null);
  mockGetDeferredCheckStatus.mockResolvedValue({ state: 'noMatch' });
  mockGetInitialURL.mockResolvedValue(null);
  mockIsWarpLinkUrl.mockResolvedValue(false);
  jest.isolateModules(() => {
    WarpLink = (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
  });
});

describe('a repeated configure with the same key and options', () => {
  it('configures native once and checks once', async () => {
    await WarpLink.configure({ apiKey: KEY_A, onLink: () => {} });
    await WarpLink.configure({ apiKey: KEY_A, onLink: () => {} });

    expect(mockConfigure).toHaveBeenCalledTimes(1);
    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
    expect(mockGetInitialURL).toHaveBeenCalledTimes(1);
  });

  it('keeps the check that is running and sends its answer to the newer onLink', async () => {
    const answer = held<unknown>();
    mockCheckDeferredDeepLink.mockReturnValue(answer.promise);
    const first: DeepLinkEvent[] = [];
    const second: DeepLinkEvent[] = [];

    const firstRun = WarpLink.configure({ apiKey: KEY_A, onLink: (e) => first.push(e) });
    const secondRun = WarpLink.configure({ apiKey: KEY_A, onLink: (e) => second.push(e) });
    answer.resolve(LINK);
    await Promise.all([firstRun, secondRun]);

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
    expect(first).toEqual([]);
    expect(second.map((e) => e.deepLink?.linkId)).toEqual(['link-1']);
  });

  it('does nothing when the check has already finished', async () => {
    mockCheckDeferredDeepLink.mockResolvedValue(LINK);
    mockGetDeferredCheckStatus.mockResolvedValue({ state: 'matched' });
    const first: DeepLinkEvent[] = [];
    const second: DeepLinkEvent[] = [];

    await WarpLink.configure({ apiKey: KEY_A, onLink: (e) => first.push(e) });
    await WarpLink.configure({ apiKey: KEY_A, onLink: (e) => second.push(e) });
    await settleEventLoop(); // absence assertion: nothing announces a check that never starts

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
  });
});

describe('a configure that is not a repeat', () => {
  it('rebuilds for a different key', async () => {
    await WarpLink.configure({ apiKey: KEY_A, onLink: () => {} });
    await WarpLink.configure({ apiKey: KEY_B, onLink: () => {} });

    expect(mockConfigure).toHaveBeenCalledTimes(2);
    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(2);
  });

  it('rebuilds for different options', async () => {
    await WarpLink.configure({ apiKey: KEY_A, onLink: () => {} });
    await WarpLink.configure({ apiKey: KEY_A, debugLogging: true, onLink: () => {} });

    expect(mockConfigure).toHaveBeenCalledTimes(2);
    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(2);
  });

  it('retries after native refused the first configure', async () => {
    mockConfigure.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'E_NETWORK_ERROR' }));
    const events: DeepLinkEvent[] = [];

    await WarpLink.configure({ apiKey: KEY_A, onLink: (e) => events.push(e) });
    await WarpLink.configure({ apiKey: KEY_A, onLink: (e) => events.push(e) });

    expect(mockConfigure).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.error)).toHaveLength(1);
    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
  });

  it('shares the native failure with a repeat that arrives while native is still configuring', async () => {
    const native = held<void>();
    mockConfigure.mockReturnValue(native.promise);

    const firstRun = WarpLink.configure({ apiKey: KEY_A });
    const secondRun = WarpLink.configure({ apiKey: KEY_A });
    native.reject(Object.assign(new Error('no'), { code: 'E_NETWORK_ERROR' }));

    await expect(firstRun).rejects.toMatchObject({ name: 'WarpLinkError' });
    await expect(secondRun).rejects.toMatchObject({ name: 'WarpLinkError' });
    expect(mockConfigure).toHaveBeenCalledTimes(1);
  });
});
