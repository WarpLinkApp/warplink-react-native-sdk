const mockConfigure = jest.fn();
const mockReadTether = jest.fn();
const mockCheckDeferred = jest.fn();
const mockIsAttributionComplete = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    WarpLinkModule: {
      configure: mockConfigure,
      readTether: mockReadTether,
      checkDeferredDeepLink: mockCheckDeferred,
      isAttributionComplete: mockIsAttributionComplete,
      clearAttribution: jest.fn().mockResolvedValue(undefined),
      getInitialURL: jest.fn().mockResolvedValue(null),
      isWarpLinkUrl: jest.fn().mockResolvedValue(false),
    },
  },
  Platform: { select: jest.fn(() => ''), OS: 'ios' },
  NativeEventEmitter: jest.fn(() => ({ addListener: jest.fn(() => ({ remove: jest.fn() })) })),
}));

import type { DeepLinkEvent } from '../types';
import { nativeMatch } from '../../test-utils/referral-native';

// A repeated configure() with the same key and options is a no-op, so each test
// loads a fresh copy of the module and its session state.
let WarpLink: typeof import('../WarpLink').WarpLink;
let handlePasteEvent: typeof import('../tether/paste-event').handlePasteEvent;

const KEY = 'wl_live_abcdefghijklmnopqrstuvwxyz012345';
const TEST_KEY = 'wl_test_abcdefghijklmnopqrstuvwxyz012345';

const ESTIMATE = nativeMatch({
  linkId: 'link-estimate',
  matchType: 'probabilistic',
  matchConfidence: 0.77,
  matchGuaranteed: false,
  matchMethod: 'probabilistic',
  evidenceClass: 'estimated',
});

const EXACT = nativeMatch({ linkId: 'link-1' });

async function configureWithEstimate(events: DeepLinkEvent[]): Promise<void> {
  mockCheckDeferred.mockResolvedValue(ESTIMATE);
  await WarpLink.configure({ apiKey: KEY, onLink: (event) => events.push(event) });
}

function linkIds(events: DeepLinkEvent[]): (string | undefined)[] {
  return events.map((event) => event.deepLink?.linkId);
}

describe('onLink hears the exact link a Tether code resolves later', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.resetModules();
    ({ WarpLink } = require('../WarpLink') as typeof import('../WarpLink'));
    ({ handlePasteEvent } = require('../tether/paste-event') as typeof import('../tether/paste-event'));
    mockConfigure.mockResolvedValue(undefined);
    mockIsAttributionComplete.mockResolvedValue(false);
  });

  it('readTether fires onLink again with the exact link after the estimate', async () => {
    const events: DeepLinkEvent[] = [];
    await configureWithEstimate(events);
    mockReadTether.mockResolvedValue({ kind: 'matched', link: EXACT });

    const result = await WarpLink.readTether();

    expect(result.kind).toBe('matched');
    expect(linkIds(events)).toEqual(['link-estimate', 'link-1']);
    expect(events[1]?.deepLink).toMatchObject({ matchType: 'deterministic', evidenceClass: 'exact', matchGuaranteed: true });
  });

  it('a paste button result fires onLink again with the exact link', async () => {
    const events: DeepLinkEvent[] = [];
    await configureWithEstimate(events);
    const onResult = jest.fn();

    handlePasteEvent({ result: { kind: 'matched', link: EXACT } }, { onResult });

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(linkIds(events)).toEqual(['link-estimate', 'link-1']);
  });

  it('does not repeat the same exact link', async () => {
    const events: DeepLinkEvent[] = [];
    await configureWithEstimate(events);
    mockReadTether.mockResolvedValue({ kind: 'matched', link: EXACT });

    await WarpLink.readTether();
    await WarpLink.readTether();

    expect(linkIds(events)).toEqual(['link-estimate', 'link-1']);
  });

  it('does not fire again for the same link id with different evidence', async () => {
    const events: DeepLinkEvent[] = [];
    mockCheckDeferred.mockResolvedValue({ ...ESTIMATE, linkId: 'link-1' });
    await WarpLink.configure({ apiKey: KEY, onLink: (event) => events.push(event) });
    mockReadTether.mockResolvedValue({ kind: 'matched', link: EXACT });

    await WarpLink.readTether();

    expect(linkIds(events)).toEqual(['link-1']);
  });

  it('stays silent when onLink was given no earlier link', async () => {
    const events: DeepLinkEvent[] = [];
    mockCheckDeferred.mockResolvedValue(null);
    await WarpLink.configure({ apiKey: KEY, onLink: (event) => events.push(event) });
    mockReadTether.mockResolvedValue({ kind: 'matched', link: EXACT });

    await WarpLink.readTether();

    expect(events).toEqual([]);
  });

  it('stays silent for a read that matched nothing', async () => {
    const events: DeepLinkEvent[] = [];
    await configureWithEstimate(events);
    mockReadTether.mockResolvedValue({ kind: 'unusable' });

    await WarpLink.readTether();

    expect(linkIds(events)).toEqual(['link-estimate']);
  });

  it('keeps the read result when the host onLink throws', async () => {
    let calls = 0;
    mockCheckDeferred.mockResolvedValue(ESTIMATE);
    await WarpLink.configure({
      apiKey: KEY,
      onLink: () => {
        calls += 1;
        if (calls > 1) throw new Error('host bug');
      },
    });
    mockReadTether.mockResolvedValue({ kind: 'matched', link: EXACT });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(WarpLink.readTether()).resolves.toMatchObject({ kind: 'matched' });

    warn.mockRestore();
  });

  it('forgets the earlier link after a test key clearAttribution', async () => {
    const events: DeepLinkEvent[] = [];
    mockCheckDeferred.mockResolvedValue(ESTIMATE);
    await WarpLink.configure({ apiKey: TEST_KEY, onLink: (event) => events.push(event) });
    mockCheckDeferred.mockResolvedValue(null);
    await WarpLink.clearAttribution();
    const before = events.length;
    mockReadTether.mockResolvedValue({ kind: 'matched', link: EXACT });

    await WarpLink.readTether();

    expect(events).toHaveLength(before);
  });
});
