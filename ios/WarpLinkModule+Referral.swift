import Foundation
import React
@_spi(ReactNative) import WarpLink

/// The referral handoff, bridged. The native SDK owns every decision here: the
/// shape and expiry of an invitation, the retry record, the attempt limit and
/// the claim rules. This file only forwards the call and lowers the answer to
/// a map JavaScript can read.
extension WarpLinkModule {

  @objc func redeemInvitation(
    _ text: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    WarpLink.redeemInvitation(text: text) { result in
      switch result {
      case .success(let link):
        resolve(link.map { self.serializeDeepLink($0) })
      case .failure(let error):
        self.rejectWithWarpLinkError(error, rejecter: reject)
      }
    }
  }

  @objc func claimReferral(
    _ installerId: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    WarpLink.claimReferral(installerId: installerId) { result in
      switch result {
      case .success(let claim):
        resolve(Self.serializeClaim(claim))
      case .failure(let error):
        self.rejectWithWarpLinkError(error, rejecter: reject)
      }
    }
  }

  /// The additive evidence fields of a match. A value the bridge cannot name
  /// keeps its key and crosses the bridge as `NSNull`, which JavaScript reads
  /// as `null`.
  static func evidenceFields(of link: WarpLinkDeepLink) -> [String: Any] {
    return [
      "attributionId": link.attributionId as Any,
      "matchMethod": link.matchMethod?.rawValue as Any,
      "evidenceClass": link.evidenceClass?.rawValue as Any,
      "replayState": link.replayState?.rawValue as Any,
      // Lowered for the same reason as customParams: JSONValue is not
      // Objective-C representable.
      "capturedParams": link.capturedParams.mapValues { $0.foundationValue },
      "tappedAt": link.tappedAt as Any,
    ]
  }

  static func serializeClaim(_ claim: ReferralClaimResult) -> NSDictionary {
    return [
      "status": claim.status.rawValue,
      "referralId": claim.referralId as Any,
      "linkId": claim.linkId as Any,
      "linkUrl": claim.linkUrl as Any,
      "matchMethod": claim.matchMethod?.rawValue as Any,
      "isExact": claim.isExact,
      "matchConfidence": claim.matchConfidence as Any,
      "flags": claim.flags,
      "duplicateOf": claim.duplicateOf as Any,
      "updated": claim.updated,
      "replayState": claim.replayState?.rawValue as Any,
    ]
  }
}
