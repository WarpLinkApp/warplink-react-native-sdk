import XCTest

@testable import Bridge

/// The bridge can be asked whether a url is a WarpLink link, without resolving
/// it.
///
/// JavaScript has no domain list of its own and must not grow one: the
/// effective set is the union of `aplnk.to`, what the host declared in
/// `WarpLinkOptions.linkDomains` or the Info.plist, and what `/sdk/validate`
/// returned, and only the native SDK holds all three. Before this method the
/// TypeScript automatic path could learn a url was foreign only by resolving it
/// and reading `E_INVALID_URL` off the rejection, which arrives after it has
/// already stamped its dedupe window (warplink-0csz). This asks the native SDK
/// the same question `WarpLink.open(_:)` asks itself, at the same point.
///
/// These tests live OUTSIDE `ios/`, like the concurrency tests beside them: the
/// podspec globs `ios/**/*.{h,m,mm,swift}` into the shipped pod, so a test
/// placed there would compile into every customer's app.
///
/// Bead: warplink-0csz.
final class WarpLinkModuleIsWarpLinkUrlTests: XCTestCase {

  /// The answer for `url`, or nil if the bridge rejected instead of answering.
  private func ask(_ url: String) -> Bool? {
    let module = WarpLinkModule()
    var answer: Bool?
    var rejectedCode: String?
    module.isWarpLinkUrl(
      url,
      resolver: { value in answer = value as? Bool },
      rejecter: { code, _, _ in rejectedCode = code }
    )
    XCTAssertNil(rejectedCode, "isWarpLinkUrl must never reject")
    return answer
  }

  /// The default domain is known before `configure`, so this holds with no SDK
  /// setup at all: it is what `WarpLink.localDomains` starts with.
  func testLinkOnTheDefaultDomainAnswersTrue() {
    XCTAssertEqual(ask("https://aplnk.to/abc123"), true)
  }

  func testForeignCustomSchemeAnswersFalse() {
    XCTAssertEqual(ask("myapp://oauth/callback"), false)
  }

  func testUnknownHostAnswersFalse() {
    XCTAssertEqual(ask("https://example.com/abc123"), false)
  }

  func testMultiSegmentPathOnAKnownHostAnswersFalse() {
    XCTAssertEqual(ask("https://aplnk.to/blog/hello"), false)
  }

  /// A yes/no question about a url the caller did not choose. A string `URL`
  /// cannot parse is simply not a WarpLink link, so it answers false rather
  /// than rejecting: a rejection here would force the TypeScript layer to treat
  /// "cannot tell" and "not ours" as the same thing.
  func testStringThatIsNotAURLAnswersFalseInsteadOfRejecting() {
    XCTAssertEqual(ask(""), false)
  }

  /// Answering must not consume anything. The cold-start url is read once and
  /// cleared (`getInitialURL` takes it), so a classification with a side effect
  /// would be worse than the resolve it replaces.
  func testAskingDoesNotConsumeTheColdStartURL() {
    let module = WarpLinkModule()
    WarpLinkModule.handleIncomingURL(URL(string: "https://aplnk.to/cold")!)

    XCTAssertEqual(ask("https://aplnk.to/cold"), true)

    var initial: String?
    module.getInitialURL({ value in initial = value as? String }, rejecter: { _, _, _ in })
    XCTAssertEqual(initial, "https://aplnk.to/cold")
  }
}
