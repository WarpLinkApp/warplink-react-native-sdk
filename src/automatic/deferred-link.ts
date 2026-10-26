import NativeWarpLink from '../NativeWarpLink';
import { deserializeDeepLink } from '../deserialize';
import { mapNativeError } from '../native-error';
import type { DeepLinkEvent } from '../types';
import { currentSink } from './auto-session';

/** Runs the deferred check and delivers a match to the sink of `generation`. */
export async function dispatchDeferredLink(generation: number): Promise<void> {
  let event: DeepLinkEvent | null = null;
  try {
    // At-most-once: the native checkDeferredDeepLink returns the cached match
    // on every call, so dispatching its result on every configure() would
    // re-fire the deferred link each launch. Only auto-dispatch while the
    // check has not yet definitively completed, matching the native iOS/
    // Android auto-dispatch guard. The manual checkDeferredDeepLink() still
    // returns the cached match for advanced callers.
    const alreadyComplete = await NativeWarpLink.isAttributionComplete();
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
  if (event && sink) {
    sink(event);
  }
}
