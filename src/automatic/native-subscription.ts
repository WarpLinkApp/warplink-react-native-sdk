import {
  NativeEventEmitter,
  type EmitterSubscription,
  type NativeModule,
} from 'react-native';
import NativeWarpLink, { DEEP_LINK_EVENT } from '../NativeWarpLink';
import {
  addUrlHandler,
  hasUrlHandlers,
  removeUrlHandler,
  type UrlHandler,
} from './url-handlers';
import { dispatchNativeEvent } from './warm-arrivals';

let emitter: NativeEventEmitter | null = null;
let nativeSubscription: EmitterSubscription | null = null;

function ensureEmitterSubscribed(): void {
  if (!emitter) {
    emitter = new NativeEventEmitter(
      NativeWarpLink as unknown as NativeModule
    );
  }
  if (!nativeSubscription) {
    nativeSubscription = emitter.addListener(
      DEEP_LINK_EVENT,
      dispatchNativeEvent
    );
  }
}

function unsubscribeIfIdle(): void {
  if (!hasUrlHandlers() && nativeSubscription) {
    nativeSubscription.remove();
    nativeSubscription = null;
  }
}

/**
 * Registers `handler` for native deep-link events, subscribing to the native
 * emitter on the first one. Returns the function that removes it, and the
 * native subscription goes with the last handler.
 */
export function subscribeUrlHandler(handler: UrlHandler): () => void {
  addUrlHandler(handler);
  ensureEmitterSubscribed();
  return () => {
    removeUrlHandler(handler);
    unsubscribeIfIdle();
  };
}
