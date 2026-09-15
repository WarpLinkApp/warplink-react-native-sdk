#!/usr/bin/env bash
# Compile the REAL iOS bridge source against the REAL WarpLink SDK.
#
# Why this exists: nothing else compiles ios/WarpLinkModule.swift. The package's
# CI runs tsc, eslint, jest and tsup, none of which read Swift, so a bridge that
# referenced a property the core SDK does not define shipped clean through every
# check. This catches exactly that: the bridge's use of the WarpLink API.
#
# React itself is stubbed. The stub only has to satisfy the compiler for the few
# symbols the bridge subclasses and calls, and React drift is caught by a real
# app build anyway. The WarpLink API is what actually drifts, and that half is
# the real package, resolved from source.
#
# It also RUNS the bridge's own tests. Compiling proves the bridge still fits
# the SDK; the tests prove it still behaves when two threads touch it at once,
# which is the half a compile can never see. The Android bridge check was grown
# the same way for the same reason.
#
# NOT under ThreadSanitizer, and that is measured rather than assumed. On this
# toolchain (Swift 6.2.3, Xcode 26.2) `swift test --sanitize=thread` kills the
# XCTest runner with signal 11 on source that passes cleanly without it, so the
# sanitizer reports its own crash and nothing else. It is not needed here: the
# unsynchronised bridge crashed the runner without any sanitizer, because a torn
# read of an Optional<String> is an ARC over-release, and that is the red result
# warplink-nmyq was fixed against.
set -euo pipefail

SDK_PATH="${WARPLINK_IOS_SDK_PATH:-$(cd "$(dirname "$0")/../../warplink-ios-sdk" && pwd)}"
RN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE="$RN_ROOT/ios/WarpLinkModule.swift"
BRIDGE_TESTS="$RN_ROOT/ios-tests"

if [ ! -d "$SDK_PATH" ]; then
  echo "iOS SDK not found at $SDK_PATH. Set WARPLINK_IOS_SDK_PATH." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/Sources/React" "$WORK/Sources/Bridge" "$WORK/Tests/BridgeTests"

cat > "$WORK/Package.swift" <<EOF
// swift-tools-version:5.9
import PackageDescription
let package = Package(
    name: "BridgeCompileCheck",
    platforms: [.iOS(.v15), .macOS(.v13)],
    dependencies: [.package(path: "$SDK_PATH")],
    targets: [
        .target(name: "React"),
        .target(name: "Bridge", dependencies: ["React", .product(name: "WarpLink", package: "warplink-ios-sdk")]),
        .testTarget(name: "BridgeTests", dependencies: ["Bridge"]),
    ]
)
EOF

# Minimal stand-ins for the only React symbols the bridge touches.
cat > "$WORK/Sources/React/React.swift" <<'EOF'
import Foundation

public typealias RCTPromiseResolveBlock = (Any?) -> Void
public typealias RCTPromiseRejectBlock = (String?, String?, Error?) -> Void

open class RCTEventEmitter: NSObject {
    open class func requiresMainQueueSetup() -> Bool { false }
    open func supportedEvents() -> [String] { [] }
    open func startObserving() {}
    open func stopObserving() {}
    open func sendEvent(withName name: String, body: Any?) {}
}
EOF

cp "$BRIDGE" "$WORK/Sources/Bridge/WarpLinkModule.swift"
if [ -d "$BRIDGE_TESTS" ]; then
  cp "$BRIDGE_TESTS"/*.swift "$WORK/Tests/BridgeTests/"
fi

cd "$WORK"
swift build --target Bridge 2>&1
echo "iOS bridge compiles against the real WarpLink SDK."

if [ -n "$(ls -A "$WORK/Tests/BridgeTests" 2>/dev/null)" ]; then
  echo "Running the iOS bridge tests."
  swift test 2>&1
  echo "iOS bridge tests pass."
fi
