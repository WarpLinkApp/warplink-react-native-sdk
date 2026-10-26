const mockRedeemInvitation = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: { WarpLinkModule: { redeemInvitation: mockRedeemInvitation } },
  Platform: { select: jest.fn(() => '') },
  NativeEventEmitter: jest.fn(),
}));

import { WarpLink } from '../WarpLink';
import { ErrorCodes } from '../types';
import {
  nativeError,
  nativeMatch,
  PENDING_MESSAGE,
  REOPEN_MESSAGE,
} from '../../test-utils/referral-native';

const TOKEN = 'A'.repeat(50);

describe('redeemInvitation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('WL-S40 hands the pasted text to the native SDK untouched', async () => {
    mockRedeemInvitation.mockResolvedValue(nativeMatch());

    const link = await WarpLink.redeemInvitation(`  ${TOKEN}\n`);

    expect(mockRedeemInvitation).toHaveBeenCalledTimes(1);
    expect(mockRedeemInvitation).toHaveBeenCalledWith(`  ${TOKEN}\n`);
    expect(link?.linkId).toBe('link-123');
  });

  it('WL-S40 leaves the shape and expiry decision to the native SDK', async () => {
    mockRedeemInvitation.mockResolvedValue(null);

    await expect(WarpLink.redeemInvitation('x'.repeat(49))).resolves.toBeNull();
    expect(mockRedeemInvitation).toHaveBeenCalledWith('x'.repeat(49));
  });

  it('WL-S41 text that is not an invitation resolves null', async () => {
    mockRedeemInvitation.mockResolvedValue(null);

    await expect(WarpLink.redeemInvitation('hello there')).resolves.toBeNull();
    expect(mockRedeemInvitation).toHaveBeenCalledTimes(1);
  });

  it('WL-S41 a value that is not text sends nothing', async () => {
    const paste = null as unknown as string;

    await expect(WarpLink.redeemInvitation(paste)).resolves.toBeNull();
    expect(mockRedeemInvitation).not.toHaveBeenCalled();
  });

  it('WL-S42 a refusal keeps the reopen message and is not retried', async () => {
    mockRedeemInvitation.mockRejectedValue(
      nativeError(ErrorCodes.E_SERVER_ERROR, REOPEN_MESSAGE)
    );

    await expect(WarpLink.redeemInvitation(TOKEN)).rejects.toMatchObject({
      name: 'WarpLinkError',
      code: ErrorCodes.E_SERVER_ERROR,
      message: REOPEN_MESSAGE,
    });
    expect(mockRedeemInvitation).toHaveBeenCalledTimes(1);
  });

  it('WL-S42 the refusal text does not claim the invitation expired', async () => {
    mockRedeemInvitation.mockRejectedValue(
      nativeError(ErrorCodes.E_SERVER_ERROR, REOPEN_MESSAGE)
    );

    const error = await WarpLink.redeemInvitation(TOKEN).catch((e: Error) => e);

    expect((error as Error).message).not.toMatch(/expired/i);
  });

  it('WL-S42 a pending answer asks the person to try again in a minute', async () => {
    mockRedeemInvitation.mockRejectedValue(
      nativeError(ErrorCodes.E_SERVER_ERROR, PENDING_MESSAGE)
    );

    await expect(WarpLink.redeemInvitation(TOKEN)).rejects.toMatchObject({
      code: ErrorCodes.E_SERVER_ERROR,
      message: PENDING_MESSAGE,
    });
    expect(mockRedeemInvitation).toHaveBeenCalledTimes(1);
  });

  it('WL-S42 an unconfigured SDK reports E_NOT_CONFIGURED', async () => {
    mockRedeemInvitation.mockRejectedValue(
      nativeError(ErrorCodes.E_NOT_CONFIGURED, 'SDK not configured')
    );

    await expect(WarpLink.redeemInvitation(TOKEN)).rejects.toMatchObject({
      code: ErrorCodes.E_NOT_CONFIGURED,
    });
  });

  it('WL-S44 a network failure is surfaced once and JavaScript does not retry', async () => {
    mockRedeemInvitation.mockRejectedValue(
      nativeError(ErrorCodes.E_NETWORK_ERROR, 'offline')
    );

    await expect(WarpLink.redeemInvitation(TOKEN)).rejects.toMatchObject({
      code: ErrorCodes.E_NETWORK_ERROR,
    });
    expect(mockRedeemInvitation).toHaveBeenCalledTimes(1);
  });

  it('WL-S44 one paste is one delivery to the native SDK', async () => {
    mockRedeemInvitation.mockResolvedValue(nativeMatch());

    await WarpLink.redeemInvitation(TOKEN);

    expect(mockRedeemInvitation).toHaveBeenCalledTimes(1);
  });
});
