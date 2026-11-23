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
import { FAKE_CLOCK_ONLY, settleEventLoop } from '../../test-utils/wait-for';

/**
 * A same-key repeat asks native at most once a minute per process, and never
 * asks twice for a check the first run already started.
 */
let WarpLink: typeof import('../WarpLink').WarpLink;

const KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const TEST_KEY = 'wl_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const MINUTE_MS = 60_000;

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
  jest.useFakeTimers({ doNotFake: FAKE_CLOCK_ONLY });
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

afterEach(() => {
  jest.useRealTimers();
});

const advance = (ms: number): void => {
  jest.setSystemTime(Date.now() + ms);
};

describe('a repeat after a first run that had no onLink', () => {
  it('joins the check the first run started instead of asking native again', async () => {
    const answer = held<unknown>();
    mockCheckDeferredDeepLink.mockReturnValue(answer.promise);
    const events: DeepLinkEvent[] = [];

    await WarpLink.configure({ apiKey: KEY, automaticDeepLinks: false });
    const repeat = WarpLink.configure({
      apiKey: KEY,
      automaticDeepLinks: false,
      onLink: (e) => events.push(e),
    });
    answer.resolve(LINK);
    await repeat;
    await settleEventLoop(); // absence assertion: nothing announces a second delivery

    expect(mockConfigure).toHaveBeenCalledTimes(1);
    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.deepLink?.linkId)).toEqual(['link-1']);
  });
});

describe('the once-a-minute limit on repeats', () => {
  it('asks native on the first repeat and holds back a second one inside the minute', async () => {
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    advance(MINUTE_MS - 1);
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });

    expect(mockConfigure).toHaveBeenCalledTimes(1);
    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(2);
  });

  it('asks again once a minute has passed', async () => {
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    advance(MINUTE_MS);
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(3);
  });

  it('limits a wl_test_ key too', async () => {
    await WarpLink.configure({ apiKey: TEST_KEY, onLink: () => {} });
    await WarpLink.configure({ apiKey: TEST_KEY, onLink: () => {} });
    await WarpLink.configure({ apiKey: TEST_KEY, onLink: () => {} });

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(2);
  });

  it('counts the minute from the last request, not from the last status read', async () => {
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    mockGetDeferredCheckStatus.mockResolvedValue({ state: 'checking' });
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    mockGetDeferredCheckStatus.mockResolvedValue({ state: 'notChecked' });
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(2);
  });

  it('treats a clock that moved backwards as a new minute', async () => {
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    advance(-MINUTE_MS);
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(3);
  });
});

describe('the earlier repeat fixes still hold with a retry', () => {
  it('a failed native configure lets the next call retry and reports the error', async () => {
    mockConfigure.mockRejectedValueOnce(networkError());
    const events: DeepLinkEvent[] = [];

    await WarpLink.configure({ apiKey: KEY, onLink: (e) => events.push(e) });
    await WarpLink.configure({ apiKey: KEY, onLink: (e) => events.push(e) });

    expect(mockConfigure).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.error)).toHaveLength(1);
    expect(mockGetDeferredCheckStatus).not.toHaveBeenCalled();
  });

  it('an onLink that throws on the retry rejects the repeat that passed it', async () => {
    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    mockCheckDeferredDeepLink.mockResolvedValue(LINK);
    const boom = new Error('navigation not ready');

    await expect(
      WarpLink.configure({
        apiKey: KEY,
        onLink: () => {
          throw boom;
        },
      })
    ).rejects.toBe(boom);
  });

  it('a throw from the first caller onLink does not reject a repeat that passed none', async () => {
    const boom = new Error('first callback');
    await WarpLink.configure({
      apiKey: KEY,
      automaticDeepLinks: false,
      onLink: () => {
        throw boom;
      },
    });
    mockCheckDeferredDeepLink.mockResolvedValue(LINK);

    await expect(
      WarpLink.configure({ apiKey: KEY, automaticDeepLinks: false })
    ).resolves.toBeUndefined();
    expect(mockConfigure).toHaveBeenCalledTimes(1);
  });
});
