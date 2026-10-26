const mockHandleDeepLink = jest.fn();
const mockGetAttributionResult = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    WarpLinkModule: {
      handleDeepLink: mockHandleDeepLink,
      getAttributionResult: mockGetAttributionResult,
    },
  },
  Platform: { select: jest.fn(() => '') },
  NativeEventEmitter: jest.fn(),
}));

import { WarpLink } from '../WarpLink';
import { nativeMatch } from '../../test-utils/referral-native';

const URL = 'https://acme.aplnk.to/invite';

describe('additive evidence fields', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('WL-S43 a match carries the six evidence fields', async () => {
    mockHandleDeepLink.mockResolvedValue(nativeMatch());

    const link = await WarpLink.handleDeepLink(URL);

    expect(link).toMatchObject({
      attributionId: 'attr-1',
      matchMethod: 'install_token',
      evidenceClass: 'exact',
      replayState: 'original',
      capturedParams: { utm_source: 'friend' },
      tappedAt: '2026-10-20T10:00:00Z',
    });
  });

  it('WL-S43 the attribution result carries the same fields', async () => {
    mockGetAttributionResult.mockResolvedValue(nativeMatch());

    const result = await WarpLink.getAttributionResult();

    expect(result).toMatchObject({
      attributionId: 'attr-1',
      evidenceClass: 'exact',
      matchMethod: 'install_token',
    });
  });

  it('WL-S43 a payload from an older SDK decodes to safe defaults', async () => {
    mockHandleDeepLink.mockResolvedValue({
      linkId: 'link-9',
      destination: 'https://example.com',
      isDeferred: false,
    });

    const link = await WarpLink.handleDeepLink(URL);

    expect(link).toMatchObject({
      linkId: 'link-9',
      attributionId: null,
      matchMethod: null,
      evidenceClass: null,
      replayState: null,
      capturedParams: {},
      tappedAt: null,
    });
  });

  it('WL-S43 a value this SDK does not know never drops the match', async () => {
    mockHandleDeepLink.mockResolvedValue(
      nativeMatch({
        matchMethod: 'carrier_pigeon',
        evidenceClass: 'vibes',
        replayState: 'sideways',
        capturedParams: ['not', 'a', 'map'],
      })
    );

    const link = await WarpLink.handleDeepLink(URL);

    expect(link).toMatchObject({
      linkId: 'link-123',
      matchMethod: null,
      evidenceClass: null,
      replayState: null,
      capturedParams: {},
    });
  });

  it('WL-S46 a link-id match stays legacy_link with method link_open', async () => {
    mockHandleDeepLink.mockResolvedValue(
      nativeMatch({
        matchMethod: 'link_open',
        evidenceClass: 'legacy_link',
        matchType: 'probabilistic',
        matchGuaranteed: false,
      })
    );

    const link = await WarpLink.handleDeepLink(URL);

    expect(link).toMatchObject({
      matchMethod: 'link_open',
      evidenceClass: 'legacy_link',
    });
  });

  it.each([
    ['install_token', 'exact'],
    ['android_referrer', 'exact'],
    ['device_id', 'exact'],
    ['probabilistic', 'estimated'],
  ])('WL-S46 a %s match keeps its own class %s', async (method, cls) => {
    mockHandleDeepLink.mockResolvedValue(
      nativeMatch({ matchMethod: method, evidenceClass: cls })
    );

    const link = await WarpLink.handleDeepLink(URL);

    expect(link).toMatchObject({ matchMethod: method, evidenceClass: cls });
  });

  it('WL-S46 a missing class is never upgraded to exact', async () => {
    mockHandleDeepLink.mockResolvedValue(
      nativeMatch({ evidenceClass: undefined, matchMethod: 'link_open' })
    );

    const link = await WarpLink.handleDeepLink(URL);

    expect(link?.evidenceClass).toBeNull();
  });
});
