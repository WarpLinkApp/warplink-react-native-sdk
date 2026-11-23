import XCTest

@testable import Bridge
@_spi(ReactNative) import WarpLink

/// Every native status reaches JavaScript under the name the TypeScript layer
/// reads, and `waiting` carries its retry time in epoch milliseconds.
///
/// These tests live OUTSIDE `ios/`, like the others beside them, so they never
/// compile into a customer's app.
final class WarpLinkModuleDeferredStatusTests: XCTestCase {

  // conformance: WL-S74
  func testEachStateWithoutAWaitIsItsNameAlone() {
    let expected: [(DeferredCheckStatus, String)] = [
      (.notChecked, "notChecked"),
      (.checking, "checking"),
      (.matched, "matched"),
      (.noMatch, "noMatch"),
      (.skippedOldInstall, "skippedOldInstall"),
      (.stopped, "stopped"),
    ]
    for (status, name) in expected {
      let payload = WarpLinkModule.deferredCheckPayload(status) as? [String: Any]
      XCTAssertEqual(payload?["state"] as? String, name)
      XCTAssertEqual(payload?.count, 1)
    }
  }

  // conformance: WL-S74
  func testWaitingCarriesTheRetryTimeInEpochMilliseconds() {
    let retryAt = Date(timeIntervalSince1970: 1_800_000_000.25)
    let payload = WarpLinkModule.deferredCheckPayload(.waiting(retryAt: retryAt)) as? [String: Any]

    XCTAssertEqual(payload?["state"] as? String, "waiting")
    XCTAssertEqual(payload?["retryAt"] as? Double, 1_800_000_000_250)
  }

  func testTheBridgeAnswersNotCheckedBeforeConfigure() {
    var answer: [String: Any]?
    WarpLinkModule().getDeferredCheckStatus(
      { value in answer = value as? [String: Any] },
      rejecter: { _, _, _ in XCTFail("getDeferredCheckStatus must never reject") }
    )
    XCTAssertEqual(answer?["state"] as? String, "notChecked")
  }
}
