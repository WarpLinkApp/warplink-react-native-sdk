import type {
  AttributionEvidence,
  EvidenceClass,
  MatchMethod,
  ReplayState,
} from './referral-types';

const MATCH_METHODS: readonly MatchMethod[] = [
  'install_token',
  'android_referrer',
  'device_id',
  'link_open',
  'probabilistic',
];
const EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  'exact',
  'estimated',
  'legacy_link',
];
const REPLAY_STATES: readonly ReplayState[] = ['original', 'replayed'];

function pick<T extends string>(
  allowed: readonly T[],
  value: unknown
): T | null {
  return allowed.find((candidate) => candidate === value) ?? null;
}

export const deserializeMatchMethod = (value: unknown): MatchMethod | null =>
  pick(MATCH_METHODS, value);

export const deserializeReplayState = (value: unknown): ReplayState | null =>
  pick(REPLAY_STATES, value);

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function plainObject(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Reads the evidence fields leniently. A payload from a native SDK older than
 * 1.2.0, or a value this version does not know, reads as a safe default and
 * never drops the match around it.
 */
export function deserializeEvidence(
  obj: Record<string, unknown>
): AttributionEvidence {
  return {
    attributionId: nonEmptyString(obj['attributionId']),
    matchMethod: deserializeMatchMethod(obj['matchMethod']),
    evidenceClass: pick(EVIDENCE_CLASSES, obj['evidenceClass']),
    replayState: deserializeReplayState(obj['replayState']),
    capturedParams: plainObject(obj['capturedParams']),
    tappedAt: nonEmptyString(obj['tappedAt']),
  };
}
