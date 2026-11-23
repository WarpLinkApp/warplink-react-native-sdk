import { readdirSync, readFileSync, statSync } from 'fs';
import { basename, join } from 'path';

const ROOT = join(__dirname, '..', '..');
const SOURCE_DIRS = ['src', 'ios', 'android/src/main'];
const SOURCE_FILE = /\.(ts|tsx|swift|m|kt|java)$/;
const SKIPPED_DIRS = ['__tests__', 'Pods', 'build'];
const CLIPBOARD =
  /UIPasteboard|UIPasteControl|ClipboardManager|ClipData|react-native-clipboard|Clipboard\.getString/;
const PASTE_BUTTON = /WarpLinkUIPasteButton/;
// The only files that may host the system paste control. Every other read of
// the clipboard happens inside the native iOS SDK (automatic mode, readTether),
// never in this package.
const PASTE_BUTTON_FILES = [
  'WarpLinkPasteButtonView.swift',
  'WarpLinkPasteButtonManager.swift',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return SKIPPED_DIRS.includes(name) ? [] : sourceFiles(path);
    }
    return SOURCE_FILE.test(name) ? [path] : [];
  });
}

function filesIn(dirs: string[]): string[] {
  return dirs.flatMap((dir) => sourceFiles(join(ROOT, dir)));
}

describe('clipboard access', () => {
  it('WL-S47 no source outside the paste button reads the system clipboard', () => {
    const files = filesIn(SOURCE_DIRS);
    expect(files.length).toBeGreaterThan(5);

    const offenders = files
      .filter((file) => !PASTE_BUTTON_FILES.includes(basename(file)))
      .filter((file) => CLIPBOARD.test(readFileSync(file, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('WL-S47 the system paste control is hosted only by the iOS paste button view', () => {
    const hosts = filesIn(['src', 'ios', 'android/src/main'])
      .filter((file) => PASTE_BUTTON.test(readFileSync(file, 'utf8')))
      .map((file) => basename(file));

    expect(hosts).toEqual(['WarpLinkPasteButtonView.swift']);
  });

  it('WL-S47 Android holds no clipboard access at all', () => {
    const offenders = filesIn(['android/src/main']).filter((file) =>
      CLIPBOARD.test(readFileSync(file, 'utf8'))
    );

    expect(offenders).toEqual([]);
  });
});
