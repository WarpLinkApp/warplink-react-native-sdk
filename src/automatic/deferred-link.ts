import NativeWarpLink from '../NativeWarpLink';
import { deserializeDeepLink } from '../deserialize';
import { mapNativeError } from '../native-error';
import { readDeferredCheckStatus, type DeferredCheckState } from '../status/deferred-status';
import type { DeepLinkEvent } from '../types';
import { noteRetryAsk, retryWindowOpen } from './retry-window';
import { currentResetEpoch, currentSink, isCurrentGeneration, noteDeferredRoute } from './auto-session';

/**
 * The states in which a repeat configure() asks native for one more check.
 * `waiting`, `skippedOldInstall` and `stopped` are in the list on purpose: the
 * native backoff and the age and give-up limits answer those without a request,
 * and this layer keeps no copy of those rules.
 */
const RETRYABLE: readonly DeferredCheckState[] = ['notChecked', 'waiting', 'skippedOldInstall', 'stopped'];

/**
 * Runs the deferred check when `mayCheck` says so, and delivers a match to the
 * sink of `generation`.
 */
async function deliverCheck(generation: number, mayCheck: () => Promise<boolean>): Promise<void> {
  const epoch = currentResetEpoch();
  const isStale = (): boolean => epoch !== currentResetEpoch() || !isCurrentGeneration(generation);
  let event: DeepLinkEvent | null = null;
  try {
    const allowed = await mayCheck();
    // A reset or a new configure() can land during the await: the native check
    // would then refill cleared state or touch the new session.
    if (isStale()) {
      return;
    }
    if (allowed) {
      const deepLink = deserializeDeepLink(await NativeWarpLink.checkDeferredDeepLink());
      if (deepLink) {
        event = { deepLink };
      }
    }
  } catch (error) {
    event = { error: mapNativeError(error) };
  }
  // Host callback outside the try: see dispatchColdStartLink.
  const sink = currentSink(generation);
  if (event && sink && !isStale()) {
    if (event.deepLink) {
      noteDeferredRoute(event.deepLink);
    }
    sink(event);
  }
}

/**
 * The automatic check of a configure(). Native `checkDeferredDeepLink` returns
 * the cached match on every call, so dispatching its result on every launch
 * would re-fire the deferred link. Only auto-dispatch while the check has not
 * definitively completed, as the native iOS and Android auto-dispatch does.
 * The manual `checkDeferredDeepLink()` still returns the cached match.
 */
export function dispatchDeferredLink(generation: number): Promise<void> {
  return deliverCheck(generation, async () => !(await NativeWarpLink.isAttributionComplete()));
}

/**
 * One more check for a repeat configure() of the live session. It asks native
 * at most once a minute, and only when the check is neither finished nor
 * running.
 */
export function retryDeferredLink(generation: number): Promise<void> {
  return deliverCheck(generation, async () => {
    if (!retryWindowOpen()) {
      return false;
    }
    const retryable = RETRYABLE.includes((await readDeferredCheckStatus()).state);
    if (retryable) {
      noteRetryAsk();
    }
    return retryable;
  });
}
