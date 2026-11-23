import NativeWarpLink from '../NativeWarpLink';
import { mapNativeError } from '../native-error';
import { ErrorCodes, WarpLinkError } from '../types';

/**
 * Where the first-launch link check stands for this install.
 *
 * - `notChecked`: no check has finished yet and none is running. A failed check
 *   whose wait is over reads this too.
 * - `checking`: a check is running, or waiting for the app to come on screen.
 * - `matched`: the check finished and found a link.
 * - `noMatch`: the check finished and found no link.
 * - `waiting`: a check failed. No request is sent before `retryAt`.
 * - `skippedOldInstall`: the install is older than 30 days by default, so no
 *   request is sent.
 * - `stopped`: the SDK gave up, 3 days by default after the first failure.
 */
export type DeferredCheckState =
  | 'notChecked'
  | 'checking'
  | 'matched'
  | 'noMatch'
  | 'waiting'
  | 'skippedOldInstall'
  | 'stopped';

export interface DeferredCheckStatus {
  state: DeferredCheckState;
  /** Epoch milliseconds when the next check is allowed. Set only for `waiting`. */
  retryAt?: number;
}

const STATES: readonly DeferredCheckState[] = [
  'notChecked',
  'checking',
  'matched',
  'noMatch',
  'waiting',
  'skippedOldInstall',
  'stopped',
];

function malformed(): WarpLinkError {
  return new WarpLinkError(
    ErrorCodes.E_DECODING_ERROR,
    'Malformed deferred check status from native module'
  );
}

function deserializeStatus(raw: unknown): DeferredCheckStatus {
  if (raw == null || typeof raw !== 'object') {
    throw malformed();
  }
  const obj = raw as Record<string, unknown>;
  const state = STATES.find((known) => known === obj['state']);
  if (state === undefined) {
    throw malformed();
  }
  if (state !== 'waiting') {
    return { state };
  }
  const retryAt = obj['retryAt'];
  if (typeof retryAt !== 'number') {
    throw malformed();
  }
  return { state, retryAt };
}

/** Reads the status from the native module. Sends no request. */
export async function readDeferredCheckStatus(): Promise<DeferredCheckStatus> {
  try {
    return deserializeStatus(await NativeWarpLink.getDeferredCheckStatus());
  } catch (error) {
    throw mapNativeError(error);
  }
}
