import Foundation
import React
import WarpLink

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

    let defaults = WarpLinkOptions()
    let options = WarpLinkOptions(
      apiEndpoint: (config["apiEndpoint"] as? String) ?? defaults.apiEndpoint,
      debugLogging: (config["debugLogging"] as? Bool) ?? defaults.debugLogging,
      matchWindowHours: (config["matchWindowHours"] as? Int) ?? defaults.matchWindowHours
    )

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
      case .success(let link):
        resolve(self.serializeDeepLink(link))
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
      "matchType": link.matchType?.rawValue as Any,
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
    case .decodingError: return "E_DECODING_ERROR"
    }
  }
}
