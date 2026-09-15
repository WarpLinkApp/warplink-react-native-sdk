import { NativeModules, Platform } from 'react-native';

export interface NativeWarpLinkModule {
  configure(config: object): Promise<void>;
  handleDeepLink(url: string): Promise<object | null>;
  /**
   * Whether the native SDK would treat this url as a WarpLink link: a host in
   * its known link-domain set, and a path that carries a slug.
   *
   * The one question this layer cannot answer for itself. The effective domain
   * set is the union of `aplnk.to`, what the host declared in code or in the
   * native manifest / Info.plist, and what `/sdk/validate` returned, and only
   * the native SDK holds all three. A copy in JavaScript would be a fourth
   * dialect, free to drift from the two that decide anything.
   *
   * Asked BEFORE the automatic path stamps its dedupe window or claims a tap,
   * which is what both natives do for themselves: Android
   * `AutoLinkHandler.dispatch` returns on `WarpLink.isWarpLinkUri` before
   * `claimLocked`, iOS `open()` returns on `WarpLink.isWarpLinkURL` before
   * `shouldSuppressDuplicate`. Learning it afterwards from an `E_INVALID_URL`
   * rejection is too late, because the dedupe state has already changed
   * (warplink-0csz).
   *
   * Resolves nothing, claims nothing, touches no network, and never rejects. A
   * string that is not a url at all answers false.
   */
  isWarpLinkUrl(url: string): Promise<boolean>;
  checkDeferredDeepLink(): Promise<object | null>;
  getAttributionResult(): Promise<object | null>;
  isConfigured(): Promise<boolean>;
  /**
   * Whether the deferred attribution check has definitively completed for this
   * install. Read before the automatic deferred dispatch so a matched deferred
   * link reaches `onLink` at most once across launches (native returns the
   * cached match on every call, so the TS layer must gate on this).
   *
   * Scoped to ONE install, deliberately. It must go back to `false` after the
   * app is deleted and installed again, and after a restore from backup,
   * because a reinstall counts as an install and has to be attributed again.
   * Backing it with storage that outlives the install (an iOS Keychain item,
   * a backed-up preference) is the defect this contract exists to prevent: the
   * automatic deferred dispatch below would read `true` on the first launch
   * after a reinstall and skip attribution entirely. "Has this device ever been
   * attributed" is a separate native marker, and it gates nothing.
   */
  isAttributionComplete(): Promise<boolean>;
  getInitialURL(): Promise<string | null>;
  /**
   * The version of the NATIVE SDK this bridge is built against, as that SDK
   * reports it over the wire.
   *
   * Deliberately not read from package.json. React Native pins its native SDK
   * by hand, and the published 1.0.2 pinned an Android SDK that reported
   * `0.1.1` while npm said `1.0.2`. A value taken from the package would agree
   * with itself and hide exactly that drift.
   */
  getSdkVersion(): Promise<string>;
}

export const DEEP_LINK_EVENT = 'onWarpLinkDeepLink';

const LINKING_ERROR =
  `The package '@warplink/react-native' doesn't seem to be linked. Make sure:\n\n` +
  Platform.select({
    ios: "- You have run 'pod install'\n",
    default: '',
  }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

function createProxy(): NativeWarpLinkModule {
  return new Proxy({} as NativeWarpLinkModule, {
    get() {
      throw new Error(LINKING_ERROR);
    },
  });
}

const NativeWarpLink: NativeWarpLinkModule =
  NativeModules['WarpLinkModule'] ?? createProxy();

export default NativeWarpLink;
