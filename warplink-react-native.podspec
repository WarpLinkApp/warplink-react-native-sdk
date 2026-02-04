require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "warplink-react-native"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "15.0" }
  s.source       = { :git => "https://github.com/AeroDeploy/warplink-react-native-sdk.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.swift_version = "5.9"

  # React Native dependency
  s.dependency "React-Core"

  # WarpLink iOS SDK — local development path
  # For published releases, consumers add the iOS SDK via SPM in their Xcode project.
  # During development, reference the co-located iOS SDK repo:
  #   pod 'WarpLinkSDK', :path => '../../warplink-ios-sdk'
  # For now, the iOS SDK source files are imported directly via the consuming app's SPM config.

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "SWIFT_COMPILATION_MODE" => "wholemodule"
  }
end
