import type { WarpLinkDeepLink } from '../types';
import {
  currentDeferredRoute,
  currentGeneration,
  currentSink,
  noteDeferredRoute,
} from './auto-session';

/** The link id, or the destination address when there is no id. Evidence is not part of it. */
function isSameRoute(a: WarpLinkDeepLink, b: WarpLinkDeepLink): boolean {
  return a.linkId ? a.linkId === b.linkId : !b.linkId && a.destination === b.destination;
}

/**
 * Gives `onLink` the exact link a Tether read resolved, when the sink already
 * holds a different deferred link, usually the estimate the first-launch check
 * delivered in the paste button and on call modes. It does nothing when `onLink`
 * was never given a link, or already has this one. The read still resolves with
 * the link; an exception from the host's `onLink` is logged, never thrown into
 * the read.
 */
export function routeTetherMatch(link: WarpLinkDeepLink): void {
  const earlier = currentDeferredRoute();
  if (!earlier || isSameRoute(earlier, link)) {
    return;
  }
  const sink = currentSink(currentGeneration());
  if (!sink) {
    return;
  }
  noteDeferredRoute(link);
  try {
    sink({ deepLink: link });
  } catch (error) {
    console.warn('[WarpLink] onLink threw while delivering the exact Tether link', error);
  }
}
