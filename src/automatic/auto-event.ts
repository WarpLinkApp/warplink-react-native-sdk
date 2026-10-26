import { ErrorCodes, type DeepLinkEvent, type DeepLinkListener } from '../types';
import { isSilentTap, isSuperseded } from './tap-ledger';

export function deliverResolved(
  sink: DeepLinkListener,
  resolved: DeepLinkEvent | null
): void {
  if (resolved) {
    sink(resolved);
  }
}

/**
 * Narrows a resolved event to what the automatic path should deliver, or null
 * when there is nothing to deliver. `cutoff` is the last claim made before the
 * answer arrived; see isSuperseded.
 */
export async function autoEventFor(
  tap: number | null,
  cutoff: number,
  resolved: DeepLinkEvent | null
): Promise<DeepLinkEvent | null> {
  // A repeat arrival inside the dedupe window, or a foreign url resolved for
  // an explicit subscriber alone. Neither claimed a tap, and neither is this
  // path's to deliver.
  if (tap === null) {
    return null;
  }
  // Claimed only to supersede an older tap, never to deliver: see claimAutoTap.
  if (isSilentTap(tap)) {
    return null;
  }
  // A CLAIMED tap that still answers E_INVALID_URL: the classification and the
  // resolve disagreed, or the native module was too old to classify at all
  // (classifyUrl). The automatic path drops it rather than reporting a
  // spurious error to the host, mirroring the foreign-URL guards in the native
  // SDKs. Explicit onDeepLink() subscribers still receive it unchanged.
  // Checked first, so such a tap never waits.
  if (resolved?.error?.code === ErrorCodes.E_INVALID_URL) {
    return null;
  }
  // A tap a newer link replaced, whatever its own link.
  if (await isSuperseded(tap, cutoff)) {
    return null;
  }
  return resolved;
}
