import { TETHER_READ_MODE_WIRE, type TetherReadMode } from './tether-types';

/**
 * The name the native SDKs use for a read mode. A value that is not a mode
 * reads as the default, the paste button, so a typo can never switch a
 * clipboard read on.
 */
export function tetherReadModeWire(mode: unknown): string {
  const known = (Object.keys(TETHER_READ_MODE_WIRE) as TetherReadMode[]).find(
    (key) => key === mode
  );
  return TETHER_READ_MODE_WIRE[known ?? 'pasteButton'];
}
