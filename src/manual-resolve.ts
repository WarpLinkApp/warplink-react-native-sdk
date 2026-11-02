import NativeWarpLink from './NativeWarpLink';
import type { WarpLinkDeepLink } from './types';
import { mapNativeError } from './native-error';
import { classifyUrl } from './automatic/classify-url';
import { resolveClaimed } from './automatic/resolve-claimed';
import { resolveOnce } from './automatic/resolve-once';
import { claimAutoTap } from './automatic/tap-ledger';

/**
 * A manual resolve reaches the same native module as the automatic path, so
 * on Android it cancels whatever automatic tap is in flight
 * (`LinkResolver.resolveDeepLink`). Claiming a silent tap first
 * (`claimAutoTap(true)`, the mechanism warplink-z07t added for a forced
 * repeat) makes this call count as a newer tap for supersession without
 * ever handing its own answer to the automatic sink: the cancellation it
 * causes is swallowed as a superseded tap instead of reaching `onLink` as a
 * spurious `E_NETWORK_ERROR` (warplink-17r7). This call's own promise still
 * settles from its own native answer, unaffected by whether it superseded
 * anything.
 *
 * A FOREIGN url claims nothing. Neither native ever lets one near a claim
 * (Android `UriParser.isWarpLinkUri` before `tapGeneration`; iOS
 * `isWarpLinkURL` before `supersedeInFlightTap`), and it cancels nothing on
 * either platform, so a silent tap for one would silence an automatic tap
 * that is still the host's. The native resolve runs either way and still
 * rejects a foreign url with its own `E_INVALID_URL` (warplink-0csz).
 */
export async function handleDeepLink(url: string): Promise<WarpLinkDeepLink | null> {
  const resolved = (await classifyUrl(url))
    ? await resolveClaimed(url, claimAutoTap(true))
    : await resolveOnce(url);
  if (resolved?.error) {
    throw resolved.error;
  }
  return resolved?.deepLink ?? null;
}

export async function getInitialDeepLink(): Promise<WarpLinkDeepLink | null> {
  try {
    const url = await NativeWarpLink.getInitialURL();
    if (url == null) {
      return null;
    }
    // Goes through handleDeepLink's silent-claim supersession (warplink-17r7)
    // rather than a second copy of it.
    return await handleDeepLink(url);
  } catch (error) {
    throw mapNativeError(error);
  }
}
