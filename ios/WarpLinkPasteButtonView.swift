#if canImport(UIKit)
import UIKit
import React
@_spi(ReactNative) import WarpLink

/// Hosts the real `WarpLinkUIPasteButton`, so the system paste control is the
/// only thing that ever reads the clipboard for a Tether code. React Native
/// never sees the pasted text: the native SDK redeems it and this view sends
/// back only the outcome.
///
/// `UIPasteControl.Configuration` is init-only, so a style change rebuilds the
/// control. Props arrive one at a time, so the rebuild is coalesced to once per
/// run loop turn.
@available(iOS 16.0, *)
@objc(WarpLinkPasteButtonView)
final class WarpLinkPasteButtonView: UIView {

  @objc var onTether: RCTDirectEventBlock?
  @objc var baseBackgroundColor: UIColor? { didSet { scheduleRebuild() } }
  @objc var baseForegroundColor: UIColor? { didSet { scheduleRebuild() } }
  @objc var cornerStyle: NSString? { didSet { scheduleRebuild() } }
  @objc var displayMode: NSString? { didSet { scheduleRebuild() } }

  private var button: WarpLinkUIPasteButton?
  private var rebuildPending = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    scheduleRebuild()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("WarpLinkPasteButtonView is created in code")
  }

  private func scheduleRebuild() {
    guard !rebuildPending else { return }
    rebuildPending = true
    DispatchQueue.main.async { [weak self] in
      self?.rebuildPending = false
      self?.rebuild()
    }
  }

  private func rebuild() {
    button?.removeFromSuperview()
    let next = WarpLinkUIPasteButton(configuration: makeConfiguration())
    // Only `onTether` is set: setting `onResult` would make the control accept
    // the older invitation text as well.
    next.onTether = { [weak self] result in
      self?.onTether?(WarpLinkModule.tetherEventBody(result))
    }
    next.frame = bounds
    next.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(next)
    button = next
  }

  private func makeConfiguration() -> UIPasteControl.Configuration {
    let configuration = UIPasteControl.Configuration()
    configuration.baseBackgroundColor = baseBackgroundColor
    configuration.baseForegroundColor = baseForegroundColor
    configuration.cornerStyle = Self.cornerStyle(named: cornerStyle as String?)
    configuration.displayMode = Self.displayMode(named: displayMode as String?)
    return configuration
  }

  static func cornerStyle(named name: String?) -> UIButton.Configuration.CornerStyle {
    switch name {
    case "fixed": return .fixed
    case "small": return .small
    case "medium": return .medium
    case "large": return .large
    case "capsule": return .capsule
    default: return .dynamic
    }
  }

  static func displayMode(named name: String?) -> UIPasteControl.DisplayMode {
    switch name {
    case "iconOnly": return .iconOnly
    case "labelOnly": return .labelOnly
    default: return .iconAndLabel
    }
  }
}
#endif
