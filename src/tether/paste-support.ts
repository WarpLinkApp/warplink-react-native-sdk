/**
 * The system paste control exists on iOS 16 and newer. Android reads no
 * clipboard, and older iOS has no control that skips the paste alert, so the
 * button renders nothing there.
 */
export function pasteControlSupported(
  os: string,
  version: string | number
): boolean {
  if (os !== 'ios') {
    return false;
  }
  const major = parseInt(String(version), 10);
  return Number.isFinite(major) && major >= 16;
}
