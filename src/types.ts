export const ErrorCodes = {
  E_NOT_CONFIGURED: 'E_NOT_CONFIGURED',
  E_INVALID_API_KEY_FORMAT: 'E_INVALID_API_KEY_FORMAT',
  E_INVALID_API_KEY: 'E_INVALID_API_KEY',
  E_NETWORK_ERROR: 'E_NETWORK_ERROR',
  E_SERVER_ERROR: 'E_SERVER_ERROR',
  E_INVALID_URL: 'E_INVALID_URL',
  E_LINK_NOT_FOUND: 'E_LINK_NOT_FOUND',
  E_DECODING_ERROR: 'E_DECODING_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class WarpLinkError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'WarpLinkError';
    this.code = code;
  }
}

export interface WarpLinkConfig {
  apiKey: string;
  apiEndpoint?: string;
  debugLogging?: boolean;
  matchWindowHours?: number;
}

export interface WarpLinkDeepLink {
  linkId: string;
  destination: string;
  deepLinkUrl: string | null;
  customParams: Record<string, unknown>;
  isDeferred: boolean;
  matchType: 'deterministic' | 'probabilistic' | null;
  matchConfidence: number | null;
}

export interface AttributionResult {
  linkId: string;
  matchType: 'deterministic' | 'probabilistic';
  matchConfidence: number;
  isDeferred: boolean;
  installId: string | null;
}

export type DeepLinkEvent =
  | { deepLink: WarpLinkDeepLink; error?: undefined }
  | { deepLink?: undefined; error: WarpLinkError };

export type DeepLinkListener = (event: DeepLinkEvent) => void;
