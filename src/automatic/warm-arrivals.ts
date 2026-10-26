import { enqueueArrival } from './arrival-queue';
import { autoDispatchUrl } from './auto-dispatch';
import { currentGeneration } from './auto-session';
import { classifyUrl } from './classify-url';
import { claimStamp, shouldAutoDispatch, stampOwner } from './dedupe-stamp';
import { resolveClaimed } from './resolve-claimed';
import { resolveOnce } from './resolve-once';
import { claimAutoTap, isSettling } from './tap-ledger';
import { fanOut, hasHandlerBeyond, hasUrlHandlers } from './url-handlers';

/** Everything about an arrival that is true of the moment it arrived. */
type Arrival = {
  url: string;
  at: number;
  generation: number;
  hasSubscribers: boolean;
};

/**
 * Handles one native deep-link event: resolves the url a single time, then fans
 * the shared result to every handler.
 */
export function dispatchNativeEvent(event: { url: string }): void {
  if (!hasUrlHandlers()) {
    return;
  }
  // Everything about the moment of arrival is read HERE, synchronously with the
  // arrival, and carried into admission. Admission waits on a native round trip
  // first, and each of these would otherwise drift with however long that takes:
  //
  // - the configure() this arrival belongs to (WL-S07), which must be the one
  //   current when the url arrived: see autoDispatchUrl;
  // - the clock the dedupe window is measured against, which both natives read
  //   synchronously with the arrival, inside the call that claims. Read at
  //   admission, a slow classification pushed both the comparison and the new
  //   stamp later, so a duplicate could measure its way out of the window and
  //   resolve a second time;
  // - whether a host has its own onDeepLink() subscribers, which decides
  //   whether a foreign url is resolved at all and whether a repeat is forced
  //   through.
  const arrival: Arrival = {
    url: event.url,
    at: Date.now(),
    generation: currentGeneration(),
    hasSubscribers: hasHandlerBeyond(autoDispatchUrl),
  };
  void enqueueArrival(() => admitWarmArrival(arrival));
}

/**
 * Decides what an arriving warm url IS, and only then what to do about it.
 *
 * Runs inside the arrival queue, so everything it reads and writes about the
 * dedupe window is settled before the next arrival looks at it.
 */
async function admitWarmArrival(arrival: Arrival): Promise<void> {
  const { url, at, generation, hasSubscribers } = arrival;
  if (!(await classifyUrl(url))) {
    // A foreign url: an OAuth callback, an unrelated custom scheme, a link on
    // a domain this org does not own. It does not stamp the dedupe window,
    // does not claim a tap, supersedes nothing, and never reaches the
    // automatic sink, which is what both natives do by refusing it before their
    // own claim (warplink-0csz).
    //
    // Explicit onDeepLink() subscribers asked for every event and still get
    // this one, unchanged: the native module's own refusal, resolved for them
    // alone. With no such subscriber there is nobody to answer, so nothing is
    // resolved at all.
    if (hasSubscribers) {
      void resolveAndFan(url, null, generation);
    }
    return;
  }
  const fresh = shouldAutoDispatch(url, at);
  // A repeat arrival inside the dedupe window must not reach the native module
  // at all. Resolving it anyway would cancel the tap already in flight, and the
  // host would be handed that cancellation instead of its link. The native
  // SDKs dedupe before the request for the same reason.
  //
  // Explicit onDeepLink() subscribers asked for every event, so when any are
  // wired the resolve runs even for a repeat. That call still cancels the tap
  // already in flight, so the repeat claims a tap of its own to supersede it.
  if (!fresh && !hasSubscribers) {
    return;
  }
  // A repeat forced through only for an explicit subscriber is claimed silent
  // (delivered to the subscriber, never to onLink: see claimAutoTap) UNLESS
  // the tap that owns the current dedupe stamp is still resolving. Still in
  // flight, this repeat is standing in for the delivery that tap would have
  // made once superseded, and has to reach onLink the same as any other
  // superseding tap (warplink-8jih). Already answered, onLink already has this
  // navigation's answer, and delivering the repeat's own too would be the
  // second delivery WL-S03 forbids (warplink-z07t).
  const owner = stampOwner();
  const silent = !fresh && owner !== null && !isSettling(owner);
  const tap = claimAutoTap(silent);
  // Only an arrival that (re)stamped the dedupe window owns it. A repeat
  // forwarded solely for an explicit subscriber did not touch the stamp, so
  // its own tap must not be allowed to clear someone else's stamp later.
  if (fresh) {
    claimStamp(tap);
  }
  void resolveAndFan(url, tap, generation);
}

async function resolveAndFan(
  url: string,
  tap: number | null,
  generation: number
): Promise<void> {
  const resolved = await (tap === null
    ? resolveOnce(url)
    : resolveClaimed(url, tap));
  fanOut(url, resolved, tap, generation);
}
