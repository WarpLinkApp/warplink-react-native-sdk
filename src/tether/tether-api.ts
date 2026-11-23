import NativeWarpLink from '../NativeWarpLink';
import { routeTetherMatch } from '../automatic/tether-exact-link';
import { mapNativeError } from '../native-error';
import { deserializeTetherResult } from './deserialize-tether';
import type { TetherReadResult } from './tether-types';

/**
 * The Tether calls that sit on `WarpLink`. Spread into the object in
 * `WarpLink.ts`.
 */
export const tetherApi = {
  /**
   * Reads the clipboard for a Tether code now, the one read the `'onCall'`
   * mode allows. The native SDK owns the whole decision: code shape, the
   * request, and clearing the clipboard once the server accepts the code.
   *
   * On iOS a first read may show the system paste alert. On Android nothing is
   * read and the result is `{ kind: 'noCode', reason: null }`.
   *
   * A match that replaces a link `onLink` already received (the estimate from
   * the first-launch check) is also delivered to `onLink`, as an exact link.
   *
   * Resolves with the outcome, including a code that led nowhere. Rejects with
   * a `WarpLinkError` when the SDK is not configured or the request failed.
   *
   * @example
   * ```ts
   * const result = await WarpLink.readTether();
   * if (result.kind === 'matched') openInvite(result.link);
   * ```
   */
  async readTether(): Promise<TetherReadResult> {
    let result: TetherReadResult;
    try {
      result = deserializeTetherResult(await NativeWarpLink.readTether());
    } catch (error) {
      throw mapNativeError(error);
    }
    if (result.kind === 'matched') {
      routeTetherMatch(result.link);
    }
    return result;
  },

  /**
   * The receipt the server returned for the last test code (`wl1t_`) this
   * session, or `null`. Kept in memory only: it is gone after a restart or
   * `clearAttribution()`.
   */
  async lastTetherTestReceipt(): Promise<string | null> {
    try {
      const receipt = await NativeWarpLink.getTetherTestReceipt();
      return typeof receipt === 'string' && receipt !== '' ? receipt : null;
    } catch (error) {
      throw mapNativeError(error);
    }
  },
};
