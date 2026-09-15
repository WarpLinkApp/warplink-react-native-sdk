const mockConfigure = jest.fn();
const mockHandleDeepLink = jest.fn();
const mockIsWarpLinkUrl = jest.fn();
const mockCheckDeferredDeepLink = jest.fn();
const mockGetAttributionResult = jest.fn();
const mockIsConfigured = jest.fn();
const mockIsAttributionComplete = jest.fn();
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
      isWarpLinkUrl: mockIsWarpLinkUrl,
      checkDeferredDeepLink: mockCheckDeferredDeepLink,
      getAttributionResult: mockGetAttributionResult,
      isConfigured: mockIsConfigured,
      isAttributionComplete: mockIsAttributionComplete,
      getInitialURL: mockGetInitialURL,
    },
  },
  Platform: {
    select: jest.fn((obj: Record<string, string>) => obj['default'] ?? ''),
  },
  NativeEventEmitter: mockNativeEventEmitter,
}));

import { WarpLink } from '../WarpLink';
import { WarpLinkError, ErrorCodes, type DeepLinkEvent } from '../types';
import { classifyLikeNative } from '../../test-utils/classify-like-native';

const VALID_LIVE_KEY = 'wl_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const VALID_TEST_KEY = 'wl_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';

function emitNativeEvent(
  eventName: string,
  data: Record<string, unknown>
): void {
  const handler = mockEmitterListeners.get(eventName);
  if (handler) handler(data);
}

/**
 * Drain the pending promise chain, without a wall clock.
 *
 * The native module is mocked, so nothing here waits on real work: every await
 * in the code under test resolves on a queue turn. `setImmediate` runs after
 * those turns, and repeating it clears a chain where one await schedules the
 * next. A fixed `setTimeout(..., 10)` did the same job by spending 10 ms and
 * assuming that was enough, which is an assumption with no observer: on a
 * loaded machine the assertion could run first and fail for a reason that has
 * nothing to do with the SDK.
 */
const flushPromises = async (turns = 5): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

describe('WarpLink', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockIsWarpLinkUrl.mockImplementation(classifyLikeNative);
    mockConfigure.mockResolvedValue(undefined);
    // Default: attribution not yet complete, so the automatic deferred dispatch
    // runs. Tests that assert at-most-once override this to true.
    mockIsAttributionComplete.mockResolvedValue(false);
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
    const BAD_KEYS: [string, string][] = [
      ['empty string', ''],
      ['missing wl_ prefix', 'live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'],
      ['wrong environment segment', 'wl_prod_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'],
      ['too few chars after prefix', 'wl_live_short'],
      ['too many chars after prefix', 'wl_live_' + 'a'.repeat(40)],
      ['special characters', 'wl_live_a1b2c3d4-e5f6-g7h8-i9j0k1l2m3n4'],
    ];

    // WL-S11: report and return, never throw. iOS and Android behave the same;
    // React Native used to throw, which crashed the host over a setup mistake.
    it.each(BAD_KEYS)('reports %s through onLink without throwing', async (_label, key) => {
      const onLink = jest.fn();

      await expect(WarpLink.configure({ apiKey: key, onLink })).resolves.toBeUndefined();

      expect(onLink).toHaveBeenCalledTimes(1);
      const event = onLink.mock.calls[0][0];
      expect(event.deepLink).toBeUndefined();
      expect(event.error).toBeInstanceOf(WarpLinkError);
      expect(event.error.code).toBe(ErrorCodes.E_INVALID_API_KEY_FORMAT);
    });

    it('warns even when the host supplied no onLink, so the fault is never silent', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(WarpLink.configure({ apiKey: 'bad' })).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid API key format'));
      warn.mockRestore();
    });

    it('does not configure the native module when the key is malformed', async () => {
      await WarpLink.configure({ apiKey: 'bad' });

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

  describe('deferred no-match', () => {
    it('WL-S05 does not dispatch a deferred no-match to onLink', async () => {
      mockGetInitialURL.mockResolvedValue(null);
      mockCheckDeferredDeepLink.mockResolvedValue(null);
      const onLink = jest.fn();

      await WarpLink.configure({ apiKey: VALID_LIVE_KEY, onLink });
      await flushPromises();

      // The check ran: that request is what attributes the install.
      expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
      // A no-match is not an event the host can act on, so nothing reaches onLink.
      expect(onLink).not.toHaveBeenCalled();
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
    it('returns a promise (no swallowed-rejection footgun)', () => {
      const result = WarpLink.configure({ apiKey: VALID_LIVE_KEY });
      expect(result).toBeInstanceOf(Promise);
      return result;
    });

    it('rejects with mapped WarpLinkError when native config fails and no onLink', async () => {
      const nativeError = Object.assign(
        new Error('API key rejected'),
        { code: 'E_INVALID_API_KEY' }
      );
      mockConfigure.mockRejectedValue(nativeError);

      await expect(
        WarpLink.configure({ apiKey: VALID_LIVE_KEY })
      ).rejects.toMatchObject({
        name: 'WarpLinkError',
        code: ErrorCodes.E_INVALID_API_KEY,
      });
    });

    it('routes native config error to onLink and resolves (no rejection)', async () => {
      const nativeError = Object.assign(
        new Error('API key rejected'),
        { code: 'E_INVALID_API_KEY' }
      );
      mockConfigure.mockRejectedValue(nativeError);
      const onLink = jest.fn();

      // Auto-wiring off so no cold/deferred native calls fire.
      await expect(
        WarpLink.configure({
          apiKey: VALID_LIVE_KEY,
          onLink,
          automaticDeepLinks: false,
          automaticDeferredDeepLinks: false,
        })
      ).resolves.toBeUndefined();

      expect(onLink).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: ErrorCodes.E_INVALID_API_KEY,
          }),
        })
      );
    });

    it('does not pass onLink or flags across the native bridge', async () => {
      const onLink = jest.fn();

      await WarpLink.configure({
        apiKey: VALID_LIVE_KEY,
        onLink,
        automaticDeepLinks: false,
        automaticDeferredDeepLinks: false,
      });

      const callArg = mockConfigure.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(callArg).toEqual({ apiKey: VALID_LIVE_KEY });
      expect(callArg).not.toHaveProperty('onLink');
      expect(callArg).not.toHaveProperty('automaticDeepLinks');
    });
  });

  describe('configure() optional config passthrough', () => {
    it('passes all forwarded optional fields when provided', () => {
      WarpLink.configure({
        apiKey: VALID_LIVE_KEY,
        apiEndpoint: 'https://custom.api.com',
        debugLogging: true,
      });

      expect(mockConfigure).toHaveBeenCalledWith({
        apiKey: VALID_LIVE_KEY,
        apiEndpoint: 'https://custom.api.com',
        debugLogging: true,
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

    it('does not forward the deprecated matchWindowHours to native', () => {
      // matchWindowHours is a server-side, per-link setting; the native SDKs no
      // longer accept it, so the deprecated config field is a no-op and must
      // not be forwarded to native configure().
      WarpLink.configure({
        apiKey: VALID_LIVE_KEY,
        matchWindowHours: 48,
      });

      expect(mockConfigure.mock.calls[0]![0]).not.toHaveProperty(
        'matchWindowHours'
      );
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

  describe('configure() linkDomains passthrough', () => {
    // conformance: WL-S08 (React Native half only). Recognizing a custom domain
    // on the first launch is native; all this layer owes the scenario is getting
    // the host's declaration across the bridge before that first launch resolves
    // anything.
    it('WL-S08 forwards linkDomains to native configure()', () => {
      WarpLink.configure({
        apiKey: VALID_LIVE_KEY,
        linkDomains: ['links.myapp.com', 'go.myapp.com'],
      });

      expect(mockConfigure).toHaveBeenCalledWith({
        apiKey: VALID_LIVE_KEY,
        linkDomains: ['links.myapp.com', 'go.myapp.com'],
      });
    });

    it('forwards the entries verbatim, normalizing nothing', () => {
      // This package owns no normalization: trimming, lowercasing and reducing a
      // URL to its host all happen natively, where the plist / manifest
      // declarations are read too. Touching the strings here would fork that
      // logic into a third implementation that can disagree with both.
      const raw = ['  HTTPS://Links.MyApp.com/ ', 'www.myapp.com'];

      WarpLink.configure({ apiKey: VALID_LIVE_KEY, linkDomains: raw });

      const callArg = mockConfigure.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(callArg['linkDomains']).toEqual([
        '  HTTPS://Links.MyApp.com/ ',
        'www.myapp.com',
      ]);
    });

    it('forwards an explicitly empty list rather than dropping the key', () => {
      // `[]` is a host saying "no extra domains", which is what the native side
      // already assumes. Passing it through keeps the bridge payload a faithful
      // copy of the options object instead of a second place that decides what
      // an empty declaration means.
      WarpLink.configure({ apiKey: VALID_LIVE_KEY, linkDomains: [] });

      expect(mockConfigure).toHaveBeenCalledWith({
        apiKey: VALID_LIVE_KEY,
        linkDomains: [],
      });
    });

    it('omits linkDomains when the host does not declare any', () => {
      // Additive by construction: an existing integration must produce the same
      // bridge payload it did before the option existed.
      WarpLink.configure({ apiKey: VALID_LIVE_KEY });

      const callArg = mockConfigure.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(callArg).not.toHaveProperty('linkDomains');
    });

    it('keeps auto-wiring working when linkDomains is declared', async () => {
      // The option must not disturb the opt-out path: a cold-start link still
      // reaches onLink on the same launch that declares a custom domain.
      mockGetInitialURL.mockResolvedValue('https://links.myapp.com/abc123');
      mockHandleDeepLink.mockResolvedValue({
        linkId: 'link-1',
        destination: 'https://myapp.com/product/1',
        deepLinkUrl: 'myapp://product/1',
        customParams: {},
        isDeferred: false,
        matchType: 'deterministic',
        matchConfidence: 1,
      });
      mockCheckDeferredDeepLink.mockResolvedValue(null);
      const onLink = jest.fn();

      await WarpLink.configure({
        apiKey: VALID_LIVE_KEY,
        linkDomains: ['links.myapp.com'],
        onLink,
      });

      expect(onLink).toHaveBeenCalledWith(
        expect.objectContaining({
          deepLink: expect.objectContaining({ linkId: 'link-1' }),
        })
      );
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
        matchGuaranteed: false,
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
        matchGuaranteed: false,
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
        matchGuaranteed: false,
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
        matchGuaranteed: false,
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

  describe('attribution request body ownership', () => {
    // The identifier that tells the server which app of an organization an
    // install belongs to (`app_bundle_id` on iOS, `app_package_name` on
    // Android) is read from the host app by the native SDKs, which own the
    // POST /attribution/match body. The JS layer only bridges. This pins that
    // boundary: were JS to start issuing the request itself, it would have no
    // way to read the host bundle ID and would ship the request without it.
    it('is owned by native: JS issues no attribution request of its own', async () => {
      const fetchSpy = jest.fn();
      const globals = global as unknown as { fetch?: unknown };
      const originalFetch = globals.fetch;
      globals.fetch = fetchSpy;
      mockCheckDeferredDeepLink.mockResolvedValue(null);

      try {
        await WarpLink.configure({ apiKey: VALID_LIVE_KEY });
        await WarpLink.checkDeferredDeepLink();
      } finally {
        globals.fetch = originalFetch;
      }

      expect(mockCheckDeferredDeepLink).toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('forwards no app identity field to native configure()', () => {
      // Native reads the bundle ID / package name from its own context, so the
      // bridge must not be given one to forward: a JS-supplied value would let
      // a host declare which app an install is attributed to.
      WarpLink.configure({ apiKey: VALID_LIVE_KEY });

      const callArg = mockConfigure.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(callArg).not.toHaveProperty('appBundleId');
      expect(callArg).not.toHaveProperty('appPackageName');
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
      });

      const result = await WarpLink.getAttributionResult();

      expect(result).toEqual({
        linkId: 'lnk_abc',
        matchType: 'deterministic',
        matchConfidence: 0.95,
        isDeferred: true,
        matchGuaranteed: false,
      });
    });

    it('does not expose an installId field (removed in 1.1.0)', async () => {
      mockGetAttributionResult.mockResolvedValue({
        linkId: 'lnk_abc',
        matchType: 'deterministic',
        matchConfidence: 0.95,
        isDeferred: true,
        installId: 'inst_should_be_ignored',
      });

      const result = await WarpLink.getAttributionResult();

      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty('installId');
    });

    it('returns deserialized AttributionResult for probabilistic match', async () => {
      mockGetAttributionResult.mockResolvedValue({
        linkId: 'lnk_def',
        matchType: 'probabilistic',
        matchConfidence: 0.72,
        isDeferred: true,
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

    it('throws E_DECODING_ERROR for malformed response missing matchType', async () => {
      mockGetAttributionResult.mockResolvedValue({
        linkId: 'lnk_abc',
        matchConfidence: 0.9,
        isDeferred: true,
      });

      await expect(
        WarpLink.getAttributionResult()
      ).rejects.toMatchObject({
        name: 'WarpLinkError',
        code: ErrorCodes.E_DECODING_ERROR,
      });
    });

    it('throws E_DECODING_ERROR for response with invalid matchType', async () => {
      mockGetAttributionResult.mockResolvedValue({
        linkId: 'lnk_abc',
        matchType: 'UNKNOWN',
        matchConfidence: 0.9,
        isDeferred: true,
      });

      await expect(
        WarpLink.getAttributionResult()
      ).rejects.toMatchObject({
        name: 'WarpLinkError',
        code: ErrorCodes.E_DECODING_ERROR,
      });
    });

    it('throws E_DECODING_ERROR for a non-null empty object', async () => {
      mockGetAttributionResult.mockResolvedValue({});

      await expect(
        WarpLink.getAttributionResult()
      ).rejects.toMatchObject({
        name: 'WarpLinkError',
        code: ErrorCodes.E_DECODING_ERROR,
      });
    });

    it('throws E_DECODING_ERROR when matchConfidence is not a number', async () => {
      mockGetAttributionResult.mockResolvedValue({
        linkId: 'lnk_bad_conf',
        matchType: 'deterministic',
        matchConfidence: 'high',
        isDeferred: true,
      });

      await expect(
        WarpLink.getAttributionResult()
      ).rejects.toMatchObject({
        name: 'WarpLinkError',
        code: ErrorCodes.E_DECODING_ERROR,
      });
    });

    it('distinguishes genuine no-match (null) from a decode failure', async () => {
      // null → genuine no-match → null (no throw)
      mockGetAttributionResult.mockResolvedValueOnce(null);
      await expect(WarpLink.getAttributionResult()).resolves.toBeNull();

      // non-null malformed → decode failure → throw
      mockGetAttributionResult.mockResolvedValueOnce({ garbage: true });
      await expect(
        WarpLink.getAttributionResult()
      ).rejects.toMatchObject({ code: ErrorCodes.E_DECODING_ERROR });
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
    mockIsWarpLinkUrl.mockImplementation(classifyLikeNative);
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

    await flushPromises();

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

    await flushPromises();

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

    await flushPromises();

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

    await flushPromises();

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: ErrorCodes.E_NETWORK_ERROR,
        }),
      })
    );
  });

  it('still delivers E_INVALID_URL to explicit subscribers', async () => {
    const nativeError = Object.assign(new Error('Invalid URL'), {
      code: 'E_INVALID_URL',
    });
    mockHandleDeepLink.mockRejectedValue(nativeError);
    const listener = jest.fn();

    WarpLinkFresh.onDeepLink(listener);
    emitNativeEvent('onWarpLinkDeepLink', { url: 'myapp://oauth/callback' });

    await flushPromises();

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: ErrorCodes.E_INVALID_URL,
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
    mockIsWarpLinkUrl.mockImplementation(classifyLikeNative);
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
    mockIsWarpLinkUrl.mockImplementation(classifyLikeNative);
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

  it('WL-S07 a superseded deferred check does not dispatch to the newer onLink', async () => {
    // A second configure() while the first deferred check is still awaiting
    // native. Without a generation guard the abandoned run finds the NEW sink
    // in module state and delivers to it, and the new run then delivers its
    // own: one launch, two dispatches, older result first. iOS guards this with
    // applyIfCurrent(generation:) and Android by autoHandler identity.
    const SECOND_LINK = {
      linkId: 'link-second',
      destination: 'https://example.com/second',
      deepLinkUrl: null,
      customParams: {},
      isDeferred: true,
      matchType: 'deterministic',
      matchConfidence: 1,
      matchGuaranteed: true,
    };

    let releaseFirst: (value: unknown) => void = () => {};
    let markFirstCalled: () => void = () => {};
    // Both configures race to the same mock, so park the FIRST caller by call
    // count and wait for it below. Ordering the two runs with mockOnce queues
    // is not deterministic here: each configure awaits native config and the
    // cold-start dispatch before it ever reaches the deferred check.
    const firstCheckStarted = new Promise<void>((resolve) => {
      markFirstCalled = resolve;
    });
    let checkCalls = 0;
    mockCheckDeferredDeepLink.mockImplementation(() => {
      checkCalls += 1;
      if (checkCalls === 1) {
        markFirstCalled();
        return new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve(SECOND_LINK);
    });
    mockIsAttributionComplete.mockResolvedValue(false);
    mockGetInitialURL.mockResolvedValue(null);

    const first: DeepLinkEvent[] = [];
    const second: DeepLinkEvent[] = [];

    const firstConfigure = WarpLinkFresh.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (e) => first.push(e),
    });
    await firstCheckStarted;

    // Supersede it while the first check is parked on native.
    await WarpLinkFresh.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (e) => second.push(e),
    });

    releaseFirst({
      linkId: 'link-first',
      destination: 'https://example.com/first',
      deepLinkUrl: null,
      customParams: {},
      isDeferred: true,
      matchType: 'deterministic',
      matchConfidence: 1,
      matchGuaranteed: true,
    });
    await firstConfigure;

    // The abandoned run is silent, on both sinks.
    expect(first).toEqual([]);
    expect(second.map((e) => e.deepLink?.linkId)).toEqual(['link-second']);
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

    WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY });

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

  it('WL-S04 auto-dispatches a deferred match to onLink at most once across launches', async () => {
    const deferredLink = {
      linkId: 'link-once',
      destination: 'https://example.com/x',
      deepLinkUrl: 'myapp://x',
      customParams: {},
      isDeferred: true,
      matchType: 'probabilistic',
      matchConfidence: 0.6,
    };
    // Native returns the cached match on every call (it does not go null after
    // the first read); at-most-once must be enforced by the isAttributionComplete gate.
    mockCheckDeferredDeepLink.mockResolvedValue(deferredLink);
    mockGetInitialURL.mockResolvedValue(null);

    // First launch: attribution not yet complete -> the match is dispatched.
    mockIsAttributionComplete.mockResolvedValue(false);
    const events1: DeepLinkEvent[] = [];
    await WarpLinkFresh.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (e) => events1.push(e),
    });
    expect(events1).toContainEqual({
      deepLink: expect.objectContaining({ linkId: 'link-once', isDeferred: true }),
    });

    // Second launch: attribution already complete -> the cached match must NOT
    // be re-dispatched even though native checkDeferredDeepLink still returns it.
    mockIsAttributionComplete.mockResolvedValue(true);
    const events2: DeepLinkEvent[] = [];
    await WarpLinkFresh.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (e) => events2.push(e),
    });
    expect(events2).toEqual([]);
  });

  it('WL-S16 re-dispatches after a reinstall', async () => {
    // A reinstall counts as an install: the native per-install gate is back to
    // false on the first launch of the new install, even though the device-seen
    // marker survived the delete, so the deferred check runs again. Everything
    // here is decided natively; this pins that the TS orchestrator honours it
    // rather than caching "already attributed" of its own accord.
    mockGetInitialURL.mockResolvedValue(null);
    mockIsAttributionComplete.mockResolvedValue(false);
    mockCheckDeferredDeepLink.mockResolvedValue({
      linkId: 'link-reinstall',
      destination: 'https://example.com/back',
      deepLinkUrl: 'myapp://back',
      customParams: {},
      isDeferred: true,
      matchType: 'deterministic',
      matchConfidence: 1.0,
      matchGuaranteed: true,
    });

    const events: DeepLinkEvent[] = [];
    await WarpLinkFresh.configure({
      apiKey: VALID_LIVE_KEY,
      onLink: (e) => events.push(e),
    });

    expect(mockCheckDeferredDeepLink).toHaveBeenCalled();
    expect(events).toEqual([
      {
        deepLink: expect.objectContaining({
          linkId: 'link-reinstall',
          isDeferred: true,
        }),
      },
    ]);
  });
});

describe('opt-out auto-wiring via configure({ onLink })', () => {
  let WarpLinkFresh: typeof WarpLink;

  const flush = () => flushPromises();

  beforeEach(() => {
    jest.resetAllMocks();
    mockIsWarpLinkUrl.mockImplementation(classifyLikeNative);
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
    mockGetInitialURL.mockResolvedValue(null);
    mockCheckDeferredDeepLink.mockResolvedValue(null);

    jest.isolateModules(() => {
      WarpLinkFresh =
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
    });
  });

  it('WL-S01 auto-dispatches the cold-start deep link into onLink', async () => {
    mockGetInitialURL.mockResolvedValue('https://aplnk.to/cold');
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });

    expect(mockGetInitialURL).toHaveBeenCalled();
    expect(mockHandleDeepLink).toHaveBeenCalledWith(
      'https://aplnk.to/cold'
    );
    expect(onLink).toHaveBeenCalledWith(
      expect.objectContaining({
        deepLink: expect.objectContaining({ linkId: 'link-dl-1' }),
      })
    );
  });

  it('auto-dispatches warm-start deep links into onLink', async () => {
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });
    emitNativeEvent('onWarpLinkDeepLink', {
      url: 'https://aplnk.to/warm',
    });
    await flush();

    expect(mockHandleDeepLink).toHaveBeenCalledWith(
      'https://aplnk.to/warm'
    );
    expect(onLink).toHaveBeenCalledWith(
      expect.objectContaining({
        deepLink: expect.objectContaining({ linkId: 'link-dl-1' }),
      })
    );
  });

  it('auto-fires the deferred check and dispatches into onLink', async () => {
    mockCheckDeferredDeepLink.mockResolvedValue({
      linkId: 'link-deferred',
      destination: 'https://example.com/onboard',
      deepLinkUrl: 'myapp://onboard',
      customParams: {},
      isDeferred: true,
      matchType: 'probabilistic',
      matchConfidence: 0.72,
    });
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });

    expect(mockCheckDeferredDeepLink).toHaveBeenCalled();
    expect(onLink).toHaveBeenCalledWith(
      expect.objectContaining({
        deepLink: expect.objectContaining({
          linkId: 'link-deferred',
          isDeferred: true,
        }),
      })
    );
  });

  it('WL-S03 dedupes: same URL via cold start + warm start dispatches once', async () => {
    mockGetInitialURL.mockResolvedValue('https://aplnk.to/dup');
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });
    // Same URL arrives again as a warm-start event.
    emitNativeEvent('onWarpLinkDeepLink', {
      url: 'https://aplnk.to/dup',
    });
    await flush();

    const deepLinkCalls = onLink.mock.calls.filter(
      (c) => (c[0] as { deepLink?: unknown }).deepLink != null
    );
    expect(deepLinkCalls).toHaveLength(1);
  });

  it('re-dispatches the same URL after the dedupe window elapses', async () => {
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const onLink = jest.fn();
    // Freeze the clock so the two taps sit on either side of the 1500ms window.
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });

    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/repeat' });
    await flush();

    // Same URL tapped again well after the window: a new navigation, not a
    // cold/warm reconciliation, so it must dispatch again.
    nowSpy.mockReturnValue(3000);
    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/repeat' });
    await flush();

    nowSpy.mockRestore();

    const deepLinkCalls = onLink.mock.calls.filter(
      (c) => (c[0] as { deepLink?: unknown }).deepLink != null
    );
    expect(deepLinkCalls).toHaveLength(2);
  });

  it('WL-S22 a backward clock step does not suppress a later tap', async () => {
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const onLink = jest.fn();
    // Wall clock can move backwards: NTP correcting a drifted device, or the
    // user editing the date. Measured with Date.now() the elapsed subtraction
    // then goes negative, and a bare `<` reads every negative value as "inside
    // the window", so repeat taps are swallowed until the clock catches up.
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(10000);

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });

    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/back' });
    await flush();

    // Nine seconds backwards, far outside the 1500ms window.
    nowSpy.mockReturnValue(1000);
    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/back' });
    await flush();

    nowSpy.mockRestore();

    const deepLinkCalls = onLink.mock.calls.filter(
      (c) => (c[0] as { deepLink?: unknown }).deepLink != null
    );
    expect(deepLinkCalls).toHaveLength(2);
  });

  it('WL-S22 still suppresses a repeat inside the window', async () => {
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const onLink = jest.fn();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(10000);

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });

    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/win' });
    await flush();

    // Guards the fix from overshooting into "never dedupe".
    nowSpy.mockReturnValue(10500);
    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/win' });
    await flush();

    nowSpy.mockRestore();

    const deepLinkCalls = onLink.mock.calls.filter(
      (c) => (c[0] as { deepLink?: unknown }).deepLink != null
    );
    expect(deepLinkCalls).toHaveLength(1);
  });

  it('WL-S02 does not dedupe distinct URLs', async () => {
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });
    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/a' });
    // The second url arrives after the first has been delivered, as it does in
    // the Android and iOS WL-S02 tests. Two different links that OVERLAP are a
    // supersede, not two navigations: see cross-link-supersede.test.ts.
    await flush();
    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/b' });
    await flush();

    expect(mockHandleDeepLink).toHaveBeenCalledWith('https://aplnk.to/a');
    expect(mockHandleDeepLink).toHaveBeenCalledWith('https://aplnk.to/b');
    const deepLinkCalls = onLink.mock.calls.filter(
      (c) => (c[0] as { deepLink?: unknown }).deepLink != null
    );
    expect(deepLinkCalls).toHaveLength(2);
  });

  it('WL-S14 automaticDeepLinks:false skips cold + warm wiring', async () => {
    mockGetInitialURL.mockResolvedValue('https://aplnk.to/cold');
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const onLink = jest.fn();

    await WarpLinkFresh.configure({
      apiKey: VALID_LIVE_KEY,
      onLink,
      automaticDeepLinks: false,
    });
    emitNativeEvent('onWarpLinkDeepLink', {
      url: 'https://aplnk.to/warm',
    });
    await flush();

    expect(mockGetInitialURL).not.toHaveBeenCalled();
    // No warm handler registered → event resolves nothing.
    expect(mockHandleDeepLink).not.toHaveBeenCalled();
    expect(onLink).not.toHaveBeenCalled();
  });

  it('WL-S21 a native rejection reaches onLink as a WarpLinkError, not a raw Error', async () => {
    // A raw platform Error carrying a `code` property satisfies an
    // objectContaining({ code }) assertion unchanged, so the tests that check
    // only the code stay green even with the error mapping deleted. The type
    // is the thing a host branches on, so the type is what has to be pinned.
    //
    // Asserted by `name`, not `instanceof`: WarpLinkFresh is loaded through
    // jest.isolateModules, so it carries its own copy of the class and an
    // instanceof against this file's import fails on two identical
    // constructors. `name` is set in the constructor and crosses registries.
    const native = Object.assign(new Error('native blew up'), {
      code: ErrorCodes.E_NETWORK_ERROR,
    });
    mockHandleDeepLink.mockRejectedValue(native);
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });
    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/boom' });
    await flush();

    const failure = onLink.mock.calls
      .map((c) => (c[0] as DeepLinkEvent).error)
      .find((e): e is WarpLinkError => e != null);

    expect(failure).toMatchObject({ name: 'WarpLinkError' });
    // Not the same object: an unmapped pass-through would deliver the platform
    // Error itself, whose name is plain "Error".
    expect(failure).not.toBe(native);
    expect(failure?.name).not.toBe('Error');
    expect(failure?.code).toBe(ErrorCodes.E_NETWORK_ERROR);
  });

  it('WL-S26 a password protected link reaches onLink as E_PASSWORD_REQUIRED', async () => {
    // Resolve refuses a password protected link with a 403 that carries no
    // destination and no platform URLs. The native SDK decodes that refusal
    // and rejects with E_PASSWORD_REQUIRED; the bridge's job is to let the
    // code survive as itself. An unknown code collapses to E_SERVER_ERROR,
    // which would tell the host the service broke rather than that the user
    // has to open the short URL in a browser.
    const native = Object.assign(
      new Error(
        'This link is password protected. Open it in a browser to enter the password.'
      ),
      { code: 'E_PASSWORD_REQUIRED' }
    );
    mockHandleDeepLink.mockRejectedValue(native);
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });
    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/secret' });
    await flush();

    const failure = onLink.mock.calls
      .map((c) => (c[0] as DeepLinkEvent).error)
      .find((e): e is WarpLinkError => e != null);

    expect(failure).toMatchObject({ name: 'WarpLinkError' });
    expect(failure?.code).toBe(ErrorCodes.E_PASSWORD_REQUIRED);
    expect(failure?.code).not.toBe(ErrorCodes.E_SERVER_ERROR);
  });

  it('WL-S21 a non-Error native rejection still reaches onLink as a WarpLinkError', async () => {
    // The bridge can reject with a plain string or object. That branch of the
    // mapping had no coverage at all: every rejection fixture was an Error.
    mockHandleDeepLink.mockRejectedValue('the bridge rejected with a string');
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });
    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/boom2' });
    await flush();

    const failure = onLink.mock.calls
      .map((c) => (c[0] as DeepLinkEvent).error)
      .find((e): e is WarpLinkError => e != null);

    expect(failure).toMatchObject({ name: 'WarpLinkError' });
    expect(failure?.message).toContain('the bridge rejected with a string');
  });

  it("WL-S19 automaticDeepLinks:false silences the native event, and the host's own handleDeepLink still resolves it", async () => {
    const url = 'https://aplnk.to/optout';
    mockGetInitialURL.mockResolvedValue(url);
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const onLink = jest.fn();

    await WarpLinkFresh.configure({
      apiKey: VALID_LIVE_KEY,
      onLink,
      automaticDeepLinks: false,
    });
    // The native 'onWarpLinkDeepLink' event is React Native's warm-start entry
    // point, the analogue of iOS open/continue and Android onNewIntent. Android
    // honoured the flag on cold start and ignored it here, so an app that had
    // opted out still received warm-start dispatch. Opting out has to stop
    // every automatic entry point, not only the first one.
    emitNativeEvent('onWarpLinkDeepLink', { url });
    await flush();

    const deepLinkCalls = onLink.mock.calls.filter(
      (c) => (c[0] as { deepLink?: unknown }).deepLink != null
    );
    expect(deepLinkCalls).toHaveLength(0);
    // Silent, not merely deep-link free: no error event either.
    expect(onLink).not.toHaveBeenCalled();
    expect(mockGetInitialURL).not.toHaveBeenCalled();

    // Second clause: opting out disables the wiring, not the SDK. The host's
    // own call resolves the very URL the automatic path ignored.
    await expect(WarpLinkFresh.handleDeepLink(url)).resolves.toEqual(
      expect.objectContaining({ linkId: 'link-dl-1' })
    );
    // That explicit call is the ONLY resolution in this test, so no automatic
    // entry point reached the native module behind the host's back.
    expect(mockHandleDeepLink).toHaveBeenCalledTimes(1);
    expect(mockHandleDeepLink).toHaveBeenCalledWith(url);
  });

  it('automaticDeferredDeepLinks:false skips the deferred check', async () => {
    const onLink = jest.fn();

    await WarpLinkFresh.configure({
      apiKey: VALID_LIVE_KEY,
      onLink,
      automaticDeferredDeepLinks: false,
    });

    expect(mockCheckDeferredDeepLink).not.toHaveBeenCalled();
  });

  it('no onLink → no deep link wiring (backward compatible)', async () => {
    mockIsAttributionComplete.mockResolvedValue(false);

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY });
    emitNativeEvent('onWarpLinkDeepLink', {
      url: 'https://aplnk.to/x',
    });
    await flush();

    expect(mockGetInitialURL).not.toHaveBeenCalled();
    expect(mockHandleDeepLink).not.toHaveBeenCalled();
    // The deferred check is NOT part of "no auto-wiring": it is the install
    // attribution request, so it fires with or without a sink. Pinned in
    // 'sinkless configure() still attributes the install' below.
    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
  });

  /**
   * WL-S09's contract is that a foreign warm-start url reaches the host as
   * nothing at all, rather than as an error. It used to reach the native module
   * first and be dropped on the `E_INVALID_URL` that came back. Since
   * warplink-0csz it is classified first and never resolved, which is what both
   * natives do (`AutoLinkHandler.dispatch` and `open()` both refuse a foreign
   * url before anything else). The host-visible outcome is unchanged, and the
   * dedupe window is no longer disturbed by a url that was never a link.
   */
  it('WL-S09 drops foreign warm-start URLs without resolving them', async () => {
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });
    emitNativeEvent('onWarpLinkDeepLink', { url: 'myapp://oauth/callback' });
    await flush();

    expect(mockIsWarpLinkUrl).toHaveBeenCalledWith('myapp://oauth/callback');
    expect(mockHandleDeepLink).not.toHaveBeenCalled();
    expect(onLink).not.toHaveBeenCalled();
  });

  it('drops a foreign cold-start URL (E_INVALID_URL)', async () => {
    mockGetInitialURL.mockResolvedValue('myapp://oauth/callback');
    mockHandleDeepLink.mockRejectedValue(
      Object.assign(new Error('Invalid URL'), { code: 'E_INVALID_URL' })
    );
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });

    expect(onLink).not.toHaveBeenCalled();
  });

  it('still delivers non-E_INVALID_URL resolution errors to onLink', async () => {
    mockHandleDeepLink.mockRejectedValue(
      Object.assign(new Error('Network error'), { code: 'E_NETWORK_ERROR' })
    );
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });
    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/warm' });
    await flush();

    expect(onLink).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: ErrorCodes.E_NETWORK_ERROR,
        }),
      })
    );
  });

  it('does not re-report a throwing onLink to itself (cold start)', async () => {
    mockGetInitialURL.mockResolvedValue('https://aplnk.to/cold');
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const onLink = jest.fn(() => {
      throw new Error('host navigation failed');
    });

    await expect(
      WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink })
    ).rejects.toThrow('host navigation failed');

    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it('does not re-report a throwing onLink to itself (deferred)', async () => {
    mockCheckDeferredDeepLink.mockResolvedValue({
      ...MOCK_DEEP_LINK,
      linkId: 'link-deferred',
      isDeferred: true,
    });
    const onLink = jest.fn(() => {
      throw new Error('host navigation failed');
    });

    await expect(
      WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink })
    ).rejects.toThrow('host navigation failed');

    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it('still runs the deferred attribution check when a cold-start onLink throws', async () => {
    mockGetInitialURL.mockResolvedValue('https://aplnk.to/cold');
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    mockIsAttributionComplete.mockResolvedValue(false);
    mockCheckDeferredDeepLink.mockResolvedValue(null);
    const onLink = jest.fn(() => {
      throw new Error('navigation container not mounted');
    });

    await expect(
      WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink })
    ).rejects.toThrow('navigation container not mounted');

    // The attribution/deferred path must not be skipped by the host throw.
    expect(mockIsAttributionComplete).toHaveBeenCalled();
    expect(mockCheckDeferredDeepLink).toHaveBeenCalled();
    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it('propagates the deferred host throw when both dispatches throw', async () => {
    mockGetInitialURL.mockResolvedValue('https://aplnk.to/cold');
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    mockIsAttributionComplete.mockResolvedValue(false);
    mockCheckDeferredDeepLink.mockResolvedValue({
      ...MOCK_DEEP_LINK,
      linkId: 'link-deferred',
      isDeferred: true,
    });
    const onLink = jest.fn((event: DeepLinkEvent) => {
      throw new Error(
        event.deepLink?.isDeferred ? 'deferred throw' : 'cold throw'
      );
    });

    await expect(
      WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink })
    ).rejects.toThrow('deferred throw');

    expect(onLink).toHaveBeenCalledTimes(2);
  });

  it('reconfigure clears the dedupe set (same URL can dispatch again)', async () => {
    mockGetInitialURL.mockResolvedValue('https://aplnk.to/same');
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });
    await WarpLinkFresh.configure({ apiKey: VALID_TEST_KEY, onLink });

    const deepLinkCalls = onLink.mock.calls.filter(
      (c) => (c[0] as { deepLink?: unknown }).deepLink != null
    );
    expect(deepLinkCalls).toHaveLength(2);
  });

  it('WL-S27 surfaces the eventual success of a retried resolve, with one native call', async () => {
    // The retry lives in the native SDK. The bridge's job is to make exactly
    // one call per tap and hand back whatever the native SDK eventually
    // answers, however many attempts that took underneath.
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });
    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/retried' });
    await flush();

    expect(mockHandleDeepLink).toHaveBeenCalledTimes(1);
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onLink).toHaveBeenCalledWith(
      expect.objectContaining({
        deepLink: expect.objectContaining({ linkId: 'link-dl-1' }),
      })
    );
  });

  it('WL-S27 surfaces the eventual network failure of a retried resolve, with one native call', async () => {
    mockHandleDeepLink.mockRejectedValue(
      Object.assign(new Error('offline'), { code: 'E_NETWORK_ERROR' })
    );
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });
    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/offline' });
    await flush();

    // WL-S21 stands. The host still sees a WarpLinkError; the only change is
    // that it now means "failed after the bounded retries".
    expect(mockHandleDeepLink).toHaveBeenCalledTimes(1);
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onLink).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          name: 'WarpLinkError',
          code: 'E_NETWORK_ERROR',
        }),
      })
    );
  });

  it('WL-S27 never re-dispatches a tap the native SDK already retried', async () => {
    // The mutation this pins: a JS-side retry on top of the native one would
    // resolve every tap twice and bill it twice.
    mockHandleDeepLink.mockRejectedValueOnce(
      Object.assign(new Error('offline'), { code: 'E_NETWORK_ERROR' })
    );
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const onLink = jest.fn();

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink });
    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/once' });
    await flush();
    await flush();

    expect(mockHandleDeepLink).toHaveBeenCalledTimes(1);
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onLink).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.anything() })
    );
  });
});

/**
 * The deferred check is the install attribution request, not a delivery
 * mechanism. `onLink` decides whether a matched link is handed back to the
 * host; it must not decide whether the install is attributed at all.
 *
 * React Native is the only SDK where this is in doubt. The bridges force the
 * native auto-check off (`ios/WarpLinkModule.swift` autoDeferredCheck: false,
 * `android/.../WarpLinkModule.kt` automaticDeferredDeepLinks = false), so this
 * TypeScript layer is the only thing that can start attribution on RN. iOS
 * (`WarpLink+DeferredDeepLink.runAutoDeferredCheck`) and Android
 * (`WarpLink.startAutomaticHandling`) both fire it with no sink.
 */
describe('sinkless configure() still attributes the install', () => {
  let WarpLinkFresh: typeof WarpLink;

  const flush = () => flushPromises();

  beforeEach(() => {
    jest.resetAllMocks();
    mockIsWarpLinkUrl.mockImplementation(classifyLikeNative);
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
    mockGetInitialURL.mockResolvedValue(null);
    mockCheckDeferredDeepLink.mockResolvedValue(null);
    mockIsAttributionComplete.mockResolvedValue(false);

    jest.isolateModules(() => {
      WarpLinkFresh =
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
    });
  });

  it('SPEC-1 a bare configure({ apiKey }) fires the deferred check', async () => {
    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY });
    await flush();

    expect(mockIsAttributionComplete).toHaveBeenCalledTimes(1);
    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
  });

  it('SPEC-2 the deep link wiring stays off without onLink', async () => {
    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY });
    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/x' });
    await flush();

    // Cold and warm start really are gated on the sink: with nowhere to
    // deliver, resolving a URL behind the host's back would be wrong.
    expect(mockGetInitialURL).not.toHaveBeenCalled();
    expect(mockHandleDeepLink).not.toHaveBeenCalled();
  });

  it('SPEC-3 configure() does not block on the attribution round trip', async () => {
    // Never resolves: a slow or wedged attribution request. With a sink the
    // dispatch is awaited so a host callback throw still rejects configure().
    // With no sink there is nothing to deliver, so configure() must not wait.
    mockCheckDeferredDeepLink.mockImplementation(() => new Promise(() => {}));

    const outcome = await Promise.race([
      WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY }).then(() => 'resolved'),
      flushPromises(20).then(() => 'still-pending'),
    ]);

    expect(outcome).toBe('resolved');
    expect(mockCheckDeferredDeepLink).toHaveBeenCalledTimes(1);
  });

  it('SPEC-4 automaticDeferredDeepLinks:false still opts out without onLink', async () => {
    await WarpLinkFresh.configure({
      apiKey: VALID_LIVE_KEY,
      automaticDeferredDeepLinks: false,
    });
    await flush();

    expect(mockCheckDeferredDeepLink).not.toHaveBeenCalled();
  });

  it('SPEC-5 the at-most-once gate still applies without onLink', async () => {
    mockIsAttributionComplete.mockResolvedValue(true);

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY });
    await flush();

    expect(mockCheckDeferredDeepLink).not.toHaveBeenCalled();
  });

  it('SPEC-6 a rejecting native check never becomes an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    mockIsAttributionComplete.mockRejectedValue(new Error('bridge died'));
    mockCheckDeferredDeepLink.mockRejectedValue(new Error('bridge died'));

    await expect(
      WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY })
    ).resolves.toBeUndefined();
    await flushPromises(20);

    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
  });
});

describe('orchestrator behaviours the review found unpinned', () => {
  let WarpLinkFresh: typeof WarpLink;

  beforeEach(() => {
    jest.resetAllMocks();
    mockIsWarpLinkUrl.mockImplementation(classifyLikeNative);
    mockConfigure.mockResolvedValue(undefined);
    mockIsAttributionComplete.mockResolvedValue(false);
    mockEmitterListeners = new Map();
    mockNativeEventEmitter.mockImplementation(() => ({
      addListener: jest.fn((eventName: string, handler: EventHandler) => {
        mockEmitterListeners.set(eventName, handler);
        return { remove: mockRemoveSubscription };
      }),
      removeAllListeners: jest.fn(),
    }));
    jest.isolateModules(() => {
      WarpLinkFresh =
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        (require('../WarpLink') as typeof import('../WarpLink')).WarpLink;
    });
  });

  it('resolves a native deep link event once and fans it to every listener', async () => {
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    const first = jest.fn();
    const second = jest.fn();
    const unsubFirst = WarpLinkFresh.onDeepLink(first);
    const unsubSecond = WarpLinkFresh.onDeepLink(second);

    emitNativeEvent('onWarpLinkDeepLink', { url: 'https://aplnk.to/fan' });
    await flushPromises();

    // One native resolution per event, however many listeners.
    expect(mockHandleDeepLink).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    unsubFirst();
    unsubSecond();
  });

  it('drops the native subscription when the last listener unsubscribes', () => {
    const unsub = WarpLinkFresh.onDeepLink(jest.fn());
    const unsubOther = WarpLinkFresh.onDeepLink(jest.fn());
    expect(mockRemoveSubscription).not.toHaveBeenCalled();

    unsub();

    // The preserved direction: one listener is gone, one remains, so the
    // native subscription must survive. Dropping the size check would tear the
    // emitter down under the listener that is still there.
    expect(mockRemoveSubscription).not.toHaveBeenCalled();

    unsubOther();

    // Keeping the subscription alive with no listener leaks the emitter for
    // the life of the app.
    expect(mockRemoveSubscription).toHaveBeenCalledTimes(1);
  });

  it('dispatches the cold-start link before it starts the deferred check', async () => {
    mockGetInitialURL.mockResolvedValue('https://aplnk.to/cold');
    mockHandleDeepLink.mockResolvedValue(MOCK_DEEP_LINK);
    mockCheckDeferredDeepLink.mockResolvedValue(null);

    await WarpLinkFresh.configure({ apiKey: VALID_LIVE_KEY, onLink: jest.fn() });
    await flushPromises();

    // The at-most-once scenario's platform note: React Native orders these
    // where the natives race them. A user who installs from one link and
    // opens from another must see the cold-start link first.
    const coldStart = mockHandleDeepLink.mock.invocationCallOrder[0]!;
    const deferred = mockCheckDeferredDeepLink.mock.invocationCallOrder[0]!;
    expect(coldStart).toBeLessThan(deferred);
  });
});

// NOTE: keep this LAST — it calls jest.resetModules() + jest.mock('react-native')
// with a stripped factory (no NativeEventEmitter), which pollutes the module
// registry for any describe that runs after it.
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

describe('matchGuaranteed passthrough', () => {
  it('passes a true flag from native through to the deep link', async () => {
    mockHandleDeepLink.mockResolvedValue({
      linkId: 'link-1',
      destination: 'https://example.com',
      deepLinkUrl: null,
      customParams: {},
      isDeferred: false,
      matchType: 'deterministic',
      matchConfidence: 1.0,
      matchGuaranteed: true,
    });

    const result = await WarpLink.handleDeepLink('https://aplnk.to/abc');

    expect(result?.matchGuaranteed).toBe(true);
  });

  it('passes a true flag through on the attribution result', async () => {
    mockGetAttributionResult.mockResolvedValue({
      linkId: 'link-1',
      matchType: 'deterministic',
      matchConfidence: 1.0,
      matchGuaranteed: true,
      isDeferred: true,
    });

    const result = await WarpLink.getAttributionResult();

    expect(result?.matchGuaranteed).toBe(true);
  });

  it('defaults to false when an older native SDK omits the field', async () => {
    mockHandleDeepLink.mockResolvedValue({
      linkId: 'link-1',
      destination: 'https://example.com',
      deepLinkUrl: null,
      customParams: {},
      isDeferred: false,
      matchType: 'deterministic',
      matchConfidence: 1.0,
    });

    const result = await WarpLink.handleDeepLink('https://aplnk.to/abc');

    // Missing must never read as guaranteed: a host gating on it would over-trust.
    expect(result?.matchGuaranteed).toBe(false);
  });
});

