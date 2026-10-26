import { ErrorCodes, type DeepLinkEvent } from '../types';
import { releaseStampOnFailure } from './dedupe-stamp';
import { resolveOnce } from './resolve-once';
import { settleTap, trackSettling } from './tap-ledger';

/**
 * Resolves a claimed tap, and records whether the native module treated it as
 * a WarpLink link: any answer but E_INVALID_URL, a failure included. Called
 * synchronously at the claim, so an older tap sees the newer one as pending
 * from the moment it exists.
 */
export function resolveClaimed(
  url: string,
  tap: number
): Promise<DeepLinkEvent | null> {
  const resolving = resolveOnce(url).then((resolved) => {
    settleTap(tap, resolved?.error?.code !== ErrorCodes.E_INVALID_URL);
    releaseStampOnFailure(tap, resolved);
    return resolved;
  });
  trackSettling(tap, resolving);
  return resolving;
}
