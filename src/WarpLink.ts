import type {
  WarpLinkConfig,
  WarpLinkDeepLink,
  AttributionResult,
  DeepLinkListener,
} from './types';
import * as attribution from './attribution-api';
import { claimReferral, redeemInvitation } from './referral/referral-calls';
import type { ReferralClaimResult } from './referral/referral-types';
import { deliverResolved } from './automatic/auto-event';
import { clearAttributionSdk } from './automatic/clear-attribution';
import { configureSdk } from './automatic/configure-flow';
import { subscribeUrlHandler } from './automatic/native-subscription';
import { getInitialDeepLink, handleDeepLink } from './manual-resolve';

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
   * Returns install attribution for the current install. A genuine no-match returns `null`; a malformed native payload throws
   * `E_DECODING_ERROR`.
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

  /**
   * Finishes a referral handoff from the text a person pasted.
   *
   * Call it with the text from the system paste control the person taps; the
   * SDK never reads the clipboard. Text that is not an invitation resolves
   * `null`. A valid invitation resolves the matched link.
   *
   * @throws {WarpLinkError} `E_SERVER_ERROR` when the invitation is invalid or
   *   expired (the message says how to open the link again), or when it could
   *   not be confirmed yet. After a network failure the native SDK keeps the
   *   invitation and tries again on a later launch, a bounded number of times.
   * @throws {WarpLinkError} `E_NOT_CONFIGURED` when the SDK is not configured.
   */
  redeemInvitation(text: string): Promise<WarpLinkDeepLink | null> {
    return redeemInvitation(text);
  },

  /**
   * Claims the referral behind this install for the person who just signed up.
   *
   * `installerId` is your own stable id for that person, 1 to 128 characters,
   * dedicated to WarpLink: never a primary key, an email or other personal
   * data. Calling again with the same id is safe. Status `none` is an answer,
   * not an error.
   *
   * @throws {WarpLinkError} `E_SERVER_ERROR` for an empty or too long id, or a
   *   server failure; `E_NETWORK_ERROR`, `E_INVALID_API_KEY` and
   *   `E_NOT_CONFIGURED` as for the other calls.
   */
  claimReferral(installerId: string): Promise<ReferralClaimResult> {
    return claimReferral(installerId);
  },

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
