import { routeTetherMatch } from '../automatic/tether-exact-link';
import { mapNativeError } from '../native-error';
import type { WarpLinkError } from '../types';
import { deserializeTetherResult } from './deserialize-tether';
import type { TetherReadResult } from './tether-types';

export interface PasteEventHandlers {
  onResult?: (result: TetherReadResult) => void;
  onError?: (error: WarpLinkError) => void;
}

function errorFrom(raw: unknown): WarpLinkError {
  const body = (raw ?? {}) as Record<string, unknown>;
  const message = typeof body['message'] === 'string' ? body['message'] : '';
  const code = typeof body['code'] === 'string' ? body['code'] : undefined;
  return mapNativeError(Object.assign(new Error(message), { code }));
}

/**
 * Routes one native paste button event to the host. The native view sends
 * `{ result }` or `{ error: { code, message } }`. A body this layer cannot read
 * is an `unusable` result, never a throw, so a bridge mismatch cannot block
 * onboarding. The text that was pasted never reaches this function.
 */
export function handlePasteEvent(
  body: unknown,
  handlers: PasteEventHandlers
): void {
  const event = (body ?? {}) as Record<string, unknown>;
  if (event['error'] != null) {
    handlers.onError?.(errorFrom(event['error']));
    return;
  }
  const result = deserializeTetherResult(event['result']);
  if (result.kind === 'matched') {
    routeTetherMatch(result.link);
  }
  handlers.onResult?.(result);
}
