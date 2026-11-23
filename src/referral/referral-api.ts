import type { WarpLinkDeepLink } from '../types';
import { claimReferral, redeemInvitation } from './referral-calls';
import type { ReferralClaimResult } from './referral-types';

/** The referral calls of `WarpLink`, spread into it like the Tether ones. */
export const referralApi = {
  /**
   * Finishes a referral handoff from the text a person pasted.
   *
   * Call it with the text from the system paste control the person taps; the
   * SDK never reads the clipboard. Text that is not an invitation resolves
   * `null`. A valid invitation resolves the matched link.
   *
   * @throws {WarpLinkError} `E_SERVER_ERROR` when the invitation is invalid or
   *   expired (the message says how to open the link again), or when it could
   *   not be confirmed yet. After a network failure the native SDK keeps the
   *   invitation and tries again on a later launch, a bounded number of times.
   * @throws {WarpLinkError} `E_NOT_CONFIGURED` when the SDK is not configured.
   */
  redeemInvitation(text: string): Promise<WarpLinkDeepLink | null> {
    return redeemInvitation(text);
  },

  /**
   * Claims the referral behind this install for the person who just signed up.
   *
   * `installerId` is your own stable id for that person, 1 to 128 characters,
   * dedicated to WarpLink: never a primary key, an email or other personal
   * data. Calling again with the same id is safe. Status `none` is an answer,
   * not an error.
   *
   * @throws {WarpLinkError} `E_SERVER_ERROR` for an empty or too long id, or a
   *   server failure; `E_NETWORK_ERROR`, `E_INVALID_API_KEY` and
   *   `E_NOT_CONFIGURED` as for the other calls.
   */
  claimReferral(installerId: string): Promise<ReferralClaimResult> {
    return claimReferral(installerId);
  },
};
