import { deserializeDeepLink } from '../deserialize';
import type { TetherMissReason, TetherReadResult } from './tether-types';

const MISS_REASONS: readonly TetherMissReason[] = [
  'paste_not_allowed',
  'clipboard_empty',
  'in_app_browser',
  'expired',
  'other_app',
  'link_ended',
  'older_sdk',
];

const UNUSABLE: TetherReadResult = { kind: 'unusable' };

function missReason(value: unknown): TetherMissReason | null {
  return MISS_REASONS.find((reason) => reason === value) ?? null;
}

/**
 * Reads a Tether answer from the native module. A payload this layer cannot
 * read is `unusable`, never an error, so a bridge mismatch cannot block
 * onboarding. A reason this version does not know reads as `null`.
 */
export function deserializeTetherResult(raw: unknown): TetherReadResult {
  if (raw == null || typeof raw !== 'object') {
    return UNUSABLE;
  }
  const obj = raw as Record<string, unknown>;
  switch (obj['kind']) {
    case 'matched': {
      const link = deserializeDeepLink(obj['link']);
      return link ? { kind: 'matched', link } : UNUSABLE;
    }
    case 'noCode':
      return { kind: 'noCode', reason: missReason(obj['reason']) };
    case 'test':
      return {
        kind: 'test',
        receipt:
          typeof obj['receipt'] === 'string' && obj['receipt'] !== ''
            ? obj['receipt']
            : null,
      };
    default:
      return UNUSABLE;
  }
}
