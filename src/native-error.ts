import { ErrorCodes, WarpLinkError, type ErrorCode } from './types';

function isErrorCode(code: string): code is ErrorCode {
  return Object.values(ErrorCodes).includes(code as ErrorCode);
}

export function mapNativeError(error: unknown): WarpLinkError {
  if (error instanceof WarpLinkError) {
    return error;
  }
  if (error instanceof Error) {
    const nativeError = error as Error & { code?: string };
    const code =
      nativeError.code && isErrorCode(nativeError.code)
        ? nativeError.code
        : ErrorCodes.E_SERVER_ERROR;
    return new WarpLinkError(code, nativeError.message);
  }
  return new WarpLinkError(ErrorCodes.E_SERVER_ERROR, String(error));
}
