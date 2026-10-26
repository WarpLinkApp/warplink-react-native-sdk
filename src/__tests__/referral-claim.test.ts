const mockClaimReferral = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: { WarpLinkModule: { claimReferral: mockClaimReferral } },
  Platform: { select: jest.fn(() => '') },
  NativeEventEmitter: jest.fn(),
}));

import { WarpLink } from '../WarpLink';
import { ErrorCodes } from '../types';
import { nativeError } from '../../test-utils/referral-native';

const CLAIMED = {
  status: 'claimed',
  referralId: 'ref-1',
  linkId: 'link-1',
  linkUrl: 'https://acme.aplnk.to/invite',
  matchMethod: 'install_token',
  isExact: true,
  matchConfidence: null,
  flags: [],
  duplicateOf: null,
  updated: false,
  replayState: 'original',
};

describe('claimReferral', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('WL-S45 sends the installer id to the native SDK as written', async () => {
    mockClaimReferral.mockResolvedValue(CLAIMED);

    const result = await WarpLink.claimReferral('inst-7f3a');

    expect(mockClaimReferral).toHaveBeenCalledWith('inst-7f3a');
    expect(result).toEqual(CLAIMED);
  });

  it('WL-S45 a repeat claim returns the same answer', async () => {
    mockClaimReferral.mockResolvedValue({ ...CLAIMED, replayState: 'replayed' });

    const first = await WarpLink.claimReferral('inst-7f3a');
    const second = await WarpLink.claimReferral('inst-7f3a');

    expect(second).toEqual(first);
    expect(second.replayState).toBe('replayed');
  });

  it('WL-S45 status none is an answer, not an error', async () => {
    mockClaimReferral.mockResolvedValue({ status: 'none' });

    await expect(WarpLink.claimReferral('inst-1')).resolves.toMatchObject({
      status: 'none',
      referralId: null,
      isExact: false,
      flags: [],
    });
  });

  it.each([
    ['null', null],
    ['text', 'oops'],
    ['an unknown status', { status: 'banana', referralId: 'ref-1' }],
    ['no status', {}],
  ])('WL-S45 an unreadable answer (%s) reads as none', async (_name, raw) => {
    mockClaimReferral.mockResolvedValue(raw);

    await expect(WarpLink.claimReferral('inst-1')).resolves.toMatchObject({
      status: 'none',
      referralId: null,
    });
  });

  it('WL-S45 a flagged claim keeps its flags and an ignored one its duplicate', async () => {
    mockClaimReferral.mockResolvedValueOnce({
      ...CLAIMED,
      status: 'flagged',
      flags: ['outside_window', 7],
    });
    mockClaimReferral.mockResolvedValueOnce({
      ...CLAIMED,
      status: 'ignored',
      duplicateOf: 'ref-0',
    });

    const flagged = await WarpLink.claimReferral('inst-1');
    const ignored = await WarpLink.claimReferral('inst-2');

    expect(flagged.flags).toEqual(['outside_window']);
    expect(ignored.duplicateOf).toBe('ref-0');
  });

  it.each([[ErrorCodes.E_NETWORK_ERROR], [ErrorCodes.E_INVALID_API_KEY]])(
    'WL-S45 a %s failure is an error',
    async (code) => {
      mockClaimReferral.mockRejectedValue(nativeError(code, 'failed'));

      await expect(WarpLink.claimReferral('inst-1')).rejects.toMatchObject({
        name: 'WarpLinkError',
        code,
      });
    }
  );

  it('WL-S45 an installer id that is not text fails without a request', async () => {
    const id = 42 as unknown as string;

    await expect(WarpLink.claimReferral(id)).rejects.toMatchObject({
      code: ErrorCodes.E_SERVER_ERROR,
    });
    expect(mockClaimReferral).not.toHaveBeenCalled();
  });
});
