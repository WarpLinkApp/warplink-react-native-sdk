import type { DeepLinkEvent } from '../types';

// Light time-boxed dedupe: a single arrival is reconciled once across cold
// start + a warm-start event, but a repeat tap on the same URL after the window
// is a new navigation and dispatches again. Mirrors the iOS (1s) and Android
// (1.5s) SDKs, which track (lastUrl, lastAt) rather than suppressing a URL for
// the app's lifetime.
const DEDUPE_WINDOW_MS = 1500;
let lastAutoUrl: string | null = null;
let lastAutoAt = 0;
// Which tap set the current stamp, so its own failure is the only one allowed
// to clear it: see releaseStampOnFailure.
let lastAutoTap: number | null = null;

/**
 * Records the URL and returns true when it should dispatch; returns false when
 * it repeats the previous arrival within DEDUPE_WINDOW_MS.
 *
 * Only ever called for a url the native module has already classified as a
 * WarpLink link. A foreign url must never reach this function, because the
 * stamp it would leave is the whole of warplink-0csz: both natives refuse a
 * foreign url before their own claim, so their window still holds the last
 * real link.
 *
 * `at` is when the url ARRIVED, not when this runs. On both natives those are
 * the same instant, because each reads its clock inside the call that claims.
 * They come apart here because classification puts a native round trip in front
 * of admission, and reading the clock here would move both the comparison and
 * the new stamp later by however long that took, so a duplicate could measure
 * its way out of the window and resolve a second time.
 *
 * The window is checked as a RANGE, not a bare `<`. Date.now() is wall clock
 * and can move backwards when NTP corrects a drifted device or the user edits
 * the date. The elapsed subtraction then goes negative, and a bare `<` reads
 * every negative value as "inside the window", so repeat taps on a link are
 * swallowed until the clock catches up. The lower bound turns a backward step
 * into a fresh arrival, which is the safe direction: dispatching twice is
 * recoverable, silently dropping a navigation is not.
 *
 * The native SDKs use a monotonic clock instead (Android elapsedRealtime, iOS
 * systemUptime). The JS layer has no clock that is monotonic across every
 * supported React Native runtime, so it guards the arithmetic instead.
 */
export function shouldAutoDispatch(url: string, at: number): boolean {
  const elapsed = at - lastAutoAt;
  if (url === lastAutoUrl && elapsed >= 0 && elapsed < DEDUPE_WINDOW_MS) {
    return false;
  }
  lastAutoUrl = url;
  lastAutoAt = at;
  return true;
}

/** The tap that owns the current stamp, or null when none does. */
export function stampOwner(): number | null {
  return lastAutoTap;
}

/** Hands the stamp just taken by `shouldAutoDispatch` to `tap`. */
export function claimStamp(tap: number): void {
  lastAutoTap = tap;
}

export function clearStamp(): void {
  lastAutoUrl = null;
  lastAutoAt = 0;
  lastAutoTap = null;
}

/**
 * Settles the dedupe stamp once `tap`'s own native answer is known, while
 * `tap` still owns it.
 *
 * A failed resolve of a real link is not a duplicate to suppress: both native
 * SDKs drop their own claim on a failure, so a user's own re-tap inside the
 * window reaches the native module instead of being swallowed by the cached
 * failure for the rest of it. Mirrors Android `AutoLinkHandler.settle`
 * (`lastUri = null` for a failed current claim) and iOS `releaseDuplicateClaim`
 * (`WarpLink+Supersede.swift`). A url that resolved as a genuine link
 * (`code === undefined`: success, or a no-match) leaves the stamp as `tap` set
 * it.
 *
 * A CLAIMED tap answering E_INVALID_URL means the classification and the
 * resolve disagreed: the known-domain set changed between the two native calls,
 * or the native module was too old to classify. Clearing the stamp is the right
 * answer, as for any failure, because nothing was delivered and the user's own
 * re-tap must reach the native module.
 *
 * Guarded on ownership: a re-tap of the same url past the window, or a tap on a
 * different url, claims a fresh stamp before this one's answer arrives; touching
 * it then would undo the newer tap's own protection instead of this tap's.
 * Mirrors `releaseDuplicateClaim`'s own URL-equality guard.
 */
export function releaseStampOnFailure(
  tap: number,
  resolved: DeepLinkEvent | null
): void {
  if (resolved?.error?.code === undefined || tap !== lastAutoTap) {
    return;
  }
  clearStamp();
}
