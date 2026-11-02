import NativeWarpLink from './NativeWarpLink';
import {
  ErrorCodes,
  WarpLinkError,
  type AttributionResult,
  type WarpLinkDeepLink,
} from './types';
import { mapNativeError } from './native-error';
import {
  deserializeAttributionResult,
  deserializeDeepLink,
} from './deserialize';

export async function checkDeferredDeepLink(): Promise<WarpLinkDeepLink | null> {
  try {
    return deserializeDeepLink(await NativeWarpLink.checkDeferredDeepLink());
  } catch (error) {
    throw mapNativeError(error);
  }
}

export async function getAttributionResult(): Promise<AttributionResult | null> {
  let raw: unknown;
  try {
    raw = await NativeWarpLink.getAttributionResult();
  } catch (error) {
    throw mapNativeError(error);
  }
  if (raw == null) {
    // Genuine no-match.
    return null;
  }
  const parsed = deserializeAttributionResult(raw);
  if (parsed == null) {
    // A payload was returned but could not be decoded.
    throw new WarpLinkError(
      ErrorCodes.E_DECODING_ERROR,
      'Malformed attribution result from native module'
    );
  }
  return parsed;
}

export async function sdkVersion(): Promise<string> {
  try {
    return await NativeWarpLink.getSdkVersion();
  } catch (error) {
    throw mapNativeError(error);
  }
}

export async function isAttributionComplete(): Promise<boolean> {
  try {
    return await NativeWarpLink.isAttributionComplete();
  } catch (error) {
    throw mapNativeError(error);
  }
}

export async function isConfigured(): Promise<boolean> {
  try {
    return await NativeWarpLink.isConfigured();
  } catch (error) {
    throw mapNativeError(error);
  }
}
