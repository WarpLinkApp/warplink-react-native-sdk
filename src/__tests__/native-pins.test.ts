import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * The bridge reports whatever native SDK it is built against, and it pins that
 * SDK by hand. React Native v1.0.0, v1.0.1 and v1.0.2 all shipped pinning
 * app.warplink:sdk:1.0.0, an Android SDK that reports 0.1.1, while npm said
 * 1.0.x. `npm version` sets package.json from the tag at publish, so the
 * number on the package is always right and the pins inside it lag silently.
 * Every version this package names must be the same version.
 */
const root = resolve(__dirname, '..', '..');
const read = (file: string): string => readFileSync(resolve(root, file), 'utf8');

function firstMatch(text: string, pattern: RegExp, what: string): string {
  const match = pattern.exec(text);
  if (!match?.[1]) throw new Error(`${what}: pattern not found`);
  return match[1];
}

describe('the versions this package names agree', () => {
  const packageVersion = (JSON.parse(read('package.json')) as { version: string }).version;

  it('pins the Android SDK at the package version', () => {
    const pin = firstMatch(
      read('android/build.gradle.kts'),
      /implementation\("app\.warplink:sdk:([^"]+)"\)/,
      'android pin',
    );
    expect(pin).toBe(packageVersion);
  });

  it('floors the iOS package at the package version', () => {
    const floor = firstMatch(
      read('warplink-react-native.podspec'),
      /minimumVersion:\s*"([^"]+)"/,
      'podspec minimumVersion',
    );
    expect(floor).toBe(packageVersion);
  });

  it('heads the changelog with the package version', () => {
    const top = firstMatch(read('CHANGELOG.md'), /^## \[(\d+\.\d+\.\d+)\]/m, 'changelog heading');
    expect(top).toBe(packageVersion);
  });
});

/**
 * React Native stopped being one pod a long time ago. Since 0.71 a native module
 * declares its React dependencies by calling React Native's own helper,
 * `install_modules_dependencies(s)`, which expands to whatever that version of
 * React Native actually ships. React Native 0.86 distributes React as a
 * prebuilt xcframework, and a podspec that names `React-Core` by hand receives
 * no link flags at all: the pod then fails to link with undefined
 * `_OBJC_CLASS_$_RCTEventEmitter` and `_RCTRegisterModule`.
 *
 * Every community module in the test app does it the supported way.
 * `RNScreens.podspec:71` calls the helper outright;
 * `RNCAsyncStorage.podspec:30-35` calls it when it exists and falls back to
 * `React-Core` for older React Native, which is the shape this SDK needs
 * because it still supports 0.75.
 *
 * Bead: warplink-5ia2.
 */
describe('the podspec asks React Native for its own dependencies', () => {
  const podspec = read('warplink-react-native.podspec');

  it('calls install_modules_dependencies when React Native provides it', () => {
    expect(podspec).toMatch(/install_modules_dependencies\(s\)/);
  });

  it('guards that call so React Native 0.75 still resolves', () => {
    expect(podspec).toMatch(/respond_to\?\(:install_modules_dependencies, true\)/);
  });

  it('keeps the React-Core fallback for React Native without the helper', () => {
    expect(podspec).toMatch(/s\.dependency ["']React-Core["']/);
  });
});
