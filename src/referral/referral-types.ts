/**
 * How a match was made, as the server reports it. It stays with the match for
 * good, including when the same match is later replayed.
 */
export type MatchMethod =
  | 'install_token'
  | 'android_referrer'
  | 'device_id'
  | 'link_open'
  | 'probabilistic';

/** How strong the evidence behind a match is. */
export type EvidenceClass = 'exact' | 'estimated' | 'legacy_link';

/** Whether an answer is the first one for the match or a repeat of it. */
export type ReplayState = 'original' | 'replayed';

/**
 * The status of a referral claim. `none` is an ordinary answer, not an error:
 * the claim found no referral to credit and nothing was recorded for it.
 */
export type ReferralClaimStatus = 'claimed' | 'flagged' | 'ignored' | 'none';

/** The answer to `WarpLink.claimReferral(installerId)`. */
export interface ReferralClaimResult {
  status: ReferralClaimStatus;
  /** The id of the referral, or `null` when the status is `none`. */
  referralId: string | null;
  /** The link the referral came from, or `null` when the status is `none`. */
  linkId: string | null;
  /** The short URL of that link, or `null` when the status is `none`. */
  linkUrl: string | null;
  /** How the referral was matched, or `null` when the status is `none`. */
  matchMethod: MatchMethod | null;
  /** True when the match rests on exact evidence rather than an estimate. */
  isExact: boolean;
  /** The confidence of an estimated match, or `null` when there is none. */
  matchConfidence: number | null;
  /** Reasons the referral was flagged, for example `outside_window`. */
  flags: string[];
  /** For `ignored`, the referral that already holds the credit. */
  duplicateOf: string | null;
  /** True when this call replaced an earlier estimate with an exact match. */
  updated: boolean;
  replayState: ReplayState | null;
}

/** The additive evidence fields on a matched link and on the attribution. */
export interface AttributionEvidence {
  /** The id of the attribution record behind this match, when there is one. */
  attributionId: string | null;
  matchMethod: MatchMethod | null;
  evidenceClass: EvidenceClass | null;
  replayState: ReplayState | null;
  /** The allowed parameters captured at the tap. Empty when there are none. */
  capturedParams: Record<string, unknown>;
  /** When the link was tapped, as an ISO 8601 string, or `null`. */
  tappedAt: string | null;
}
