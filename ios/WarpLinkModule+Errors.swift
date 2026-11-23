import Foundation
import React
@_spi(ReactNative) import WarpLink

extension WarpLinkModule {

  func rejectWithError(
    code: String,
    message: String,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    reject(code, message, nil)
  }

  func rejectWithWarpLinkError(
    _ error: WarpLinkError,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    reject(
      Self.errorCode(for: error),
      error.errorDescription ?? String(describing: error),
      error as NSError
    )
  }

  static func errorCode(for error: WarpLinkError) -> String {
    switch error {
    case .notConfigured: return "E_NOT_CONFIGURED"
    case .invalidApiKeyFormat: return "E_INVALID_API_KEY_FORMAT"
    case .invalidApiKey: return "E_INVALID_API_KEY"
    case .networkError: return "E_NETWORK_ERROR"
    case .serverError: return "E_SERVER_ERROR"
    case .invalidURL: return "E_INVALID_URL"
    case .linkNotFound: return "E_LINK_NOT_FOUND"
    case .passwordRequired: return "E_PASSWORD_REQUIRED"
    case .decodingError: return "E_DECODING_ERROR"
    }
  }
}
