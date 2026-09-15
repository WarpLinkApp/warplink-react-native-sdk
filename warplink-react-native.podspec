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

  # React Native dependencies.
  #
  # Ask React Native for its own, rather than naming React-Core by hand. Since
  # 0.71 that list is whatever the installed React Native ships, and 0.86
  # distributes React as a prebuilt xcframework: a podspec that names React-Core
  # itself receives no link flags and the pod fails with undefined
  # _OBJC_CLASS_$_RCTEventEmitter and _RCTRegisterModule.
  #
  # Guarded, because this SDK still supports React Native 0.75, where the helper
  # may be absent. Same shape as @react-native-async-storage/async-storage.
  #
  # Bead: warplink-5ia2.
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end

  # WarpLink iOS SDK is distributed only via Swift Package Manager. RN 0.75+
  # autolinks the package into the consumer's Xcode project via spm_dependency.
  # Consumers must enable `use_frameworks! :linkage => :dynamic` in their Podfile.
  spm_dependency(s,
    url: "https://github.com/WarpLinkApp/warplink-ios-sdk.git",
    requirement: { kind: "upToNextMajorVersion", minimumVersion: "1.1.0" },
    products: ["WarpLink"]
  )

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "SWIFT_COMPILATION_MODE" => "wholemodule"
  }
end
