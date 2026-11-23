import Foundation
import React
@_spi(ReactNative) import WarpLink

extension WarpLinkModule {

  func serializeDeepLink(
    _ link: WarpLinkDeepLink
  ) -> NSDictionary {
    return Self.deepLinkPayload(link)
  }

  /// The same map without a module instance, for the paste button, which has
  /// no module to call.
  static func deepLinkPayload(
    _ link: WarpLinkDeepLink
  ) -> NSDictionary {
    var payload: [String: Any] = [
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
    payload.merge(Self.evidenceFields(of: link)) { current, _ in current }
    return payload as NSDictionary
  }

  // Returns nil when the key is absent or is not an array, so the caller can
  // fall back to the SDK default. TypeScript types linkDomains as string[], but
  // an untyped JavaScript caller can still send anything, and a straight
  // `as? [String]` cast drops the WHOLE declaration over one bad entry. Keeping
  // the strings matches what the Android bridge does with the same payload.
  static func stringArray(_ value: Any?) -> [String]? {
    guard let items = value as? [Any] else { return nil }
    return items.compactMap { $0 as? String }
  }
}
