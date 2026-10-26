/**
 * Ceiling on the link check alone, deliberately far shorter than
 * `SUPERSEDE_WAIT_CEILING_MS`, because the two bound completely different
 * things.
 *
 * A supersede wait covers a native RESOLVE: a network round trip to the
 * WarpLink API with its own bounded retry schedule behind it, which legitimately
 * takes seconds. A link check covers a bridge round trip over a computation that
 * is synchronous on both platforms: `UriParser.isWarpLinkUri` reads a cached set
 * and a path, `URL.isWarpLinkUniversalLink` the same. Nothing in it can be slow.
 * Even on a loaded cold start that is hundreds of milliseconds, so two seconds
 * is generous by an order of magnitude.
 *
 * Sharing the 15 s ceiling made a wedged check hold a launch link, and
 * `configure()` with it, for fifteen seconds. Failing open sooner costs only the
 * behaviour from before the check existed, for that one url.
 */
export const CLASSIFY_CEILING_MS = 2_000;

/**
 * Ceiling on a wait that is really a wait on a native RESOLVE, so a resolve
 * that never answers cannot hang something the host is waiting on.
 *
 * Two waits are bounded by it:
 * - `isSuperseded`, on a newer tap still resolving, so one that never answers
 *   cannot hang an older tap's delivery to `onLink`. The public
 *   `handleDeepLink` / `getInitialDeepLink` API reaches this hazard too:
 *   nothing bounds how long a host's own native call may take to answer.
 * - `arrivalsSettled`, on urls that arrived before an answer but have not been
 *   classified yet. A backstop rather than the real bound: every classification
 *   in that queue is itself capped at `CLASSIFY_CEILING_MS`.
 *
 * Derived from the native retry schedule (`RetrySettings`, `RetryPolicy.kt`):
 * three attempts of 4s, 3s and 3s sum to 10s, the longest a single WarpLink
 * resolve's own per-attempt timeouts add up to. `RetrySettings.totalBudgetMs`
 * (12s) is a separate cap checked before each retry and does not raise this
 * figure. This constant adds a margin on top of that 10s for the waits between
 * attempts and for this layer having no visibility into that schedule.
 *
 * Passing it decides one thing once, and never rewrites what has already
 * happened. A newer tap still unsettled is treated as NOT a link for that one
 * supersede decision, and its own eventual answer still settles the ledger
 * normally.
 */
export const SUPERSEDE_WAIT_CEILING_MS = 15_000;

/**
 * Resolves when `settled` does, or once `ceilingMs` has passed, whichever is
 * first. Clears its own timer on the settle path so a wait that DOES answer
 * promptly leaves nothing pending afterward: in Jest that is the difference
 * between a clean test and one that hangs the process on an open handle.
 *
 * The ceiling is a parameter because the two things waited on are not the same
 * size: a native resolve takes seconds, a link check takes milliseconds. Every
 * call names which it means.
 */
export function settledWithin(
  settled: Promise<unknown>,
  ceilingMs: number
): Promise<void> {
  return new Promise((resolve) => {
    const ceiling = setTimeout(resolve, ceilingMs);
    void settled.then(() => {
      clearTimeout(ceiling);
      resolve();
    });
  });
}
