import Foundation
import React
import WarpLinkSDK

@objc(WarpLinkModule)
class WarpLinkModule: RCTEventEmitter {

  private static var pendingURL: String?
  private static var sharedInstance: WarpLinkModule?
  private var hasListeners = false

  override init() {
    super.init()
    WarpLinkModule.sharedInstance = self
  }

  @objc override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String] {
    return ["onWarpLinkDeepLink"]
  }

  override func startObserving() {
    hasListeners = true
  }

  override func stopObserving() {
    hasListeners = false
  }

  @objc static func handleIncomingURL(_ url: URL) {
    if let instance = sharedInstance, instance.hasListeners {
      instance.sendEvent(
        withName: "onWarpLinkDeepLink",
        body: ["url": url.absoluteString]
      )
    } else {
      pendingURL = url.absoluteString
    }
  }

  @objc func getInitialURL(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(WarpLinkModule.pendingURL)
    WarpLinkModule.pendingURL = nil
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

    var options = WarpLinkOptions()
    if let endpoint = config["apiEndpoint"] as? String {
      options.apiEndpoint = endpoint
    }
    if let debug = config["debugLogging"] as? Bool {
      options.debugLogging = debug
    }
    if let matchWindow = config["matchWindowHours"] as? Int {
      options.matchWindowHours = matchWindow
    }

    WarpLink.configure(apiKey: apiKey, options: options)
    resolve(nil)
  }

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

    WarpLink.handleDeepLink(linkURL) { result in
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

  // MARK: - Private Helpers

  private func serializeDeepLink(
    _ link: WarpLinkDeepLink
  ) -> NSDictionary {
    return [
      "linkId": link.linkId,
      "destination": link.destination,
      "deepLinkUrl": link.deepLinkUrl as Any,
      "customParams": link.customParams,
      "isDeferred": link.isDeferred,
      "matchType": link.matchType as Any,
      "matchConfidence": link.matchConfidence as Any,
    ]
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
    reject(error.code, error.message, error)
  }
}
