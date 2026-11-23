import type { WarpLinkDeepLink } from '../types';

/**
 * How the SDK gets a Tether code from the clipboard.
 *
 * - `'pasteButton'` (default): the SDK never reads the clipboard by itself.
 *   The person taps `WarpLinkPasteButton`, the system's own paste control, so
 *   iOS shows no paste alert.
 * - `'automatic'`: iOS may show its paste alert once, during the first-launch
 *   attribution check.
 * - `'onCall'`: the SDK reads the clipboard only when you call
 *   `WarpLink.readTether()`.
 *
 * Android reads no clipboard in any mode. A value that is not one of these
 * reads as `'pasteButton'`, so a typo can never switch a read on.
 */
export type TetherReadMode = 'pasteButton' | 'automatic' | 'onCall';

/** The name the native SDKs and the server use for each read mode. */
export const TETHER_READ_MODE_WIRE: Readonly<Record<TetherReadMode, string>> = {
  pasteButton: 'paste_button',
  automatic: 'automatic',
  onCall: 'on_call',
};

/** Why no Tether code arrived. */
export type TetherMissReason =
  | 'paste_not_allowed'
  | 'clipboard_empty'
  | 'in_app_browser'
  | 'expired'
  | 'other_app'
  | 'link_ended'
  | 'older_sdk';

/**
 * What a Tether read ended on. A failure is a rejected promise with a
 * `WarpLinkError`, never one of these.
 *
 * - `matched`: the code led to `link`.
 * - `noCode`: no code was read and nothing was sent. `reason` says why, and is
 *   `null` on Android, which reads nothing.
 * - `unusable`: a code was sent and led nowhere. Let the person continue.
 * - `test`: a test code reached the server and nothing was recorded.
 */
export type TetherReadResult =
  | { kind: 'matched'; link: WarpLinkDeepLink }
  | { kind: 'noCode'; reason: TetherMissReason | null }
  | { kind: 'unusable' }
  | { kind: 'test'; receipt: string | null };
