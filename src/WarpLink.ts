import {
  NativeEventEmitter,
  type EmitterSubscription,
  type NativeModule,
} from 'react-native';
import NativeWarpLink, { DEEP_LINK_EVENT } from './NativeWarpLink';
import {
  ErrorCodes,
  WarpLinkError,
  type ErrorCode,
  type WarpLinkConfig,
  type WarpLinkDeepLink,
  type AttributionResult,
  type DeepLinkListener,
} from './types';

function isErrorCode(code: string): code is ErrorCode {
  return Object.values(ErrorCodes).includes(code as ErrorCode);
}

function mapNativeError(error: unknown): WarpLinkError {
  if (error instanceof Error) {
    const nativeError = error as Error & { code?: string };
    const code =
      nativeError.code && isErrorCode(nativeError.code)
        ? nativeError.code
        : ErrorCodes.E_SERVER_ERROR;
    return new WarpLinkError(code, nativeError.message);
  }
  return new WarpLinkError(ErrorCodes.E_SERVER_ERROR, String(error));
}

function deserializeDeepLink(raw: unknown): WarpLinkDeepLink | null {
  if (raw == null || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  return {
    linkId: String(obj['linkId'] ?? ''),
    destination: String(obj['destination'] ?? ''),
    deepLinkUrl:
      obj['deepLinkUrl'] != null ? String(obj['deepLinkUrl']) : null,
    customParams:
      obj['customParams'] != null &&
      typeof obj['customParams'] === 'object'
        ? (obj['customParams'] as Record<string, unknown>)
        : {},
    isDeferred: Boolean(obj['isDeferred']),
    matchType: deserializeMatchType(obj['matchType']),
    matchConfidence:
      typeof obj['matchConfidence'] === 'number'
        ? obj['matchConfidence']
        : null,
  };
}

function deserializeMatchType(
  value: unknown
): 'deterministic' | 'probabilistic' | null {
  if (value === 'deterministic' || value === 'probabilistic') {
    return value;
  }
  return null;
}

function deserializeAttributionResult(
  raw: unknown
): AttributionResult | null {
  if (raw == null || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const matchType = deserializeMatchType(obj['matchType']);
  if (matchType == null) {
    return null;
  }
  const matchConfidence = obj['matchConfidence'];
  if (typeof matchConfidence !== 'number') {
    return null;
  }

  return {
    linkId: String(obj['linkId'] ?? ''),
    matchType,
    matchConfidence,
    isDeferred: Boolean(obj['isDeferred']),
    installId:
      typeof obj['installId'] === 'string' ? obj['installId'] : null,
  };
}

const API_KEY_PATTERN = /^wl_(live|test)_[a-zA-Z0-9]{32}$/;

let emitter: NativeEventEmitter | null = null;
const listeners = new Set<DeepLinkListener>();
let nativeSubscription: EmitterSubscription | null = null;

function handleNativeDeepLinkEvent(event: { url: string }): void {
  void resolveAndDispatch(event.url);
}

async function resolveAndDispatch(url: string): Promise<void> {
  try {
    const result = await NativeWarpLink.handleDeepLink(url);
    const deepLink = deserializeDeepLink(result);
    if (deepLink) {
      for (const listener of listeners) {
        listener({ deepLink });
      }
    }
  } catch (error) {
    const warpLinkError = mapNativeError(error);
    for (const listener of listeners) {
      listener({ error: warpLinkError });
    }
  }
}

export const WarpLink = {
  configure(options: WarpLinkConfig): void {
    if (!options.apiKey || !API_KEY_PATTERN.test(options.apiKey)) {
      throw new WarpLinkError(
        ErrorCodes.E_INVALID_API_KEY_FORMAT,
        'Invalid API key format. Expected: wl_live_xxx or wl_test_xxx (32 alphanumeric characters after prefix)'
      );
    }

    const config: Record<string, unknown> = {
      apiKey: options.apiKey,
    };
    if (options.apiEndpoint !== undefined) {
      config['apiEndpoint'] = options.apiEndpoint;
    }
    if (options.debugLogging !== undefined) {
      config['debugLogging'] = options.debugLogging;
    }
    if (options.matchWindowHours !== undefined) {
      config['matchWindowHours'] = options.matchWindowHours;
    }

    void NativeWarpLink.configure(config).catch((error: unknown) => {
      throw mapNativeError(error);
    });
  },

  async handleDeepLink(url: string): Promise<WarpLinkDeepLink | null> {
    try {
      const result = await NativeWarpLink.handleDeepLink(url);
      return deserializeDeepLink(result);
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  /**
   * Checks for a deferred deep link from an install attribution match.
   *
   * Call on app startup after `configure()`, typically in the root
   * component's `useEffect`. Returns the matched deep link with
   * `isDeferred: true` on first launch; returns `null` on subsequent
   * launches or when no match exists. The native SDK caches the result
   * and marks first-launch as consumed.
   *
   * `matchConfidence` is a 0.0–1.0 score from the attribution API.
   * Your app decides whether to act on low-confidence matches.
   *
   * @returns Deferred deep link or `null`.
   * @throws {WarpLinkError} `E_NOT_CONFIGURED` — SDK not initialized.
   * @throws {WarpLinkError} `E_NETWORK_ERROR` — Attribution API unreachable.
   * @throws {WarpLinkError} `E_SERVER_ERROR` — 5xx from attribution API.
   * @throws {WarpLinkError} `E_DECODING_ERROR` — Malformed API response.
   *
   * @example
   * ```ts
   * const link = await WarpLink.checkDeferredDeepLink();
   * if (link?.isDeferred) {
   *   navigation.navigate(link.deepLinkUrl ?? link.destination);
   * }
   * ```
   */
  async checkDeferredDeepLink(): Promise<WarpLinkDeepLink | null> {
    try {
      const result = await NativeWarpLink.checkDeferredDeepLink();
      return deserializeDeepLink(result);
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  async getAttributionResult(): Promise<AttributionResult | null> {
    try {
      const result = await NativeWarpLink.getAttributionResult();
      return deserializeAttributionResult(result);
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  async isConfigured(): Promise<boolean> {
    try {
      return await NativeWarpLink.isConfigured();
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  onDeepLink(listener: DeepLinkListener): () => void {
    if (!emitter) {
      emitter = new NativeEventEmitter(
        NativeWarpLink as unknown as NativeModule
      );
    }
    if (!nativeSubscription) {
      nativeSubscription = emitter.addListener(
        DEEP_LINK_EVENT,
        handleNativeDeepLinkEvent
      );
    }
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && nativeSubscription) {
        nativeSubscription.remove();
        nativeSubscription = null;
      }
    };
  },

  async getInitialDeepLink(): Promise<WarpLinkDeepLink | null> {
    try {
      const url = await NativeWarpLink.getInitialURL();
      if (url == null) {
        return null;
      }
      return await this.handleDeepLink(url);
    } catch (error) {
      throw mapNativeError(error);
    }
  },
};
