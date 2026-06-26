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
  s.source       = { :git => "https://github.com/WarpLinkApp/warplink-react-native-sdk.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.swift_version = "5.9"

  # React Native dependency
  s.dependency "React-Core"

  # WarpLink iOS SDK is distributed only via Swift Package Manager. RN 0.75+
  # autolinks the package into the consumer's Xcode project via spm_dependency.
  # Consumers must enable `use_frameworks! :linkage => :dynamic` in their Podfile.
  spm_dependency(s,
    url: "https://github.com/WarpLinkApp/warplink-ios-sdk.git",
    requirement: { kind: "upToNextMajorVersion", minimumVersion: "0.1.0" },
    products: ["WarpLink"]
  )

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "SWIFT_COMPILATION_MODE" => "wholemodule"
  }
end
