import NativeWarpLink from '../NativeWarpLink';
import { deserializeDeepLink } from '../deserialize';
import { mapNativeError } from '../native-error';
import type { DeepLinkEvent } from '../types';
import { currentResetEpoch, currentSink, isCurrentGeneration } from './auto-session';

/** Runs the deferred check and delivers a match to the sink of `generation`. */
export async function dispatchDeferredLink(generation: number): Promise<void> {
  const epoch = currentResetEpoch();
  const isStale = (): boolean => epoch !== currentResetEpoch() || !isCurrentGeneration(generation);
  let event: DeepLinkEvent | null = null;
  try {
    // At-most-once: the native checkDeferredDeepLink returns the cached match
    // on every call, so dispatching its result on every configure() would
    // re-fire the deferred link each launch. Only auto-dispatch while the
    // check has not yet definitively completed, matching the native iOS/
    // Android auto-dispatch guard. The manual checkDeferredDeepLink() still
    // returns the cached match for advanced callers.
    const alreadyComplete = await NativeWarpLink.isAttributionComplete();
    // A reset or a new configure() can land during the await: the native check
    // would then refill cleared state or touch the new session.
    if (isStale()) {
      return;
    }
    if (!alreadyComplete) {
      const result = await NativeWarpLink.checkDeferredDeepLink();
      const deepLink = deserializeDeepLink(result);
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
    sink(event);
  }
}
