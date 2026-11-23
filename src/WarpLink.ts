import type {
  WarpLinkConfig,
  WarpLinkDeepLink,
  AttributionResult,
  DeepLinkListener,
} from './types';
import * as attribution from './attribution-api';
import { referralApi } from './referral/referral-api';
import { deliverResolved } from './automatic/auto-event';
import { clearAttributionSdk } from './automatic/clear-attribution';
import { configureSdk } from './automatic/configure-flow';
import { subscribeUrlHandler } from './automatic/native-subscription';
import { getInitialDeepLink, handleDeepLink } from './manual-resolve';
import { readDeferredCheckStatus, type DeferredCheckStatus } from './status/deferred-status';
import { tetherApi } from './tether/tether-api';

export const WarpLink = {
  /**
   * Initialize the SDK. With a bare `configure({ apiKey, onLink })`,
   * cold-start, warm-start, and deferred deep links are all wired
   * automatically and funneled into `onLink`. Disable any piece with
   * `automaticDeepLinks: false` / `automaticDeferredDeepLinks: false`,
   * or omit `onLink` to wire the deep link callbacks yourself.
   *
   * Omitting `onLink` does not switch off install attribution: the deferred
   * check still fires, because that request is what attributes the install.
   * Use `automaticDeferredDeepLinks: false` to switch it off.
   *
   * A malformed API key is reported through `onLink` as
   * `E_INVALID_API_KEY_FORMAT` and logged; it does not throw, and the SDK
   * stays unconfigured. The returned promise resolves once configuration and
   * any automatic cold-start and deferred dispatch into `onLink` complete.
   * Native configuration errors reach `onLink` as an `{ error }` event, or
   * reject the promise when `onLink` is not provided. An exception thrown by
   * your own `onLink` propagates out of the promise and is never handed back
   * to it as a fabricated error.
   *
   * @example
   * ```ts
   * WarpLink.configure({
   *   apiKey: 'wl_live_...',
   *   onLink: ({ deepLink, error }) => {
   *     if (deepLink) navigate(deepLink.deepLinkUrl ?? deepLink.destination);
   *     else if (error) console.error(error.code, error.message);
   *   },
   * });
   * ```
   */
  configure(options: WarpLinkConfig): Promise<void> {
    return configureSdk(options);
  },

  /**
   * Resolves a WarpLink url on demand. A manual resolve supersedes an
   * automatic tap that is still in flight without ever delivering its own
   * answer to `onLink`; the returned promise settles from its own answer.
   * A url that is not a WarpLink link rejects with `E_INVALID_URL`.
   */
  handleDeepLink(url: string): Promise<WarpLinkDeepLink | null> {
    return handleDeepLink(url);
  },

  /**
   * Checks for a deferred deep link from an install attribution match.
   *
   * With the opt-out model this fires automatically from `configure()`
   * (unless `automaticDeferredDeepLinks: false`). Call it manually only
   * for advanced flows or when you disabled the automatic check.
   *
   * Returns the matched deep link with `isDeferred: true`; once attribution
   * has completed the native SDK returns the same cached match on later
   * launches, and `null` when there was no match. The automatic dispatch from
   * `configure()` delivers a match to `onLink` at most once across launches;
   * this manual call always returns the cached result for advanced flows.
   *
   * Use `matchGuaranteed` and `matchConfidence` to pick a destination, never
   * as a credential: authenticate and authorize separately.
   *
   * @returns Deferred deep link or `null`.
   * @throws {WarpLinkError} `E_NOT_CONFIGURED` — SDK not initialized.
   * @throws {WarpLinkError} `E_NETWORK_ERROR` — Attribution API unreachable.
   * @throws {WarpLinkError} `E_SERVER_ERROR` — 5xx from attribution API.
   * @throws {WarpLinkError} `E_DECODING_ERROR` — Malformed API response.
   */
  checkDeferredDeepLink(): Promise<WarpLinkDeepLink | null> {
    return attribution.checkDeferredDeepLink();
  },

  /**
   * Returns install attribution for the current install. A genuine no-match
   * returns `null`; a malformed native payload throws `E_DECODING_ERROR`.
   *
   * @returns Attribution data, or `null` when there is no match.
   * @throws {WarpLinkError} `E_NOT_CONFIGURED` — SDK not initialized.
   * @throws {WarpLinkError} `E_DECODING_ERROR` — Malformed native payload.
   * @throws {WarpLinkError} `E_NETWORK_ERROR` / `E_SERVER_ERROR` — API failure.
   */
  getAttributionResult(): Promise<AttributionResult | null> {
    return attribution.getAttributionResult();
  },

  /**
   * The version of the native WarpLink SDK this bridge is running against.
   *
   * Ask the SDK, not the package: the native pin can drift from the package
   * version, and this returns what the native SDK actually reports.
   */
  sdkVersion(): Promise<string> {
    return attribution.sdkVersion();
  },

  /**
   * Whether the deferred attribution check has definitively completed for this
   * install.
   *
   * Scoped to ONE install: it goes back to `false` after the app is deleted and
   * installed again, and after a restore from backup, because a reinstall
   * counts as an install and has to be attributed again.
   *
   * Useful for diagnostics. The automatic dispatch already gates on it.
   */
  isAttributionComplete(): Promise<boolean> {
    return attribution.isAttributionComplete();
  },

  /**
   * Where the first-launch link check stands, so a skipped check reads
   * differently from one that found no match. It sends no request and comes
   * from state stored on the device, so it survives a relaunch.
   *
   * `skippedOldInstall` and `stopped` mean no request was or will be sent.
   * `waiting` carries `retryAt`, in epoch milliseconds. A `wl_test_` key never
   * reports `waiting`, `skippedOldInstall` or `stopped`.
   *
   * @throws {WarpLinkError} `E_DECODING_ERROR` — Malformed native payload.
   */
  getDeferredCheckStatus(): Promise<DeferredCheckStatus> {
    return readDeferredCheckStatus();
  },

  /**
   * Forgets this install's attribution so the next first launch can be tested
   * again: the cached match, the completed and attempted gates and any held
   * referral invitation. Server records are not deleted.
   *
   * Test only. With a `wl_live_` key this does nothing and resolves, so it can
   * never erase a live install's attribution. With a `wl_test_` key and the
   * automatic deferred check on, a fresh check starts and a match from it
   * reaches `onLink`; a check that was in flight is discarded.
   *
   * @throws {WarpLinkError} `E_NOT_CONFIGURED` before `configure`.
   * @throws {WarpLinkError} `E_STORAGE_ERROR` when a stored item could not be
   *   deleted and some state may remain. Calling again is safe.
   */
  clearAttribution(): Promise<void> {
    return clearAttributionSdk();
  },

  ...referralApi,

  ...tetherApi,

  isConfigured(): Promise<boolean> {
    return attribution.isConfigured();
  },

  /**
   * Register a listener for warm-start deep links.
   *
   * Advanced API: `configure()` with `onLink` already funnels warm-start
   * events into `onLink`.
   *
   * @returns Unsubscribe function.
   */
  onDeepLink(listener: DeepLinkListener): () => void {
    // Explicit subscribers are not the automatic path and are not deduped or
    // superseded: they asked for every event and they get every event.
    return subscribeUrlHandler((_url, resolved) => {
      deliverResolved(listener, resolved);
    });
  },

  getInitialDeepLink(): Promise<WarpLinkDeepLink | null> {
    return getInitialDeepLink();
  },
};
