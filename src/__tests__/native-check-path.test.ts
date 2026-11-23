const mockConfigure = jest.fn();
const mockCheckDeferredDeepLink = jest.fn();
const mockIsAttributionComplete = jest.fn();
const mockGetInitialURL = jest.fn();
const mockIsWarpLinkUrl = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    WarpLinkModule: {
      configure: mockConfigure,
      checkDeferredDeepLink: mockCheckDeferredDeepLink,
      isAttributionComplete: mockIsAttributionComplete,
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

import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { DeepLinkEvent } from '../types';

/**
 * The traffic rules of SDK 1.4.0 (install age, backoff, foreground wait, give
 * up) sit in the native check path. This package turns the native automatic
 * check off and drives the check by hand, so it inherits those rules only while
 * every deferred check goes through the native `checkDeferredDeepLink`, once,
 * with no gate, retry or request of its own.
 */
let WarpLink: typeof import('../WarpLink').WarpLink;

const KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const root = resolve(__dirname, '..', '..');
const read = (file: string): string => readFileSync(resolve(root, file), 'utf8');

beforeEach(() => {
  jest.resetAllMocks();
  mockConfigure.mockResolvedValue(undefined);
  mockIsAttributionComplete.mockResolvedValue(false);
  mockCheckDeferredDeepLink.mockResolvedValue(null);
  mockGetInitialURL.mockResolvedValue(null);
  mockIsWarpLinkUrl.mockResolvedValue(false);
  jest.isolateModules(() => {
    WarpLink = (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
  });
});

describe('the automatic check from configure()', () => {
  it('asks the native check once and sends no request of its own', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in this test'));

    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('leaves a failure to the native backoff: one call, one error, no retry here', async () => {
    mockCheckDeferredDeepLink.mockRejectedValue(
      Object.assign(new Error('timeout'), { code: 'E_NETWORK_ERROR' })
    );
    const events: DeepLinkEvent[] = [];

    await WarpLink.configure({ apiKey: KEY, onLink: (e) => events.push(e) });

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.error?.code)).toEqual(['E_NETWORK_ERROR']);
  });

  it('delivers nothing for the no match answer the native check gives inside a wait', async () => {
    mockCheckDeferredDeepLink.mockResolvedValue(null);
    const events: DeepLinkEvent[] = [];

    await WarpLink.configure({ apiKey: KEY, onLink: (e) => events.push(e) });

    expect(events).toEqual([]);
  });

  it('does not start a check once native reports attribution complete', async () => {
    mockIsAttributionComplete.mockResolvedValue(true);

    await WarpLink.configure({ apiKey: KEY, onLink: () => {} });

    expect(mockCheckDeferredDeepLink).not.toHaveBeenCalled();
  });
});

describe('the manual check', () => {
  it('goes to the native check and returns its answer', async () => {
    mockCheckDeferredDeepLink.mockResolvedValue(null);

    await expect(WarpLink.checkDeferredDeepLink()).resolves.toBeNull();

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
  });

  it('rejects once with the native error and does not retry', async () => {
    mockCheckDeferredDeepLink.mockRejectedValue(
      Object.assign(new Error('busy'), { code: 'E_SERVER_ERROR' })
    );

    await expect(WarpLink.checkDeferredDeepLink()).rejects.toMatchObject({ name: 'WarpLinkError' });

    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
  });
});

describe('the native bridges', () => {
  it('turn the native automatic check off and call the shared native check', () => {
    expect(read('android/src/main/kotlin/app/warplink/reactnative/ConfigureOptions.kt')).toMatch(
      /automaticDeferredDeepLinks = false/
    );
    expect(read('android/src/main/kotlin/app/warplink/reactnative/WarpLinkModule.kt')).toMatch(
      /WarpLink\.checkDeferredDeepLink \{/
    );
    expect(read('ios/WarpLinkModule+Configure.swift')).toMatch(/autoDeferredCheck: false/);
    expect(read('ios/WarpLinkModule.swift')).toMatch(/WarpLink\.checkDeferredDeepLink \{/);
  });
});
