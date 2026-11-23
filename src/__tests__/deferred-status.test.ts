const mockGetDeferredCheckStatus = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: { WarpLinkModule: { getDeferredCheckStatus: mockGetDeferredCheckStatus } },
  Platform: { select: jest.fn(() => ''), OS: 'ios' },
  NativeEventEmitter: jest.fn(() => ({ addListener: jest.fn(() => ({ remove: jest.fn() })) })),
}));

import { WarpLink } from '../WarpLink';
import { ErrorCodes } from '../types';

const RETRY_AT = 1_800_000_000_000;

beforeEach(() => {
  jest.resetAllMocks();
});

describe('WarpLink.getDeferredCheckStatus', () => {
  // conformance: WL-S74
  it.each(['notChecked', 'checking', 'matched', 'noMatch', 'skippedOldInstall', 'stopped'] as const)(
    'returns the native state %s unchanged, with no retry time',
    async (state) => {
      mockGetDeferredCheckStatus.mockResolvedValue({ state });

      await expect(WarpLink.getDeferredCheckStatus()).resolves.toEqual({ state });
    }
  );

  // conformance: WL-S74
  it('returns waiting with the time the next check is allowed, in epoch milliseconds', async () => {
    mockGetDeferredCheckStatus.mockResolvedValue({ state: 'waiting', retryAt: RETRY_AT });

    await expect(WarpLink.getDeferredCheckStatus()).resolves.toEqual({
      state: 'waiting',
      retryAt: RETRY_AT,
    });
  });

  // conformance: WL-S74
  it('drops a retry time from a state that does not wait', async () => {
    mockGetDeferredCheckStatus.mockResolvedValue({ state: 'matched', retryAt: RETRY_AT });

    await expect(WarpLink.getDeferredCheckStatus()).resolves.toEqual({ state: 'matched' });
  });

  it.each([
    ['an unknown state', { state: 'paused' }],
    ['a missing state', {}],
    ['a waiting state with no retry time', { state: 'waiting' }],
    ['a waiting state with a retry time that is not a number', { state: 'waiting', retryAt: 'soon' }],
    ['no payload', null],
  ])('rejects %s with E_DECODING_ERROR', async (_name, payload) => {
    mockGetDeferredCheckStatus.mockResolvedValue(payload);

    await expect(WarpLink.getDeferredCheckStatus()).rejects.toMatchObject({
      name: 'WarpLinkError',
      code: ErrorCodes.E_DECODING_ERROR,
    });
  });

  it('maps a native failure to a WarpLinkError', async () => {
    mockGetDeferredCheckStatus.mockRejectedValue(
      Object.assign(new Error('not configured'), { code: 'E_NOT_CONFIGURED' })
    );

    await expect(WarpLink.getDeferredCheckStatus()).rejects.toMatchObject({
      name: 'WarpLinkError',
      code: ErrorCodes.E_NOT_CONFIGURED,
    });
  });
});
