import NativeWarpLink from '../NativeWarpLink';
import { CLASSIFY_CEILING_MS, settledWithin } from './waits';

/**
 * Whether the native module would treat `url` as a WarpLink link.
 *
 * This layer cannot decide it. The effective link-domain set is the union of
 * `aplnk.to`, what the host declared in code or in the native manifest /
 * Info.plist, and what `/sdk/validate` returned, and only the native SDK holds
 * all three. Both natives ask the same question of themselves before they touch
 * anything: Android `AutoLinkHandler.dispatch` returns on
 * `WarpLink.isWarpLinkUri` before `claimLocked`, iOS `open()` returns on
 * `WarpLink.isWarpLinkURL` before `shouldSuppressDuplicate`.
 *
 * Answers TRUE, failing open, whenever the native module does not answer:
 *
 * - it has no such method (an older native SDK), or the package is not linked
 *   at all, so the call throws where it stands;
 * - it rejects;
 * - it never settles, which `CLASSIFY_CEILING_MS` turns into an answer.
 *
 * False in any of those cases would silence every link on that install, which
 * is far worse than the duplicate this check exists to prevent. True degrades
 * to this layer's behaviour before the check existed, where a foreign url is
 * found out from its own `E_INVALID_URL` answer.
 *
 * The ceiling is what keeps a wedged native module from being fatal rather than
 * merely wrong. Admission is serialized (see `arrival-queue`), so an unbounded
 * wait here would stop that one chain for good, and a launch link queued behind
 * it would leave `configure()` itself unsettled. A late answer is not applied
 * retroactively; by then this arrival has already been decided.
 */
export async function classifyUrl(url: string): Promise<boolean> {
  let answer: boolean | undefined;
  try {
    const asked = NativeWarpLink.isWarpLinkUrl(url).then(
      (isLink) => {
        answer = isLink;
      },
      () => undefined
    );
    await settledWithin(asked, CLASSIFY_CEILING_MS);
  } catch {
    return true;
  }
  return answer ?? true;
}
