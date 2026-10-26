import NativeWarpLink from '../NativeWarpLink';
import { deserializeDeepLink } from '../deserialize';
import { mapNativeError } from '../native-error';
import type { DeepLinkEvent } from '../types';

/**
 * Resolves `url` once through the native module. A failure becomes an `{ error }`
 * event, so nothing that awaits this ever rejects; `null` means the url resolved
 * to no deep link.
 */
export async function resolveOnce(url: string): Promise<DeepLinkEvent | null> {
  try {
    const result = await NativeWarpLink.handleDeepLink(url);
    const deepLink = deserializeDeepLink(result);
    return deepLink ? { deepLink } : null;
  } catch (error) {
    return { error: mapNativeError(error) };
  }
}
