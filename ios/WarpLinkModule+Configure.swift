import Foundation
import React
@_spi(ReactNative) import WarpLink

extension WarpLinkModule {

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
      linkDomains: Self.stringArray(config["linkDomains"]) ?? defaults.linkDomains,
      // The clipboard read for a Tether code runs inside the native first-open
      // check, so automatic mode only needs the mode passed through. A name the
      // core does not know reads as the default, the paste button.
      tetherReadMode: (config["tetherReadMode"] as? String)
        .flatMap(TetherReadMode.init(rawValue:)) ?? defaults.tetherReadMode
    )

    // Tether reports this as the request's sdk_platform, not "ios".
    WarpLink.declareHostWrapper("react-native")
    WarpLink.configure(apiKey: apiKey, options: options)
    resolve(nil)
  }
}
