import NativeWarpLink from '../NativeWarpLink';
import { deserializeDeepLink } from '../deserialize';
import { mapNativeError } from '../native-error';
import { ErrorCodes, WarpLinkError, type WarpLinkDeepLink } from '../types';
import { deserializeClaimResult } from './deserialize-claim';
import type { ReferralClaimResult } from './referral-types';

/**
 * Hands the text a person pasted to the native SDK, which owns the whole
 * decision: shape, expiry, the retry record and the attempt limit.
 *
 * Resolves `null` for text that is not an invitation, without a request.
 * Rejects with a `WarpLinkError` when the invitation is invalid, expired or
 * could not be confirmed yet; the message says what the person should do.
 */
export async function redeemInvitation(
  text: string
): Promise<WarpLinkDeepLink | null> {
  if (typeof text !== 'string') {
    return null;
  }
  try {
    return deserializeDeepLink(await NativeWarpLink.redeemInvitation(text));
  } catch (error) {
    throw mapNativeError(error);
  }
}

/**
 * Claims the referral behind this install for the person who just signed up.
 * The native SDK checks the installer id (1 to 128 characters) and sends the
 * evidence it holds. Status `none` is an answer, never an error.
 */
export async function claimReferral(
  installerId: string
): Promise<ReferralClaimResult> {
  if (typeof installerId !== 'string') {
    throw new WarpLinkError(
      ErrorCodes.E_SERVER_ERROR,
      'installerId must be 1 to 128 characters'
    );
  }
  try {
    return deserializeClaimResult(
      await NativeWarpLink.claimReferral(installerId)
    );
  } catch (error) {
    throw mapNativeError(error);
  }
}
