import {
  deserializeMatchMethod,
  deserializeReplayState,
} from './deserialize-evidence';
import type {
  ReferralClaimResult,
  ReferralClaimStatus,
} from './referral-types';

const STATUSES: readonly ReferralClaimStatus[] = [
  'claimed',
  'flagged',
  'ignored',
  'none',
];

function noReferral(): ReferralClaimResult {
  return {
    status: 'none',
    referralId: null,
    linkId: null,
    linkUrl: null,
    matchMethod: null,
    isExact: false,
    matchConfidence: null,
    flags: [],
    duplicateOf: null,
    updated: false,
    replayState: null,
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Reads a claim answer from the native module. An unreadable payload or an
 * unknown status reads as `none`: only a key or network failure is an error.
 */
export function deserializeClaimResult(raw: unknown): ReferralClaimResult {
  if (raw == null || typeof raw !== 'object') {
    return noReferral();
  }
  const obj = raw as Record<string, unknown>;
  const status = STATUSES.find((s) => s === obj['status']);
  if (status == null || status === 'none') {
    return noReferral();
  }
  return {
    status,
    referralId: text(obj['referralId']),
    linkId: text(obj['linkId']),
    linkUrl: text(obj['linkUrl']),
    matchMethod: deserializeMatchMethod(obj['matchMethod']),
    isExact: obj['isExact'] === true,
    matchConfidence:
      typeof obj['matchConfidence'] === 'number'
        ? obj['matchConfidence']
        : null,
    flags: Array.isArray(obj['flags'])
      ? obj['flags'].filter((f): f is string => typeof f === 'string')
      : [],
    duplicateOf: text(obj['duplicateOf']),
    updated: obj['updated'] === true,
    replayState: deserializeReplayState(obj['replayState']),
  };
}
