const mockConfigure = jest.fn();
const mockHandleDeepLink = jest.fn();
const mockIsWarpLinkUrl = jest.fn();
const mockCheckDeferredDeepLink = jest.fn();
const mockGetAttributionResult = jest.fn();
const mockIsConfigured = jest.fn();
const mockIsAttributionComplete = jest.fn();
const mockGetInitialURL = jest.fn();
const mockGetSdkVersion = jest.fn();

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
      getSdkVersion: mockGetSdkVersion,
    },
  },
  Platform: {
    select: jest.fn((obj: Record<string, string>) => obj['default'] ?? ''),
  },
  NativeEventEmitter: jest.fn(() => ({
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    removeAllListeners: jest.fn(),
  })),
}));

import { WarpLink } from '../WarpLink';
import { ErrorCodes } from '../types';
import { classifyLikeNative } from '../../test-utils/classify-like-native';

/**
 * Two values the native SDKs have always had and JavaScript could not see.
 *
 * `sdkVersion` is the one that matters most: React Native pins its native SDK
 * by hand, and the published 1.0.2 pinned an Android SDK that reported 0.1.1
 * while npm said 1.0.2. A host that cannot ask which native SDK it is running
 * cannot see that drift, which is the exact failure the 1.1.0 version guards
 * exist to prevent. The device pass had to read it from Kotlin instead.
 *
 * Beads: warplink-0o2j, warplink-kg89.
 */
describe('native parity on the public object', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockIsWarpLinkUrl.mockImplementation(classifyLikeNative);
  });

  it('sdkVersion reports the version the NATIVE sdk reports', async () => {
    mockGetSdkVersion.mockResolvedValue('1.1.0');

    await expect(WarpLink.sdkVersion()).resolves.toBe('1.1.0');
    expect(mockGetSdkVersion).toHaveBeenCalledTimes(1);
  });

  it('sdkVersion reports drift rather than the package version', async () => {
    // The published 1.0.2 shipped this exact mismatch.
    mockGetSdkVersion.mockResolvedValue('0.1.1');

    await expect(WarpLink.sdkVersion()).resolves.toBe('0.1.1');
  });

  it('sdkVersion maps a native failure to a WarpLinkError', async () => {
    const native = new Error('boom') as Error & { code?: string };
    native.code = ErrorCodes.E_NOT_CONFIGURED;
    mockGetSdkVersion.mockRejectedValue(native);

    await expect(WarpLink.sdkVersion()).rejects.toMatchObject({
      name: 'WarpLinkError',
      code: ErrorCodes.E_NOT_CONFIGURED,
    });
  });

  it('isAttributionComplete is readable from the public object', async () => {
    mockIsAttributionComplete.mockResolvedValue(true);

    await expect(WarpLink.isAttributionComplete()).resolves.toBe(true);
    expect(mockIsAttributionComplete).toHaveBeenCalledTimes(1);
  });

  it('isAttributionComplete reports false before the check completes', async () => {
    mockIsAttributionComplete.mockResolvedValue(false);

    await expect(WarpLink.isAttributionComplete()).resolves.toBe(false);
  });

  it('isAttributionComplete maps a native failure to a WarpLinkError', async () => {
    const native = new Error('nope') as Error & { code?: string };
    native.code = ErrorCodes.E_NOT_CONFIGURED;
    mockIsAttributionComplete.mockRejectedValue(native);

    await expect(WarpLink.isAttributionComplete()).rejects.toMatchObject({
      name: 'WarpLinkError',
      code: ErrorCodes.E_NOT_CONFIGURED,
    });
  });
});
