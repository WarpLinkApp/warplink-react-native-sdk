import type { WarpLinkDeepLink, AttributionResult } from './types';
import { deserializeEvidence } from './referral/deserialize-evidence';

// Boolean flags the native module owns outright. A native SDK older than this
// one omits them from the bridged payload, and absent has to read as false: a
// missing `matchGuaranteed` must not let a host over-trust a probabilistic
// guess. Never derive these in JavaScript.
function deserializeNativeFlag(value: unknown): boolean {
  return Boolean(value);
}

export function deserializeDeepLink(raw: unknown): WarpLinkDeepLink | null {
  if (raw == null || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  return {
    linkId: String(obj['linkId'] ?? ''),
    destination: String(obj['destination'] ?? ''),
    deepLinkUrl:
      obj['deepLinkUrl'] != null ? String(obj['deepLinkUrl']) : null,
    customParams:
      obj['customParams'] != null &&
      typeof obj['customParams'] === 'object'
        ? (obj['customParams'] as Record<string, unknown>)
        : {},
    isDeferred: Boolean(obj['isDeferred']),
    matchType: deserializeMatchType(obj['matchType']),
    matchConfidence:
      typeof obj['matchConfidence'] === 'number'
        ? obj['matchConfidence']
        : null,
    matchGuaranteed: deserializeNativeFlag(obj['matchGuaranteed']),
    ...deserializeEvidence(obj),
  };
}

function deserializeMatchType(
  value: unknown
): 'deterministic' | 'probabilistic' | null {
  if (value === 'deterministic' || value === 'probabilistic') {
    return value;
  }
  return null;
}

export function deserializeAttributionResult(
  raw: unknown
): AttributionResult | null {
  if (raw == null || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const matchType = deserializeMatchType(obj['matchType']);
  if (matchType == null) {
    return null;
  }
  const matchConfidence = obj['matchConfidence'];
  if (typeof matchConfidence !== 'number') {
    return null;
  }

  return {
    linkId: String(obj['linkId'] ?? ''),
    matchType,
    matchConfidence,
    matchGuaranteed: deserializeNativeFlag(obj['matchGuaranteed']),
    isDeferred: Boolean(obj['isDeferred']),
    ...deserializeEvidence(obj),
  };
}
