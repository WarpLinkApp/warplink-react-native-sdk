import NativeWarpLink from '../NativeWarpLink';
import { mapNativeError } from '../native-error';
import type { DeepLinkEvent, DeepLinkListener } from '../types';
import { arrivalsSettled, enqueueArrival } from './arrival-queue';
import { autoEventFor } from './auto-event';
import { currentSink } from './auto-session';
import { classifyUrl } from './classify-url';
import { claimStamp, shouldAutoDispatch } from './dedupe-stamp';
import { resolveClaimed } from './resolve-claimed';
import { latestTap, markTapUnused } from './tap-ledger';

/** The launch link's event, and the onLink it belongs to. */
type LaunchDelivery = {
  event: DeepLinkEvent | null;
  sink: DeepLinkListener | null;
};

/**
 * The launch url's own classify-and-claim step, queued behind every warm
 * arrival so the two cannot both stamp the window for one url. Answers whether
 * the launch url is to be resolved at all.
 *
 * Its tap number is taken by configure(), before this runs and deliberately:
 * the launch url arrived before anything this configure() will hear, so its
 * number has to be lower than any warm tap claimed while the native side is
 * still configuring. A launch url that turns out foreign therefore leaves that
 * number unused, which supersedes nothing and which nothing waits on.
 */
async function admitLaunchUrl(
  url: string,
  at: number,
  tap: number
): Promise<boolean> {
  if (!(await classifyUrl(url)) || !shouldAutoDispatch(url, at)) {
    // Foreign or duplicate: the tap never resolves, so it never delivers, so it
    // must never silence an older tap.
    markTapUnused(tap);
    return false;
  }
  // This arrival just (re)stamped the dedupe window, so its own tap is the one
  // allowed to release it on failure: see releaseStampOnFailure. What the tap
  // turns out to BE is still recorded from its native answer, in
  // `resolveClaimed`, exactly like every other claim.
  claimStamp(tap);
  return true;
}

/**
 * Resolves the launch url under the tap configure() claimed for it, and returns
 * the event the automatic path should deliver with the sink it belongs to. The
 * caller invokes the host sink so a throwing handler is never re-entered.
 *
 * The sink is the one current the moment resolveClaimed's answer arrives,
 * taken before the waits below. Both natives decide a tap at its answer
 * (autoDispatchUrl, WL-S07), so a second configure() landing while this one
 * still waits on arrivalsSettled/isSuperseded must not take the link away.
 * Taken after those waits it did, and nothing recovers that link: the launch
 * url is handed out once (iOS takePendingURL, Android InitialUrlBuffer.settle).
 * Bead: warplink-5q3f.
 *
 * Awaited in full, even while a newer tap is still resolving, because on React
 * Native the launch link is ordered, not raced (WL-S04): it is decided before
 * the deferred check starts and before configure() resolves, and a throw from
 * onLink leaves through configure(). The wait covers only taps claimed before
 * the launch link answered, so it ends with the slowest of those.
 */
async function resolveForAutoDispatch(
  url: string,
  tap: number,
  generation: number
): Promise<LaunchDelivery> {
  // Read here, where the launch url became known, and not inside the queued
  // work, which runs behind however many warm arrivals and native round trips
  // are ahead of it.
  const at = Date.now();
  if (!(await enqueueArrival(() => admitLaunchUrl(url, at, tap)))) {
    return { event: null, sink: null };
  }
  const resolved = await resolveClaimed(url, tap);
  const sink = currentSink(generation);
  await arrivalsSettled();
  const event = await autoEventFor(tap, latestTap(), resolved);
  return { event, sink };
}

/**
 * Delivers the launch url, if there is one, to the sink of `generation`. A throw
 * from the host callback propagates; a native failure is delivered to it as an
 * `{ error }` event.
 */
export async function dispatchColdStartLink(
  generation: number,
  tap: number
): Promise<void> {
  let delivery: LaunchDelivery = { event: null, sink: null };
  try {
    const url = await NativeWarpLink.getInitialURL();
    if (url != null) {
      delivery = await resolveForAutoDispatch(url, tap, generation);
    }
  } catch (error) {
    delivery = {
      event: { error: mapNativeError(error) },
      sink: currentSink(generation),
    };
  }
  // The host callback runs outside the try so an exception it throws
  // propagates instead of being caught and handed back to that same
  // callback as a fabricated WarpLink error.
  const { event, sink } = delivery;
  if (event && sink) {
    sink(event);
  }
}
