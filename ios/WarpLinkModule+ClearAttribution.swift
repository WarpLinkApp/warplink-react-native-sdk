import Foundation
import React
@_spi(ReactNative) import WarpLink

/// The Test key attribution reset, bridged. The native SDK decides what a
/// reset clears and that a live key is a no-op; this file only forwards the
/// call.
extension WarpLinkModule {

  @objc func clearAttribution(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    switch WarpLink.clearAttribution() {
    case .success:
      resolve(nil)
    case .failure(.decodingError(let cause)):
      // The native SDK reports a marker it could not delete as a decoding
      // error with a plain message; here it is the storage code.
      reject("E_STORAGE_ERROR", cause.localizedDescription, cause as NSError)
    case .failure(let error):
      rejectWithWarpLinkError(error, rejecter: reject)
    }
  }
}
