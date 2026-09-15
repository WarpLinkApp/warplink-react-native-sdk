import XCTest

@testable import Bridge

/// The iOS bridge's shared state is written on one thread and read on another.
///
/// `handleIncomingURL` runs on the main thread, because a `UIApplicationDelegate`
/// callback is main-thread only and that is the documented host hook. Every
/// `RCT_EXTERN_METHOD`, including `getInitialURL`, runs on React Native's module
/// method queue. `startObserving` and `stopObserving` are driven from
/// `RCTEventEmitter`'s own exported `addListener` and `removeListeners`, so they
/// run on that queue too. Nothing synchronised the three properties they share.
///
/// These tests live OUTSIDE `ios/`, deliberately. The podspec globs
/// `ios/**/*.{h,m,mm,swift}` into the shipped pod and `package.json` ships the
/// whole `ios` directory to npm, so a test placed there would compile into every
/// customer's app.
///
/// Bead: warplink-nmyq.
final class WarpLinkModuleConcurrencyTests: XCTestCase {

  private let iterations = 2_000

  override func setUp() {
    super.setUp()
    drain()
  }

  /// The race itself. Run under ThreadSanitizer, this is the test that fails
  /// before the fix: a write to `pendingURL` on one queue against a
  /// read-and-clear on another, with no lock between them.
  ///
  /// It is a sanitizer test on purpose. Single-threaded, the read-then-clear at
  /// the heart of it is perfectly correct, so no plain assertion can be
  /// deterministically red beforehand. Claiming otherwise would be a test that
  /// passes for the wrong reason.
  func testHandleIncomingURLAndGetInitialURLDoNotRace() {
    let module = WarpLinkModule()
    let writers = DispatchQueue(label: "warplink.test.writer")
    let readers = DispatchQueue(label: "warplink.test.reader")
    let done = expectation(description: "both loops finish")
    done.expectedFulfillmentCount = 2

    writers.async {
      for i in 0..<self.iterations {
        WarpLinkModule.handleIncomingURL(URL(string: "https://aplnk.to/race-\(i)")!)
      }
      done.fulfill()
    }
    readers.async {
      for _ in 0..<self.iterations {
        module.getInitialURL({ _ in }, rejecter: { _, _, _ in })
      }
      done.fulfill()
    }

    wait(for: [done], timeout: 60)
  }

  /// A launch carries one link, so it must be delivered at most once.
  ///
  /// `getInitialURL` reads `pendingURL` and then clears it in two steps. Two
  /// overlapping calls can both read before either clears, and the shipped
  /// TypeScript has two callers: the automatic cold-start path and the public
  /// `WarpLink.getInitialURL()`. This needs no memory-visibility failure, only
  /// an interleaving, which is why it can be observed without a sanitizer.
  func testTheLaunchURLIsDeliveredAtMostOnce() {
    let queueA = DispatchQueue(label: "warplink.test.a")
    let queueB = DispatchQueue(label: "warplink.test.b")
    let counter = Counter()

    for i in 0..<iterations {
      let module = WarpLinkModule()
      WarpLinkModule.handleIncomingURL(URL(string: "https://aplnk.to/once-\(i)")!)

      let both = expectation(description: "two readers")
      both.expectedFulfillmentCount = 2
      let resolve: (Any?) -> Void = { value in
        if value != nil { counter.increment() }
        both.fulfill()
      }
      queueA.async { module.getInitialURL(resolve, rejecter: { _, _, _ in }) }
      queueB.async { module.getInitialURL(resolve, rejecter: { _, _, _ in }) }
      wait(for: [both], timeout: 10)
    }

    XCTAssertEqual(
      counter.value, iterations,
      "one seeded url per iteration must be handed out exactly once, never twice"
    )
  }

  /// Reading and writing `hasListeners` from two queues is the third property in
  /// the bead. A stale read sends the event into an emitter with no listeners,
  /// and the url is then not written to `pendingURL` either, so it is gone.
  func testListenerStateDoesNotRaceWithIncomingURLs() {
    let module = WarpLinkModule()
    let observers = DispatchQueue(label: "warplink.test.observers")
    let done = expectation(description: "both loops finish")
    done.expectedFulfillmentCount = 2

    observers.async {
      for _ in 0..<self.iterations {
        module.startObserving()
        module.stopObserving()
      }
      done.fulfill()
    }
    DispatchQueue(label: "warplink.test.urls").async {
      for i in 0..<self.iterations {
        WarpLinkModule.handleIncomingURL(URL(string: "https://aplnk.to/listen-\(i)")!)
      }
      done.fulfill()
    }

    wait(for: [done], timeout: 60)
  }

  /// Leave no url behind for the next test.
  private func drain() {
    let module = WarpLinkModule()
    module.getInitialURL({ _ in }, rejecter: { _, _, _ in })
  }
}

/// A counter that is itself synchronised, so the tests measure the module's
/// races and never their own.
private final class Counter {
  private let lock = NSLock()
  private var count = 0

  func increment() {
    lock.lock()
    defer { lock.unlock() }
    count += 1
  }

  var value: Int {
    lock.lock()
    defer { lock.unlock() }
    return count
  }
}
