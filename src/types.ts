export const ErrorCodes = {
  E_NOT_CONFIGURED: 'E_NOT_CONFIGURED',
  E_INVALID_API_KEY_FORMAT: 'E_INVALID_API_KEY_FORMAT',
  E_INVALID_API_KEY: 'E_INVALID_API_KEY',
  E_NETWORK_ERROR: 'E_NETWORK_ERROR',
  E_SERVER_ERROR: 'E_SERVER_ERROR',
  E_INVALID_URL: 'E_INVALID_URL',
  E_LINK_NOT_FOUND: 'E_LINK_NOT_FOUND',
  /**
   * The link is password protected, so resolving it returns no destination and
   * no platform URLs. Send the user to the short URL in a browser, where the
   * password form lives.
   */
  E_PASSWORD_REQUIRED: 'E_PASSWORD_REQUIRED',
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
  /**
   * Server-side only. The effective match window is controlled per-link in
   * the dashboard (`link.match_window_hours`). This option is accepted for
   * backward compatibility but has no effect on matching.
   *
   * @deprecated Configure the match window per link in the dashboard.
   */
  matchWindowHours?: number;
  /**
   * Extra hosts that serve your links, on top of the always-recognized
   * `aplnk.to`. Declare your verified custom domain here so a link on it
   * resolves on the very first launch, before the SDK has fetched your domain
   * list, and on any launch that starts offline. Without it, the first launch
   * only knows `aplnk.to` and hands a custom-domain link back to your app.
   *
   * Additive: the declared hosts are merged with the ones the SDK fetches, so
   * an integration that leaves this unset behaves exactly as before.
   *
   * Values are forwarded verbatim and normalized natively (trimmed, lowercased,
   * a full URL reduced to its host), so `https://links.myapp.com/` and
   * `  Links.MyApp.com ` both mean the same host. `www.` is significant and is
   * never stripped.
   *
   * The same declaration can live in the native project instead, which suits a
   * brownfield app whose links can arrive before the JavaScript bundle runs:
   * a `WarpLinkDomains` array in `Info.plist` on iOS, or an
   * `app.warplink.DOMAINS` meta-data value (comma separated) in the Android
   * manifest. Declaring in both places is safe; the sets are merged.
   *
   * @example
   * ```ts
   * WarpLink.configure({ apiKey, linkDomains: ['links.myapp.com'] });
   * ```
   */
  linkDomains?: string[];
  /**
   * Single sink for cold-start, warm-start, AND deferred deep links.
   * When provided, `configure()` auto-wires all three sources into this
   * one callback. Disambiguate deferred results via `deepLink.isDeferred`.
   *
   * A native configuration failure is also delivered here as an
   * `{ error }` event instead of rejecting the `configure()` promise.
   */
  onLink?: DeepLinkListener;
  /**
   * Auto-handle cold-start and warm-start deep links through `onLink`.
   * Set to `false` to wire deep links manually with `onDeepLink()` and
   * `getInitialDeepLink()`. Only takes effect when `onLink` is provided.
   *
   * @default true
   */
  automaticDeepLinks?: boolean;
  /**
   * Auto-fire the deferred deep link check from `configure()` and deliver
   * the result through `onLink`. Set to `false` to call
   * `checkDeferredDeepLink()` manually.
   *
   * The check runs whether or not `onLink` is provided: it is the install
   * attribution request, and the match is recorded server-side either way.
   * `onLink` only decides whether the matched link is handed back to you.
   * This is what iOS `autoDeferredCheck` and Android
   * `automaticDeferredDeepLinks` already do.
   *
   * @default true
   */
  automaticDeferredDeepLinks?: boolean;
}

export interface WarpLinkDeepLink {
  linkId: string;
  destination: string;
  deepLinkUrl: string | null;
  customParams: Record<string, unknown>;
  isDeferred: boolean;
  matchType: 'deterministic' | 'probabilistic' | null;
  matchConfidence: number | null;
  /**
   * True only when the match was deterministic. Gate anything sensitive
   * (auto sign-in, showing personal data) on this rather than on a confidence
   * threshold: a probabilistic match is a best guess from a network-shaped
   * fingerprint and can name the wrong user.
   */
  matchGuaranteed: boolean;
}

export interface AttributionResult {
  linkId: string;
  matchType: 'deterministic' | 'probabilistic';
  matchConfidence: number;
  /**
   * True only when the match was deterministic. Gate anything sensitive
   * (auto sign-in, showing personal data) on this rather than on a confidence
   * threshold: a probabilistic match is a best guess from a network-shaped
   * fingerprint and can name the wrong user.
   */
  matchGuaranteed: boolean;
  isDeferred: boolean;
}

export type DeepLinkEvent =
  | { deepLink: WarpLinkDeepLink; error?: undefined }
  | { deepLink?: undefined; error: WarpLinkError };

export type DeepLinkListener = (event: DeepLinkEvent) => void;
