/**
 * Waits for a condition the test can observe, instead of for a clock.
 *
 * `check` is an assertion callback: it throws until the condition holds. The poll yields one event loop
 * turn between attempts, so a chain of already-resolved promises always gets to run first, and the
 * failure thrown at the deadline is the assertion's own message. Real timers only: under
 * `jest.useFakeTimers()` the clock never reaches the deadline, so advance the fake clock instead.
 *
 * Lives outside `src/` deliberately, like `held.ts`: `src` ships in the npm package.
 */
export async function waitFor(check: () => void | Promise<void>, timeoutMs = 2_000): Promise<void> {
  // `performance.now()`, not `Date.now()`: a test may pin the wall clock to exercise a time window.
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (performance.now() >= deadline) throw error;
      // oxlint-disable-next-line warplink/no-fixed-wait-in-tests -- one event loop turn between polls of `check`, which the deadline above bounds: nothing announces that the awaited state arrived
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}

/**
 * Resolves after one event loop turn, so every promise reaction already queued has run.
 *
 * Use it only to assert that something did NOT happen: no event announces an absence, so there is
 * nothing to wait on. Never use it to wait for something that should happen. Name the reason at the call site.
 */
export function settleEventLoop(): Promise<void> {
  // oxlint-disable-next-line warplink/no-fixed-wait-in-tests -- the one named event loop turn for absence assertions: no event announces that nothing happened
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * `jest.useFakeTimers({ doNotFake })` list for a test that crosses a timer ceiling. `setImmediate` and
 * `performance` stay real, which keeps `waitFor` and `settleEventLoop` working while the clock is fake.
 */
export const FAKE_CLOCK_ONLY: Array<'setImmediate' | 'performance'> = ['setImmediate', 'performance'];
