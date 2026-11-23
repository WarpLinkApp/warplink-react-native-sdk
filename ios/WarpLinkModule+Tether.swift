import Foundation
import React
@_spi(ReactNative) import WarpLink

/// The Tether handoff, bridged. The native SDK owns every decision: it reads
/// the clipboard, sends only a WarpLink code, and clears the clipboard once the
/// server has used the code. No clipboard text ever crosses this bridge.
extension WarpLinkModule {

  @objc func readTether(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    WarpLink.readTether { result in
      switch result {
      case .success(let read):
        resolve(Self.tetherPayload(read))
      case .failure(let error):
        self.rejectWithWarpLinkError(error, rejecter: reject)
      }
    }
  }

  @objc func getTetherTestReceipt(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(WarpLink.lastTetherTestReceipt)
  }

  /// A Tether outcome as the map JavaScript reads: `kind` plus `link`,
  /// `reason` or `receipt`. An absent value crosses as `NSNull`.
  static func tetherPayload(_ result: TetherReadResult) -> NSDictionary {
    switch result {
    case .matched(let link):
      return ["kind": "matched", "link": deepLinkPayload(link)]
    case .noCode(let reason):
      return ["kind": "noCode", "reason": reason.rawValue]
    case .unusable:
      return ["kind": "unusable"]
    case .test(let receipt):
      return ["kind": "test", "receipt": receipt as Any]
    }
  }

  /// The body of a paste button event: `result` for an outcome, `error` for a
  /// failure, so JavaScript can tell the two apart.
  static func tetherEventBody(
    _ result: Result<TetherReadResult, WarpLinkError>
  ) -> [AnyHashable: Any] {
    switch result {
    case .success(let read):
      return ["result": tetherPayload(read)]
    case .failure(let error):
      return [
        "error": [
          "code": errorCode(for: error),
          "message": error.errorDescription ?? String(describing: error),
        ]
      ]
    }
  }
}
