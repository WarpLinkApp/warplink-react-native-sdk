const mockConfigure = jest.fn();
const mockCheckDeferredDeepLink = jest.fn();
const mockIsAttributionComplete = jest.fn();
const mockGetInitialURL = jest.fn();
const mockIsWarpLinkUrl = jest.fn();

let mockLinked = true;

jest.mock('react-native', () => ({
  NativeModules: {
    get WarpLinkModule() {
      return mockLinked
        ? {
            configure: mockConfigure,
            checkDeferredDeepLink: mockCheckDeferredDeepLink,
            isAttributionComplete: mockIsAttributionComplete,
            getInitialURL: mockGetInitialURL,
            isWarpLinkUrl: mockIsWarpLinkUrl,
          }
        : undefined;
    },
  },
  Platform: { select: jest.fn((obj: Record<string, string>) => obj['default'] ?? '') },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    removeAllListeners: jest.fn(),
  })),
}));

import { held } from '../../test-utils/held';

/**
 * A repeat of a configure() that failed must fail too, and a throw from a
 * repeat caller's own onLink must reach that caller and no other.
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

function load(): void {
  jest.isolateModules(() => {
    WarpLink = (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  mockLinked = true;
  mockConfigure.mockResolvedValue(undefined);
  mockIsAttributionComplete.mockResolvedValue(false);
  mockCheckDeferredDeepLink.mockResolvedValue(null);
  mockGetInitialURL.mockResolvedValue(null);
  mockIsWarpLinkUrl.mockResolvedValue(false);
});

describe('a native module that is not linked', () => {
  it('rejects every identical configure with the linking error', async () => {
    mockLinked = false;
    load();

    await expect(WarpLink.configure({ apiKey: KEY })).rejects.toMatchObject({
      name: 'WarpLinkError',
    });
    await expect(WarpLink.configure({ apiKey: KEY })).rejects.toMatchObject({
      name: 'WarpLinkError',
    });
  });
});

describe('a throw from the repeat caller onLink', () => {
  it('rejects the repeat caller and resolves the first caller', async () => {
    load();
    const answer = held<unknown>();
    mockCheckDeferredDeepLink.mockReturnValue(answer.promise);
    const boom = new Error('router is not mounted');

    const firstRun = WarpLink.configure({ apiKey: KEY, onLink: () => {} });
    const secondRun = WarpLink.configure({
      apiKey: KEY,
      onLink: () => {
        throw boom;
      },
    });
    const outcomes = Promise.allSettled([firstRun, secondRun]);
    answer.resolve(LINK);

    const [first, second] = await outcomes;
    expect(first.status).toBe('fulfilled');
    expect(second).toEqual({ status: 'rejected', reason: boom });
  });

  it('still rejects the first caller when its own onLink throws and nobody repeated', async () => {
    load();
    mockCheckDeferredDeepLink.mockResolvedValue(LINK);
    const boom = new Error('first onLink');

    await expect(
      WarpLink.configure({
        apiKey: KEY,
        onLink: () => {
          throw boom;
        },
      })
    ).rejects.toBe(boom);
  });
});
