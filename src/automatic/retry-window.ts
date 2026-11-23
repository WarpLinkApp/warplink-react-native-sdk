/** How long a repeat configure() waits after one that asked native for a check. */
export const RETRY_WINDOW_MS = 60_000;

let lastAskedAt: number | null = null;

/**
 * Whether a repeat configure() may ask native for a check now. The window is
 * one per process, whatever the key. The elapsed time is checked as a range:
 * `Date.now()` can move backwards, and a negative value then counts as a new
 * window instead of holding every repeat back until the clock catches up.
 */
export function retryWindowOpen(): boolean {
  if (lastAskedAt === null) {
    return true;
  }
  const elapsed = Date.now() - lastAskedAt;
  return elapsed < 0 || elapsed >= RETRY_WINDOW_MS;
}

/** Records that a repeat configure() asked native for a check. */
export function noteRetryAsk(): void {
  lastAskedAt = Date.now();
}
