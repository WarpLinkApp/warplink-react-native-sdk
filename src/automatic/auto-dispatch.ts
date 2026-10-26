import type { DeepLinkEvent } from '../types';
import { arrivalsSettled } from './arrival-queue';
import { autoEventFor, deliverResolved } from './auto-event';
import { currentSink } from './auto-session';
import { latestTap } from './tap-ledger';

/**
 * The url handler of the automatic path: delivers a warm url's answer to the
 * `onLink` of the configure() it arrived under.
 */
export function autoDispatchUrl(
  _url: string,
  resolved: DeepLinkEvent | null,
  tap: number | null,
  generation: number
): void {
  // Only the configure() the tap arrived under may receive its answer (WL-S07),
  // the rule the cold and deferred paths already follow. A new configure()
  // registers this same handler again, so without the check an answer that
  // crossed one was handed to the new onLink. iOS stays silent there too: its
  // configure() cancels the tap in flight (`supersedeInFlightTap`). Bead:
  // warplink-4uzm.
  //
  // Checked once, as the answer arrives, and not again after the waits below.
  // Both natives decide a tap at its answer, so an answer that arrived under
  // this configure() belongs to its onLink even if a later configure() lands
  // while the tap waits on a newer url.
  const sink = currentSink(generation);
  if (!sink) {
    return;
  }
  // Only a claim made before this answer can supersede it, so every url that
  // arrived before it has to have been classified first: see arrivalsSettled.
  void arrivalsSettled()
    .then(() => autoEventFor(tap, latestTap(), resolved))
    .then((event) => {
      deliverResolved(sink, event);
    });
}
