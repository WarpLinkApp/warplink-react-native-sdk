import Foundation
import React
@_spi(ReactNative) import WarpLink

@objc(WarpLinkModule)
public class WarpLinkModule: RCTEventEmitter {

  /// Guards every piece of shared state below.
  ///
  /// The three are written on one thread and read on another, and nothing used
  /// to stand between them. `handleIncomingURL` runs on the main thread, because
  /// a `UIApplicationDelegate` callback is main-thread only and that is the
  /// documented host hook. Every `RCT_EXTERN_METHOD`, `getInitialURL` included,
  /// runs on React Native's module method queue, and `startObserving` and
  /// `stopObserving` are driven from `RCTEventEmitter`'s own exported
  /// `addListener` and `removeListeners`, so they run there too.
  ///
  /// `NSLock` rather than a queue, to match the core SDK, which guards its own
  /// statics with one `NSLock` and the same lock/defer-unlock shape.
  ///
  /// The rule the call sites keep: decide under the lock, act outside it.
  /// `sendEvent` re-enters React Native and must never hold this.
  ///
  /// Bead: warplink-nmyq.
  private static let lock = NSLock()
  private static var pendingURL: String?
  private static var sharedInstance: WarpLinkModule?
  private var hasListeners = false

  override init() {
    super.init()
    WarpLinkModule.lock.lock()
    defer { WarpLinkModule.lock.unlock() }
    WarpLinkModule.sharedInstance = self
  }

  @objc override public static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override public func supportedEvents() -> [String] {
    return ["onWarpLinkDeepLink"]
  }

  override public func startObserving() {
    WarpLinkModule.lock.lock()
    defer { WarpLinkModule.lock.unlock() }
    hasListeners = true
  }

  override public func stopObserving() {
    WarpLinkModule.lock.lock()
    defer { WarpLinkModule.lock.unlock() }
    hasListeners = false
  }

  @objc public static func handleIncomingURL(_ url: URL) {
    // Decide under the lock, emit outside it. Holding the lock across
    // `sendEvent` would hold it across React Native's own dispatch, which is a
    // deadlock waiting for a host that calls back into the module.
    lock.lock()
    let listener = sharedInstance.flatMap { $0.hasListeners ? $0 : nil }
    if listener == nil {
      pendingURL = url.absoluteString
    }
    lock.unlock()

    listener?.sendEvent(
      withName: "onWarpLinkDeepLink",
      body: ["url": url.absoluteString]
    )
  }

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

  @objc func getInitialURL(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // One launch carries one link, so the read and the clear are one step.
    // As two steps they were a check-then-act, and the shipped TypeScript has
    // two callers: the automatic cold-start path and the public
    // `WarpLink.getInitialURL()`. Overlapping, both could take the same url.
    resolve(WarpLinkModule.takePendingURL())
  }

  private static func takePendingURL() -> String? {
    lock.lock()
    defer { lock.unlock() }
    let url = pendingURL
    pendingURL = nil
    return url
  }

  @objc func configure(
    _ config: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let apiKey = config["apiKey"] as? String else {
      rejectWithError(
        code: "E_INVALID_API_KEY_FORMAT",
        message: "apiKey is required",
        rejecter: reject
      )
      return
    }

    let defaults = WarpLinkOptions()
    let options = WarpLinkOptions(
      apiEndpoint: (config["apiEndpoint"] as? String) ?? defaults.apiEndpoint,
      debugLogging: (config["debugLogging"] as? Bool) ?? defaults.debugLogging,
      // The React Native layer owns all cold/warm/deferred dispatch, so the core
      // is opted out of its automatic handling to avoid a double-fire (the TS
      // orchestrator calls getInitialURL / checkDeferredDeepLink itself).
      autoDeepLinkHandling: false,
      autoDeferredCheck: false,
      // Host-declared custom link domains, passed through untouched. The core
      // normalizes them and unions them with the Info.plist list and the server
      // list, so JavaScript never has to.
      linkDomains: Self.stringArray(config["linkDomains"]) ?? defaults.linkDomains
    )

    WarpLink.configure(apiKey: apiKey, options: options)
    resolve(nil)
  }

  /**
   * Resolves through the SDK's React Native SPI entry point, not the public
   * `WarpLink.handleDeepLink`.
   *
   * JavaScript (`WarpLink.ts`) owns all dispatch and calls this one native
   * method for every tap it decides to resolve, automatic or manual, so this
   * has to supersede and cancel on every call the way the Android bridge's
   * shared `resolveDeepLink` already does. The public `handleDeepLink` never
   * does that: it is owed its own answer, because a native host calling it
   * directly is not the bridge routing many taps through one method. Using it
   * here left a superseded tap retrying on the wire for its whole budget and
   * able to bill a link JS had already moved past (warplink-3f0f).
   */
  @objc func handleDeepLink(
    _ url: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let linkURL = URL(string: url) else {
      rejectWithError(
        code: "E_INVALID_URL",
        message: "Invalid URL: \(url)",
        rejecter: reject
      )
      return
    }

    WarpLink.resolveFromReactNativeBridge(linkURL) { result in
      switch result {
      case .success(let link):
        resolve(self.serializeDeepLink(link))
      case .failure(let error):
        self.rejectWithWarpLinkError(error, rejecter: reject)
      }
    }
  }

  /**
   * Whether `url` is a WarpLink link the native SDK would claim. Resolves
   * nothing and touches no network.
   *
   * The automatic path in JavaScript asks this BEFORE it stamps its dedupe
   * window or claims a tap, which is what the native SDK does for itself:
   * `WarpLink.open(_:)` returns on `isWarpLinkURL` before
   * `shouldSuppressDuplicate`. Learning a url is foreign afterwards, from the
   * `E_INVALID_URL` that `handleDeepLink` rejects with, arrives after the
   * dedupe state has already changed, which is the defect warplink-0csz
   * reports.
   *
   * Never rejects. A string `URL` cannot parse is not a WarpLink link, and that
   * is `false`, not an error: the caller is asking a yes/no question about a
   * url it did not choose.
   */
  @objc func isWarpLinkUrl(
    _ url: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let linkURL = URL(string: url) else {
      resolve(false)
      return
    }
    resolve(WarpLink.isWarpLinkURL(linkURL))
  }

  @objc func checkDeferredDeepLink(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    WarpLink.checkDeferredDeepLink { result in
      switch result {
      case .success(let deepLink):
        if let link = deepLink {
          resolve(self.serializeDeepLink(link))
        } else {
          resolve(nil)
        }
      case .failure(let error):
        self.rejectWithWarpLinkError(error, rejecter: reject)
      }
    }
  }

  @objc func getAttributionResult(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard WarpLink.isConfigured else {
      rejectWithError(
        code: "E_NOT_CONFIGURED",
        message: "SDK not configured",
        rejecter: reject
      )
      return
    }
    if let attribution = WarpLink.attributionResult {
      resolve(serializeDeepLink(attribution))
    } else {
      resolve(nil)
    }
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

  // MARK: - Private Helpers

  private func serializeDeepLink(
    _ link: WarpLinkDeepLink
  ) -> NSDictionary {
    return [
      "linkId": link.linkId,
      "destination": link.destination,
      "deepLinkUrl": link.deepLinkUrl as Any,
      // Lower [String: JSONValue] to a Foundation object graph; the JSONValue
      // enum is not Objective-C representable and would otherwise reach JS as
      // opaque boxes (dropping customParams).
      "customParams": link.customParams.mapValues { $0.foundationValue },
      "isDeferred": link.isDeferred,
      "matchType": link.matchType?.rawValue as Any,
      "matchConfidence": link.matchConfidence as Any,
      "matchGuaranteed": link.matchGuaranteed,
    ]
  }

  // Returns nil when the key is absent or is not an array, so the caller can
  // fall back to the SDK default. TypeScript types linkDomains as string[], but
  // an untyped JavaScript caller can still send anything, and a straight
  // `as? [String]` cast drops the WHOLE declaration over one bad entry. Keeping
  // the strings matches what the Android bridge does with the same payload.
  private static func stringArray(_ value: Any?) -> [String]? {
    guard let items = value as? [Any] else { return nil }
    return items.compactMap { $0 as? String }
  }

  private func rejectWithError(
    code: String,
    message: String,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    reject(code, message, nil)
  }

  private func rejectWithWarpLinkError(
    _ error: WarpLinkError,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    reject(
      Self.errorCode(for: error),
      error.errorDescription ?? String(describing: error),
      error as NSError
    )
  }

  private static func errorCode(for error: WarpLinkError) -> String {
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
