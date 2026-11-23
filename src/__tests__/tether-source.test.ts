import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' ? [] : tsFiles(path);
    }
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('Tether source rules', () => {
  it('WL-S55 this package never clears or writes the clipboard, the native SDK does', () => {
    const writes = /Clipboard\.setString|UIPasteboard|\.string\s*=|setPrimaryClip|clearPrimaryClip/;
    const files = [
      ...tsFiles(join(ROOT, 'src')),
      join(ROOT, 'ios/WarpLinkModule+Tether.swift'),
      join(ROOT, 'ios/WarpLinkPasteButtonView.swift'),
      join(ROOT, 'android/src/main/kotlin/app/warplink/reactnative/TetherSerializer.kt'),
    ];

    const offenders = files.filter((file) => writes.test(readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('WL-S57 the paste button manager builds the control on iOS 16 and later', () => {
    const manager = read('ios/WarpLinkPasteButtonManager.swift');
    const view = read('ios/WarpLinkPasteButtonView.swift');

    expect(manager).not.toContain('WARPLINK_NO_CLIPBOARD');
    expect(view).not.toContain('WARPLINK_NO_CLIPBOARD');
    expect(manager.indexOf('WarpLinkPasteButtonView()')).toBeGreaterThan(
      manager.indexOf('#available(iOS 16.0, *)')
    );
  });

  it('WL-S58 the iOS bridge declares react-native before it configures the native SDK', () => {
    const configure = read('ios/WarpLinkModule+Configure.swift');

    expect(configure).toContain('WarpLink.declareHostWrapper("react-native")');
    expect(configure.indexOf('declareHostWrapper')).toBeLessThan(
      configure.indexOf('WarpLink.configure(')
    );
  });

  it('WL-S62 JavaScript leaves a pending code to the native SDK, which retries it', () => {
    const offenders = tsFiles(join(ROOT, 'src')).filter((file) => /retry_after|retryAfter|tether.*pending/i.test(readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('WL-S58 JavaScript neither makes nor sends an installation id', () => {
    const offenders = tsFiles(join(ROOT, 'src')).filter((file) =>
      /installation_id|installationId/.test(readFileSync(file, 'utf8'))
    );

    expect(offenders).toEqual([]);
  });
});
