import { NativeModules, Platform } from 'react-native';

export interface NativeWarpLinkModule {
  configure(config: object): Promise<void>;
  handleDeepLink(url: string): Promise<object | null>;
  checkDeferredDeepLink(): Promise<object | null>;
  getAttributionResult(): Promise<object | null>;
  isConfigured(): Promise<boolean>;
  getInitialURL(): Promise<string | null>;
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
