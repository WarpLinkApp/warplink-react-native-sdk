const mockConfigure = jest.fn();
const mockReadTether = jest.fn();
const mockGetTetherTestReceipt = jest.fn();
const mockCheckDeferred = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    WarpLinkModule: {
      configure: mockConfigure,
      readTether: mockReadTether,
      getTetherTestReceipt: mockGetTetherTestReceipt,
      checkDeferredDeepLink: mockCheckDeferred,
      getInitialURL: jest.fn().mockResolvedValue(null),
      isWarpLinkUrl: jest.fn().mockResolvedValue(false),
    },
  },
  Platform: { select: jest.fn(() => ''), OS: 'ios' },
  NativeEventEmitter: jest.fn(() => ({ addListener: jest.fn(() => ({ remove: jest.fn() })) })),
}));

import { WarpLink } from '../WarpLink';
import { ErrorCodes } from '../types';
import { nativeError, nativeMatch } from '../../test-utils/referral-native';

const KEY = 'wl_live_abcdefghijklmnopqrstuvwxyz012345';

async function configureWith(extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  await WarpLink.configure({
    apiKey: KEY,
    automaticDeepLinks: false,
    automaticDeferredDeepLinks: false,
    ...extra,
  });
  return mockConfigure.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe('Tether read modes', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockConfigure.mockResolvedValue(undefined);
    mockCheckDeferred.mockResolvedValue(null);
  });

  it('WL-S53 no mode set sends none, and the native default is the paste button', async () => {
    const config = await configureWith();

    expect(config).not.toHaveProperty('tetherReadMode');
  });

  it.each([
    ['pasteButton', 'paste_button'],
    ['automatic', 'automatic'],
    ['onCall', 'on_call'],
  ] as const)('WL-S53 the %s mode reaches the native SDK as %s', async (mode, wire) => {
    const config = await configureWith({ tetherReadMode: mode });

    expect(config['tetherReadMode']).toBe(wire);
  });

  it('WL-S53 a value that is not a mode can never switch a read on', async () => {
    const config = await configureWith({ tetherReadMode: 'always' });

    expect(config['tetherReadMode']).toBe('paste_button');
  });

  it('WL-S53 configure alone makes no read: only readTether crosses the bridge for a code', async () => {
    await configureWith({ tetherReadMode: 'onCall' });

    expect(mockReadTether).not.toHaveBeenCalled();
  });
});

describe('readTether', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('WL-S54 asks the native SDK with no arguments, so no clipboard text crosses the bridge', async () => {
    mockReadTether.mockResolvedValue({ kind: 'noCode', reason: 'clipboard_empty' });

    await WarpLink.readTether();

    expect(mockReadTether).toHaveBeenCalledTimes(1);
    expect(mockReadTether).toHaveBeenCalledWith();
  });

  it('WL-S53 a matched read returns the link', async () => {
    mockReadTether.mockResolvedValue({ kind: 'matched', link: nativeMatch() });

    const result = await WarpLink.readTether();

    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') {
      expect(result.link.linkId).toBe('link-123');
      expect(result.link.matchMethod).toBe('install_token');
    }
  });

  it.each([
    'paste_not_allowed',
    'clipboard_empty',
    'in_app_browser',
    'expired',
    'other_app',
    'link_ended',
    'older_sdk',
  ])('WL-S59 a miss reports the reason %s', async (reason) => {
    mockReadTether.mockResolvedValue({ kind: 'noCode', reason });

    expect(await WarpLink.readTether()).toEqual({ kind: 'noCode', reason });
  });

  it('WL-S59 a reason the SDK does not know reads as no reason', async () => {
    mockReadTether.mockResolvedValue({ kind: 'noCode', reason: 'something_new' });

    expect(await WarpLink.readTether()).toEqual({ kind: 'noCode', reason: null });
  });

  it('Android answers no code with no reason and RN passes it on', async () => {
    mockReadTether.mockResolvedValue({ kind: 'noCode', reason: null });

    expect(await WarpLink.readTether()).toEqual({ kind: 'noCode', reason: null });
  });

  it('WL-S60 a code that led nowhere is unusable, never an error', async () => {
    mockReadTether.mockResolvedValue({ kind: 'unusable' });

    expect(await WarpLink.readTether()).toEqual({ kind: 'unusable' });
  });

  it('WL-S60 an answer the bridge cannot read is unusable, so onboarding goes on', async () => {
    mockReadTether.mockResolvedValue({ kind: 'surprise' });
    expect(await WarpLink.readTether()).toEqual({ kind: 'unusable' });

    mockReadTether.mockResolvedValue(null);
    expect(await WarpLink.readTether()).toEqual({ kind: 'unusable' });
  });

  it('WL-S60 a matched answer with no link is unusable', async () => {
    mockReadTether.mockResolvedValue({ kind: 'matched', link: null });

    expect(await WarpLink.readTether()).toEqual({ kind: 'unusable' });
  });

  it('WL-S60 a native failure rejects with its code', async () => {
    mockReadTether.mockRejectedValue(nativeError('E_NETWORK_ERROR', 'offline'));

    await expect(WarpLink.readTether()).rejects.toMatchObject({
      name: 'WarpLinkError',
      code: ErrorCodes.E_NETWORK_ERROR,
    });
  });

  it('WL-S60 reading before configure rejects with E_NOT_CONFIGURED', async () => {
    mockReadTether.mockRejectedValue(nativeError('E_NOT_CONFIGURED', 'configure first'));

    await expect(WarpLink.readTether()).rejects.toMatchObject({
      code: ErrorCodes.E_NOT_CONFIGURED,
    });
  });
});

describe('Tether test codes', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('WL-S61 a test code returns its receipt and no link', async () => {
    mockReadTether.mockResolvedValue({ kind: 'test', receipt: 'rcpt_1' });

    expect(await WarpLink.readTether()).toEqual({ kind: 'test', receipt: 'rcpt_1' });
  });

  it('WL-S61 a test code the server gave no receipt for has a null receipt', async () => {
    mockReadTether.mockResolvedValue({ kind: 'test' });

    expect(await WarpLink.readTether()).toEqual({ kind: 'test', receipt: null });
  });

  it('WL-S61 the last test receipt comes from the native SDK, in memory only', async () => {
    mockGetTetherTestReceipt.mockResolvedValue('rcpt_1');

    expect(await WarpLink.lastTetherTestReceipt()).toBe('rcpt_1');
    expect(mockGetTetherTestReceipt).toHaveBeenCalledWith();
  });

  it('WL-S61 no receipt reads as null', async () => {
    mockGetTetherTestReceipt.mockResolvedValue(undefined);

    expect(await WarpLink.lastTetherTestReceipt()).toBeNull();
  });

  it('WL-S61 a failure reading the receipt rejects with a WarpLinkError', async () => {
    mockGetTetherTestReceipt.mockRejectedValue(nativeError('E_NOT_CONFIGURED', 'configure first'));

    await expect(WarpLink.lastTetherTestReceipt()).rejects.toMatchObject({
      name: 'WarpLinkError',
    });
  });
});
