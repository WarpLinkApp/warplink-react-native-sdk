import NativeWarpLink from '../NativeWarpLink';
import { mapNativeError } from '../native-error';
import {
  currentSessionReset,
  currentGeneration,
  invalidateDeferredDispatches,
} from './auto-session';
import { dispatchDeferredLink } from './deferred-link';

/**
 * The body of `WarpLink.clearAttribution`: see its documentation.
 *
 * Only a Test session invalidates the deferred dispatches in flight and starts
 * a fresh check. With a live key the native call is a no-op, and dropping a
 * live match that is about to be delivered would lose a real attribution.
 */
export async function clearAttributionSdk(): Promise<void> {
  const reset = currentSessionReset();
  const generation = currentGeneration();
  if (reset?.testKey) {
    invalidateDeferredDispatches();
  }
  try {
    await NativeWarpLink.clearAttribution();
  } catch (error) {
    throw mapNativeError(error);
  }
  if (reset?.testKey && reset.restartDeferred && generation === currentGeneration()) {
    dispatchDeferredLink(generation).catch((error: unknown) => {
      console.warn('[WarpLink] onLink threw while delivering the check after clearAttribution', error);
    });
  }
}
