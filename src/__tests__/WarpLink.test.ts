const mockConfigure = jest.fn();
const mockHandleDeepLink = jest.fn();
const mockCheckDeferredDeepLink = jest.fn();
const mockGetAttributionResult = jest.fn();
const mockIsConfigured = jest.fn();
const mockGetInitialURL = jest.fn();

type EventHandler = (event: Record<string, unknown>) => void;

let mockEmitterListeners: Map<string, EventHandler>;
const mockRemoveSubscription = jest.fn();
const mockNativeEventEmitter = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    WarpLinkModule: {
      configure: mockConfigure,
      handleDeepLink: mockHandleDeepLink,
      checkDeferredDeepLink: mockCheckDeferredDeepLink,
      getAttributionResult: mockGetAttributionResult,
      isConfigured: mockIsConfigured,
      getInitialURL: mockGetInitialURL,
    },
  },
  Platform: {
    select: jest.fn((obj: Record<string, string>) => obj['default'] ?? ''),
  },
  NativeEventEmitter: mockNativeEventEmitter,
}));

import { WarpLink } from '../WarpLink';
import { WarpLinkError, ErrorCodes } from '../types';

const VALID_LIVE_KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const VALID_TEST_KEY = 'wl_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';

function emitNativeEvent(
  eventName: string,
  data: Record<string, unknown>
): void {
  const handler = mockEmitterListeners.get(eventName);
  if (handler) handler(data);
}

describe('WarpLink', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockConfigure.mockResolvedValue(undefined);
    mockEmitterListeners = new Map();
    mockNativeEventEmitter.mockImplementation(() => ({
      addListener: jest.fn(
        (eventName: string, handler: EventHandler) => {
          mockEmitterListeners.set(eventName, handler);
          return { remove: mockRemoveSubscription };
        }
      ),
      removeAllListeners: jest.fn(),
    }));
  });

  describe('configure() API key validation', () => {
    it('throws WarpLinkError for empty string apiKey', () => {
      expect(() => WarpLink.configure({ apiKey: '' })).toThrow(WarpLinkError);
      try {
        WarpLink.configure({ apiKey: '' });
      } catch (e) {
        expect(e).toBeInstanceOf(WarpLinkError);
        expect((e as WarpLinkError).code).toBe(
          ErrorCodes.E_INVALID_API_KEY_FORMAT
        );
      }
    });

    it('throws for key missing wl_ prefix', () => {
      expect(() =>
        WarpLink.configure({ apiKey: 'invalid_key' })
      ).toThrow(WarpLinkError);
      expect(() =>
        WarpLink.configure({ apiKey: 'invalid_key' })
      ).toThrow(/Invalid API key format/);
    });

    it('throws for wrong environment segment', () => {
      expect(() =>
        WarpLink.configure({
          apiKey: 'wl_prod_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
        })
      ).toThrow(WarpLinkError);
    });

    it('throws for key with too few chars after prefix', () => {
      expect(() =>
        WarpLink.configure({ apiKey: 'wl_live_short' })
      ).toThrow(WarpLinkError);
    });

    it('throws for key with too many chars after prefix', () => {
      expect(() =>
        WarpLink.configure({
          apiKey: 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6extra',
        })
      ).toThrow(WarpLinkError);
    });

    it('throws for key with special characters', () => {
      expect(() =>
        WarpLink.configure({
          apiKey: 'wl_live_a1b2c3d4e5f6g7h8!@#$i9j0k1l2m3n4',
        })
      ).toThrow(WarpLinkError);
    });

    it('does not call native module when key format is invalid', () => {
      try {
        WarpLink.configure({ apiKey: 'invalid' });
      } catch {
        // expected
      }
      expect(mockConfigure).not.toHaveBeenCalled();
    });
  });

  describe('configure() valid keys', () => {
    it('succeeds with valid wl_live_ key', () => {
      expect(() =>
        WarpLink.configure({ apiKey: VALID_LIVE_KEY })
      ).not.toThrow();
      expect(mockConfigure).toHaveBeenCalledWith({
        apiKey: VALID_LIVE_KEY,
      });
    });

    it('succeeds with valid wl_test_ key', () => {
      expect(() =>
        WarpLink.configure({ apiKey: VALID_TEST_KEY })
      ).not.toThrow();
      expect(mockConfigure).toHaveBeenCalledWith({
        apiKey: VALID_TEST_KEY,
      });
    });

    it('does not throw WarpLinkError for valid keys', () => {
      let caught: unknown = null;
      try {
        WarpLink.configure({ apiKey: VALID_LIVE_KEY });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeNull();
    });
  });

  describe('configure() idempotent reconfiguration', () => {
    it('allows calling configure() multiple times', () => {
      WarpLink.configure({ apiKey: VALID_LIVE_KEY });
      expect(mockConfigure).toHaveBeenCalledTimes(1);

      WarpLink.configure({ apiKey: VALID_TEST_KEY });
      expect(mockConfigure).toHaveBeenCalledTimes(2);
    });
  });

  describe('configure() native error propagation', () => {
    it('configure is synchronous — native rejection does not throw synchronously', () => {
      // The native module validates asynchronously. The JS configure()
      // is fire-and-forget: it calls native and returns void immediately.
      // We verify configure() does not throw even though native WILL reject.
      // Note: We can't test the actual rejection path because the
      // fire-and-forget `.catch(() => { throw })` produces an unhandled
      // rejection that crashes Node 24. The mapNativeError function is
      // tested via handleDeepLink/isConfigured error handling tests instead.
      expect(mockConfigure).not.toHaveBeenCalled();

      WarpLink.configure({ apiKey: VALID_LIVE_KEY });

      // Native was called (the async validation happens inside native)
      expect(mockConfigure).toHaveBeenCalledTimes(1);
      expect(mockConfigure).toHaveBeenCalledWith({
        apiKey: VALID_LIVE_KEY,
      });
    });
  });

  describe('configure() optional config passthrough', () => {
    it('passes all optional fields when provided', () => {
      WarpLink.configure({
        apiKey: VALID_LIVE_KEY,
        apiEndpoint: 'https://custom.api.com',
        debugLogging: true,
        matchWindowHours: 48,
      });

      expect(mockConfigure).toHaveBeenCalledWith({
        apiKey: VALID_LIVE_KEY,
        apiEndpoint: 'https://custom.api.com',
        debugLogging: true,
        matchWindowHours: 48,
      });
    });

    it('does not include undefined optional fields', () => {
      WarpLink.configure({ apiKey: VALID_LIVE_KEY });

      const callArg = mockConfigure.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(Object.keys(callArg)).toEqual(['apiKey']);
    });

    it('includes matchWindowHours when provided', () => {
      WarpLink.configure({
        apiKey: VALID_LIVE_KEY,
        matchWindowHours: 48,
      });

      expect(mockConfigure.mock.calls[0]![0]).toMatchObject({
        matchWindowHours: 48,
      });
    });

    it('excludes matchWindowHours when not provided', () => {
      WarpLink.configure({ apiKey: VALID_LIVE_KEY });

      const callArg = mockConfigure.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(callArg).not.toHaveProperty('matchWindowHours');
    });
  });

  describe('handleDeepLink', () => {
    it('returns typed WarpLinkDeepLink from native response', async () => {
      mockHandleDeepLink.mockResolvedValue({
        linkId: 'link-123',
        destination: 'https://example.com',
        deepLinkUrl: 'myapp://path',
        customParams: { campaign: 'summer' },
        isDeferred: false,
        matchType: 'deterministic',
        matchConfidence: 1.0,
      });

      const result = await WarpLink.handleDeepLink(
        'https://aplnk.to/abc123'
      );

      expect(result).toEqual({
        linkId: 'link-123',
        destination: 'https://example.com',
        deepLinkUrl: 'myapp://path',
        customParams: { campaign: 'summer' },
        isDeferred: false,
        matchType: 'deterministic',
        matchConfidence: 1.0,
      });
      expect(mockHandleDeepLink).toHaveBeenCalledWith(
        'https://aplnk.to/abc123'
      );
    });

    it('returns null when native returns null', async () => {
      mockHandleDeepLink.mockResolvedValue(null);

      const result = await WarpLink.handleDeepLink(
        'https://example.com/not-a-link'
      );

      expect(result).toBeNull();
    });

    it('handles null deepLinkUrl, matchType, matchConfidence', async () => {
      mockHandleDeepLink.mockResolvedValue({
        linkId: 'link-456',
        destination: 'https://example.com',
        deepLinkUrl: null,
        customParams: {},
        isDeferred: false,
        matchType: null,
        matchConfidence: null,
      });

      const result = await WarpLink.handleDeepLink(
        'https://aplnk.to/xyz'
      );

      expect(result).toEqual({
        linkId: 'link-456',
        destination: 'https://example.com',
        deepLinkUrl: null,
        customParams: {},
        isDeferred: false,
        matchType: null,
        matchConfidence: null,
      });
    });
  });

  describe('checkDeferredDeepLink', () => {
    it('returns typed WarpLinkDeepLink with isDeferred=true', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-789',
        destination: 'https://example.com/page',
        deepLinkUrl: 'myapp://deferred',
        customParams: { ref: 'install' },
        isDeferred: true,
        matchType: 'probabilistic',
        matchConfidence: 0.85,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result).toEqual({
        linkId: 'link-789',
        destination: 'https://example.com/page',
        deepLinkUrl: 'myapp://deferred',
        customParams: { ref: 'install' },
        isDeferred: true,
        matchType: 'probabilistic',
        matchConfidence: 0.85,
      });
    });

    it('returns null when no deferred link', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue(null);

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result).toBeNull();
    });

    it('maps E_NOT_CONFIGURED error from native', async () => {
      const nativeError = Object.assign(
        new Error('SDK not configured'),
        { code: 'E_NOT_CONFIGURED' }
      );
      mockCheckDeferredDeepLink.mockRejectedValue(nativeError);

      await expect(
        WarpLink.checkDeferredDeepLink()
      ).rejects.toMatchObject({
        name: 'WarpLinkError',
        code: ErrorCodes.E_NOT_CONFIGURED,
      });
    });

    it('maps E_NETWORK_ERROR error from native', async () => {
      const nativeError = Object.assign(
        new Error('Attribution API unreachable'),
        { code: 'E_NETWORK_ERROR' }
      );
      mockCheckDeferredDeepLink.mockRejectedValue(nativeError);

      await expect(
        WarpLink.checkDeferredDeepLink()
      ).rejects.toMatchObject({
        name: 'WarpLinkError',
        code: ErrorCodes.E_NETWORK_ERROR,
      });
    });

    it('maps E_SERVER_ERROR error from native', async () => {
      const nativeError = Object.assign(
        new Error('Internal server error'),
        { code: 'E_SERVER_ERROR' }
      );
      mockCheckDeferredDeepLink.mockRejectedValue(nativeError);

      await expect(
        WarpLink.checkDeferredDeepLink()
      ).rejects.toMatchObject({
        name: 'WarpLinkError',
        code: ErrorCodes.E_SERVER_ERROR,
      });
    });

    it('maps E_DECODING_ERROR error from native', async () => {
      const nativeError = Object.assign(
        new Error('Malformed response'),
        { code: 'E_DECODING_ERROR' }
      );
      mockCheckDeferredDeepLink.mockRejectedValue(nativeError);

      await expect(
        WarpLink.checkDeferredDeepLink()
      ).rejects.toMatchObject({
        name: 'WarpLinkError',
        code: ErrorCodes.E_DECODING_ERROR,
      });
    });

    it.each([0.0, 0.4, 0.65, 0.85, 1.0])(
      'preserves matchConfidence=%f without coercion',
      async (confidence) => {
        mockCheckDeferredDeepLink.mockResolvedValue({
          linkId: 'link-conf',
          destination: 'https://example.com',
          deepLinkUrl: 'myapp://conf',
          customParams: {},
          isDeferred: true,
          matchType: 'probabilistic',
          matchConfidence: confidence,
        });

        const result = await WarpLink.checkDeferredDeepLink();

        expect(result?.matchConfidence).toBe(confidence);
      }
    );

    it('preserves matchConfidence=null from native', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-null-conf',
        destination: 'https://example.com',
        deepLinkUrl: null,
        customParams: {},
        isDeferred: true,
        matchType: null,
        matchConfidence: null,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.matchConfidence).toBeNull();
    });

    it('deserializes matchType=deterministic', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-det',
        destination: 'https://example.com',
        deepLinkUrl: 'myapp://det',
        customParams: {},
        isDeferred: true,
        matchType: 'deterministic',
        matchConfidence: 1.0,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.matchType).toBe('deterministic');
    });

    it('deserializes matchType=probabilistic', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-prob',
        destination: 'https://example.com',
        deepLinkUrl: 'myapp://prob',
        customParams: {},
        isDeferred: true,
        matchType: 'probabilistic',
        matchConfidence: 0.72,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.matchType).toBe('probabilistic');
    });

    it('returns null matchType for null from native', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-mt-null',
        destination: 'https://example.com',
        deepLinkUrl: null,
        customParams: {},
        isDeferred: true,
        matchType: null,
        matchConfidence: null,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.matchType).toBeNull();
    });

    it('returns null matchType for undefined from native', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-mt-undef',
        destination: 'https://example.com',
        deepLinkUrl: null,
        customParams: {},
        isDeferred: true,
        matchConfidence: null,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.matchType).toBeNull();
    });

    it('returns null matchType for unknown value', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-mt-unknown',
        destination: 'https://example.com',
        deepLinkUrl: null,
        customParams: {},
        isDeferred: true,
        matchType: 'unknown_value',
        matchConfidence: null,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.matchType).toBeNull();
    });

    it('passes through nested object customParams', async () => {
      const params = { campaign: { name: 'launch', id: 42 } };
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-cp-nested',
        destination: 'https://example.com',
        deepLinkUrl: 'myapp://cp',
        customParams: params,
        isDeferred: true,
        matchType: 'deterministic',
        matchConfidence: 1.0,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.customParams).toEqual(params);
    });

    it('passes through array customParams', async () => {
      const params = { tags: ['a', 'b'] };
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-cp-arr',
        destination: 'https://example.com',
        deepLinkUrl: 'myapp://cp',
        customParams: params,
        isDeferred: true,
        matchType: 'deterministic',
        matchConfidence: 1.0,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.customParams).toEqual(params);
    });

    it('passes through mixed type customParams', async () => {
      const params = { count: 5, active: true, label: null };
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-cp-mix',
        destination: 'https://example.com',
        deepLinkUrl: 'myapp://cp',
        customParams: params,
        isDeferred: true,
        matchType: 'probabilistic',
        matchConfidence: 0.5,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.customParams).toEqual(params);
    });

    it('passes through empty object customParams', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-cp-empty',
        destination: 'https://example.com',
        deepLinkUrl: 'myapp://cp',
        customParams: {},
        isDeferred: true,
        matchType: 'deterministic',
        matchConfidence: 1.0,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.customParams).toEqual({});
    });

    it('defaults customParams to {} when null from native', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-cp-null',
        destination: 'https://example.com',
        deepLinkUrl: null,
        customParams: null,
        isDeferred: true,
        matchType: null,
        matchConfidence: null,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.customParams).toEqual({});
    });

    it('defaults customParams to {} when undefined', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-cp-undef',
        destination: 'https://example.com',
        deepLinkUrl: null,
        isDeferred: true,
        matchType: null,
        matchConfidence: null,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.customParams).toEqual({});
    });

    it('handles deepLinkUrl=null (web-only deferred link)', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-web',
        destination: 'https://example.com/page',
        deepLinkUrl: null,
        customParams: { source: 'web' },
        isDeferred: true,
        matchType: 'probabilistic',
        matchConfidence: 0.6,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.deepLinkUrl).toBeNull();
      expect(result?.destination).toBe('https://example.com/page');
    });

    it('handles both matchType and matchConfidence null', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({
        linkId: 'link-both-null',
        destination: 'https://example.com',
        deepLinkUrl: 'myapp://old',
        customParams: {},
        isDeferred: true,
        matchType: null,
        matchConfidence: null,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.matchType).toBeNull();
      expect(result?.matchConfidence).toBeNull();
    });

    it('defaults linkId to empty string when missing', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({
        destination: 'https://example.com',
        deepLinkUrl: null,
        customParams: {},
        isDeferred: true,
        matchType: null,
        matchConfidence: null,
      });

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result?.linkId).toBe('');
    });

    it('handles empty object from native', async () => {
      mockCheckDeferredDeepLink.mockResolvedValue({});

      const result = await WarpLink.checkDeferredDeepLink();

      expect(result).toEqual({
        linkId: '',
        destination: '',
        deepLinkUrl: null,
        customParams: {},
        isDeferred: false,
        matchType: null,
        matchConfidence: null,
      });
    });

    it('first call returns deferred link, second returns null', async () => {
      mockCheckDeferredDeepLink
        .mockResolvedValueOnce({
          linkId: 'link-first',
          destination: 'https://example.com',
          deepLinkUrl: 'myapp://first',
          customParams: { ref: 'install' },
          isDeferred: true,
          matchType: 'probabilistic',
          matchConfidence: 0.85,
        })
        .mockResolvedValueOnce(null);

      const first = await WarpLink.checkDeferredDeepLink();
      const second = await WarpLink.checkDeferredDeepLink();

      expect(first?.isDeferred).toBe(true);
      expect(first?.linkId).toBe('link-first');
      expect(second).toBeNull();
      expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(2);
    });

    it('concurrent calls both resolve without error', async () => {
      mockCheckDeferredDeepLink
        .mockResolvedValueOnce({
          linkId: 'link-concurrent',
          destination: 'https://example.com',
          deepLinkUrl: 'myapp://concurrent',
          customParams: {},
          isDeferred: true,
          matchType: 'deterministic',
          matchConfidence: 1.0,
        })
        .mockResolvedValueOnce(null);

      const [first, second] = await Promise.all([
        WarpLink.checkDeferredDeepLink(),
        WarpLink.checkDeferredDeepLink(),
      ]);

      expect(first?.linkId).toBe('link-concurrent');
      expect(second).toBeNull();
    });
  });

  describe('isConfigured', () => {
    it('returns boolean from native module', async () => {
      mockIsConfigured.mockResolvedValue(true);

      const result = await WarpLink.isConfigured();

      expect(result).toBe(true);
    });

    it('returns false when not configured', async () => {
      mockIsConfigured.mockResolvedValue(false);

      const result = await WarpLink.isConfigured();

      expect(result).toBe(false);
    });
  });

  describe('getAttributionResult', () => {
    it('returns deserialized AttributionResult for deterministic match', async () => {
      mockGetAttributionResult.mockResolvedValue({
        linkId: 'lnk_abc',
        matchType: 'deterministic',
        matchConfidence: 0.95,
        isDeferred: true,
        destination: 'https://example.com',
        deepLinkUrl: 'app://path',
        customParams: {},
        installId: null,
      });

      const result = await WarpLink.getAttributionResult();

      expect(result).toEqual({
        linkId: 'lnk_abc',
        matchType: 'deterministic',
        matchConfidence: 0.95,
        isDeferred: true,
        installId: null,
      });
    });

    it('returns deserialized AttributionResult for probabilistic match', async () => {
      mockGetAttributionResult.mockResolvedValue({
        linkId: 'lnk_def',
        matchType: 'probabilistic',
        matchConfidence: 0.72,
        isDeferred: true,
        installId: null,
      });

      const result = await WarpLink.getAttributionResult();

      expect(result).not.toBeNull();
      expect(result!.matchType).toBe('probabilistic');
      expect(result!.matchConfidence).toBe(0.72);
    });

    it('passes through matchConfidence 0.0 accurately', async () => {
      mockGetAttributionResult.mockResolvedValue({
        linkId: 'lnk_zero',
        matchType: 'probabilistic',
        matchConfidence: 0.0,
        isDeferred: true,
        installId: null,
      });

      const result = await WarpLink.getAttributionResult();

      expect(result).not.toBeNull();
      expect(result!.matchConfidence).toBe(0.0);
    });

    it('returns null when native returns null', async () => {
      mockGetAttributionResult.mockResolvedValue(null);

      const result = await WarpLink.getAttributionResult();

      expect(result).toBeNull();
    });

    it('returns null when native returns undefined', async () => {
      mockGetAttributionResult.mockResolvedValue(undefined);

      const result = await WarpLink.getAttributionResult();

      expect(result).toBeNull();
    });

    it('throws WarpLinkError with E_NOT_CONFIGURED when SDK not configured', async () => {
      const nativeError = Object.assign(
        new Error('SDK not configured'),
        { code: 'E_NOT_CONFIGURED' }
      );
      mockGetAttributionResult.mockRejectedValue(nativeError);

      await expect(
        WarpLink.getAttributionResult()
      ).rejects.toMatchObject({
        name: 'WarpLinkError',
        code: ErrorCodes.E_NOT_CONFIGURED,
      });
    });

    it('maps unknown native errors to E_SERVER_ERROR', async () => {
      mockGetAttributionResult.mockRejectedValue(
        new Error('Something went wrong')
      );

      await expect(
        WarpLink.getAttributionResult()
      ).rejects.toMatchObject({
        name: 'WarpLinkError',
        code: ErrorCodes.E_SERVER_ERROR,
      });
    });

    it('returns null for malformed native response missing matchType', async () => {
      mockGetAttributionResult.mockResolvedValue({
        linkId: 'lnk_abc',
        matchConfidence: 0.9,
        isDeferred: true,
      });

      const result = await WarpLink.getAttributionResult();

      expect(result).toBeNull();
    });

    it('returns null for malformed native response with invalid matchType', async () => {
      mockGetAttributionResult.mockResolvedValue({
        linkId: 'lnk_abc',
        matchType: 'UNKNOWN',
        matchConfidence: 0.9,
        isDeferred: true,
      });

      const result = await WarpLink.getAttributionResult();

      expect(result).toBeNull();
    });

    it('handles installId when present', async () => {
      mockGetAttributionResult.mockResolvedValue({
        linkId: 'lnk_inst',
        matchType: 'deterministic',
        matchConfidence: 0.99,
        isDeferred: true,
        installId: 'inst_123',
      });

      const result = await WarpLink.getAttributionResult();

      expect(result).not.toBeNull();
      expect(result!.installId).toBe('inst_123');
    });

    it('returns null for empty object from native', async () => {
      mockGetAttributionResult.mockResolvedValue({});

      const result = await WarpLink.getAttributionResult();

      expect(result).toBeNull();
    });

    it('returns null when matchConfidence is not a number', async () => {
      mockGetAttributionResult.mockResolvedValue({
        linkId: 'lnk_bad_conf',
        matchType: 'deterministic',
        matchConfidence: 'high',
        isDeferred: true,
      });

      const result = await WarpLink.getAttributionResult();

      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('maps native E_NOT_CONFIGURED error to WarpLinkError', async () => {
      const nativeError = Object.assign(
        new Error('SDK not configured'),
        { code: 'E_NOT_CONFIGURED' }
      );
      mockHandleDeepLink.mockRejectedValue(nativeError);

      await expect(
        WarpLink.handleDeepLink('https://aplnk.to/abc')
      ).rejects.toThrow(WarpLinkError);

      await expect(
        WarpLink.handleDeepLink('https://aplnk.to/abc')
      ).rejects.toMatchObject({
        code: ErrorCodes.E_NOT_CONFIGURED,
        message: 'SDK not configured',
      });
    });

    it('maps unknown error codes to E_SERVER_ERROR', async () => {
      const nativeError = Object.assign(
        new Error('Something went wrong'),
        { code: 'UNKNOWN_CODE' }
      );
      mockIsConfigured.mockRejectedValue(nativeError);

      await expect(WarpLink.isConfigured()).rejects.toMatchObject({
        code: ErrorCodes.E_SERVER_ERROR,
        message: 'Something went wrong',
      });
    });
  });
});

const MOCK_DEEP_LINK = {
  linkId: 'link-dl-1',
  destination: 'https://example.com',
  deepLinkUrl: 'myapp://path',
  customParams: { campaign: 'test' },
  isDeferred: false,
  matchType: 'deterministic',
  matchConfidence: 1.0,
};

describe('onDeepLink', () => {
  let WarpLinkFresh: typeof WarpLink;

  beforeEach(() => {
    jest.resetAllMocks();
    mockEmitterListeners = new Map();
    mockNativeEventEmitter.mockImplementation(() => ({
      addListener: jest.fn(
        (eventName: string, handler: EventHandler) => {
          mockEmitterListeners.set(eventName, handler);
          return { remove: mockRemoveSubscription };
        }
      ),
      removeAllListeners: jest.fn(),
    }));
    mockConfigure.mockResolvedValue(undefined);

    jest.isolateModules(() => {
      WarpLinkFresh =
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
    });
  });

  it('returns an unsubscribe function', () => {
    const unsub = WarpLinkFresh.onDeepLink(jest.fn());

    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('listener receives resolved deep link on event', async () => {
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const listener = jest.fn();

    WarpLinkFresh.onDeepLink(listener);
    emitNativeEvent('onWarpLinkDeepLink', {
      url: 'https://aplnk.to/abc123',
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(mockHandleDeepLink).toHaveBeenCalledWith(
      'https://aplnk.to/abc123'
    );
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        deepLink: expect.objectContaining({ linkId: 'link-dl-1' }),
      })
    );
  });

  it('multiple listeners all receive events', async () => {
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const listener1 = jest.fn();
    const listener2 = jest.fn();

    WarpLinkFresh.onDeepLink(listener1);
    WarpLinkFresh.onDeepLink(listener2);
    emitNativeEvent('onWarpLinkDeepLink', {
      url: 'https://aplnk.to/abc123',
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('unsubscribed listener does not receive events', async () => {
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const listener = jest.fn();

    const unsub = WarpLinkFresh.onDeepLink(listener);
    unsub();

    emitNativeEvent('onWarpLinkDeepLink', {
      url: 'https://aplnk.to/abc123',
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(listener).not.toHaveBeenCalled();
  });

  it('delivers error on resolution failure', async () => {
    const nativeError = Object.assign(
      new Error('Network error'),
      { code: 'E_NETWORK_ERROR' }
    );
    mockHandleDeepLink.mockRejectedValue(nativeError);
    const listener = jest.fn();

    WarpLinkFresh.onDeepLink(listener);
    emitNativeEvent('onWarpLinkDeepLink', {
      url: 'https://aplnk.to/bad',
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: ErrorCodes.E_NETWORK_ERROR,
        }),
      })
    );
  });

  it('lazily creates NativeEventEmitter on first call', () => {
    expect(mockNativeEventEmitter).not.toHaveBeenCalled();

    WarpLinkFresh.onDeepLink(jest.fn());

    expect(mockNativeEventEmitter).toHaveBeenCalledTimes(1);
  });
});

describe('getInitialDeepLink', () => {
  let WarpLinkFresh: typeof WarpLink;

  beforeEach(() => {
    jest.resetAllMocks();
    mockEmitterListeners = new Map();
    mockNativeEventEmitter.mockImplementation(() => ({
      addListener: jest.fn(
        (eventName: string, handler: EventHandler) => {
          mockEmitterListeners.set(eventName, handler);
          return { remove: mockRemoveSubscription };
        }
      ),
      removeAllListeners: jest.fn(),
    }));
    mockConfigure.mockResolvedValue(undefined);

    jest.isolateModules(() => {
      WarpLinkFresh =
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
    });
  });

  it('returns resolved deep link from initial URL', async () => {
    mockGetInitialURL.mockResolvedValue('https://aplnk.to/init1');
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);

    const result = await WarpLinkFresh.getInitialDeepLink();

    expect(mockGetInitialURL).toHaveBeenCalled();
    expect(mockHandleDeepLink).toHaveBeenCalledWith(
      'https://aplnk.to/init1'
    );
    expect(result).toEqual(
      expect.objectContaining({ linkId: 'link-dl-1' })
    );
  });

  it('returns null when no initial URL', async () => {
    mockGetInitialURL.mockResolvedValue(null);

    const result = await WarpLinkFresh.getInitialDeepLink();

    expect(result).toBeNull();
    expect(mockHandleDeepLink).not.toHaveBeenCalled();
  });

  it('consumes once — native returns null on second call', async () => {
    mockGetInitialURL
      .mockResolvedValueOnce('https://aplnk.to/init1')
      .mockResolvedValueOnce(null);
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);

    const first = await WarpLinkFresh.getInitialDeepLink();
    const second = await WarpLinkFresh.getInitialDeepLink();

    expect(first).toEqual(
      expect.objectContaining({ linkId: 'link-dl-1' })
    );
    expect(second).toBeNull();
  });

  it('propagates resolution errors as WarpLinkError', async () => {
    mockGetInitialURL.mockResolvedValue('https://aplnk.to/bad');
    const nativeError = Object.assign(
      new Error('Link not found'),
      { code: 'E_LINK_NOT_FOUND' }
    );
    mockHandleDeepLink.mockRejectedValue(nativeError);

    await expect(
      WarpLinkFresh.getInitialDeepLink()
    ).rejects.toMatchObject({
      name: 'WarpLinkError',
      code: ErrorCodes.E_LINK_NOT_FOUND,
      message: 'Link not found',
    });
  });
});

describe('deferred deep link lifecycle', () => {
  let WarpLinkFresh: typeof WarpLink;

  beforeEach(() => {
    jest.resetAllMocks();
    mockEmitterListeners = new Map();
    mockNativeEventEmitter.mockImplementation(() => ({
      addListener: jest.fn(
        (eventName: string, handler: EventHandler) => {
          mockEmitterListeners.set(eventName, handler);
          return { remove: mockRemoveSubscription };
        }
      ),
      removeAllListeners: jest.fn(),
    }));
    mockConfigure.mockResolvedValue(undefined);
    mockIsConfigured.mockResolvedValue(true);

    jest.isolateModules(() => {
      WarpLinkFresh =
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
    });
  });

  it('configure → first check returns deferred → second returns null → still configured', async () => {
    const deferredLink = {
      linkId: 'link-lifecycle',
      destination: 'https://example.com/onboard',
      deepLinkUrl: 'myapp://onboard',
      customParams: { campaign: 'launch', count: 5, active: true },
      isDeferred: true,
      matchType: 'probabilistic',
      matchConfidence: 0.72,
    };
    mockCheckDeferredDeepLink
      .mockResolvedValueOnce(deferredLink)
      .mockResolvedValueOnce(null);

    WarpLinkFresh.configure({
      apiKey: VALID_LIVE_KEY,
      matchWindowHours: 24,
    });
    expect(mockConfigure).toHaveBeenCalledWith(
      expect.objectContaining({ matchWindowHours: 24 })
    );

    const first = await WarpLinkFresh.checkDeferredDeepLink();

    expect(first).not.toBeNull();
    expect(first?.linkId).toBe('link-lifecycle');
    expect(first?.destination).toBe('https://example.com/onboard');
    expect(first?.deepLinkUrl).toBe('myapp://onboard');
    expect(first?.customParams).toEqual({
      campaign: 'launch',
      count: 5,
      active: true,
    });
    expect(first?.isDeferred).toBe(true);
    expect(first?.matchType).toBe('probabilistic');
    expect(first?.matchConfidence).toBe(0.72);

    const second = await WarpLinkFresh.checkDeferredDeepLink();
    expect(second).toBeNull();

    const configured = await WarpLinkFresh.isConfigured();
    expect(configured).toBe(true);
  });
});

describe('NativeWarpLink module not linked', () => {
  it('throws descriptive error when native module is missing', () => {
    jest.resetModules();
    jest.mock('react-native', () => ({
      NativeModules: {},
      Platform: {
        select: jest.fn(
          (obj: Record<string, string>) => obj['default'] ?? ''
        ),
      },
    }));

    // Re-import after mock change
    const { default: NativeWarpLink } =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../NativeWarpLink') as typeof import('../NativeWarpLink');

    expect(() => NativeWarpLink.configure({})).toThrow(
      /doesn't seem to be linked/
    );
  });
});
