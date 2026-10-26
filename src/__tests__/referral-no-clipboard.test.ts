import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const SOURCE_DIRS = ['src', 'ios', 'android/src/main'];
const SOURCE_FILE = /\.(ts|tsx|swift|m|kt|java)$/;
const SKIPPED_DIRS = ['__tests__', 'Pods', 'build'];
const CLIPBOARD =
  /UIPasteboard|ClipboardManager|ClipData|react-native-clipboard|Clipboard\.getString/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return SKIPPED_DIRS.includes(name) ? [] : sourceFiles(path);
    }
    return SOURCE_FILE.test(name) ? [path] : [];
  });
}

describe('clipboard access', () => {
  it('WL-S47 no SDK source reads the system clipboard', () => {
    const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)));
    expect(files.length).toBeGreaterThan(5);

    const offenders = files.filter((file) =>
      CLIPBOARD.test(readFileSync(file, 'utf8'))
    );

    expect(offenders).toEqual([]);
  });
});
