import Foundation
import React
@_spi(ReactNative) import WarpLink

extension WarpLinkModule {

  /**
   * The native SDK's own version string, not the npm package's.
   *
   * This bridge pins its native SDKs by hand, and the pin has drifted before,
   * so a host has to be able to ask what it is actually running.
   */
  @objc func getSdkVersion(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(WarpLink.sdkVersion)
  }

  @objc func isConfigured(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(WarpLink.isConfigured)
  }

  @objc func isAttributionComplete(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(WarpLink.isAttributionComplete)
  }

  /// Read-only: sends no request. Before `configure` the SDK answers `.notChecked`.
  @objc func getDeferredCheckStatus(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(Self.deferredCheckPayload(WarpLink.deferredCheckStatus))
  }

  /// The map JavaScript reads: `state`, plus `retryAt` in epoch milliseconds
  /// for `waiting` only.
  static func deferredCheckPayload(_ status: DeferredCheckStatus) -> NSDictionary {
    switch status {
    case .notChecked: return ["state": "notChecked"]
    case .checking: return ["state": "checking"]
    case .matched: return ["state": "matched"]
    case .noMatch: return ["state": "noMatch"]
    case let .waiting(retryAt):
      return ["state": "waiting", "retryAt": (retryAt.timeIntervalSince1970 * 1000).rounded()]
    case .skippedOldInstall: return ["state": "skippedOldInstall"]
    case .stopped: return ["state": "stopped"]
    }
  }
}
