#if canImport(UIKit)
import UIKit
import React

/// The view manager behind `<WarpLinkPasteButton />`.
///
/// The class always exists, because `WarpLinkModule.m` declares it. Below iOS 16
/// there is no system paste control and the view is empty.
@objc(WarpLinkPasteButtonManager)
final class WarpLinkPasteButtonManager: RCTViewManager {

  @objc override static func requiresMainQueueSetup() -> Bool {
    return true
  }

  override func view() -> UIView! {
    if #available(iOS 16.0, *) {
      return WarpLinkPasteButtonView()
    }
    return UIView()
  }
}
#endif
