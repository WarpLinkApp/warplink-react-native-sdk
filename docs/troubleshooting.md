# Troubleshooting

Common issues and solutions when integrating the WarpLink React Native SDK.

## 1. Native Module Not Linked

**Symptoms:** Error message `"The package '@warplink/react-native' doesn't seem to be linked"` or `"WarpLinkModule is not available"`.

**Possible Causes and Solutions:**

### Using Expo Go

The SDK requires native modules and does **not** work with Expo Go. Use a development build:

```bash
npx expo prebuild
npx expo run:ios  # or npx expo run:android
```

### Auto-linking failed

React Native CLI auto-linking should handle this automatically. If it fails:

1. Clean and rebuild:
   ```bash
   cd ios && pod install && cd ..
   npx react-native start --reset-cache
   ```

2. For older React Native versions (< 0.71), you may need manual linking. See the [React Native docs on manual linking](https://reactnative.dev/docs/linking-libraries-ios).

### Rebuild required

After installing the SDK, you must rebuild the native app. A JavaScript-only reload (Fast Refresh) is not enough:

```bash
npx react-native run-ios   # or run-android
```

---

## 2. `pod install` Failures (iOS)

**Symptoms:** `pod install` fails with dependency resolution errors, architecture mismatches, or missing specs.

### Clean pod cache

```bash
cd ios
pod cache clean --all
pod deintegrate
pod install
```

### Apple Silicon (M1/M2/M3) issues

If you see architecture-related errors on Apple Silicon Macs:

```bash
cd ios
arch -x86_64 pod install
```

Or add to your `ios/Podfile`:

```ruby
post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['EXCLUDED_ARCHS[sdk=iphonesimulator*]'] = 'arm64'
    end
  end
end
```

### Monorepo projects

If your `ios/` directory is nested in a monorepo, specify the path:

```bash
pod install --project-directory=packages/mobile/ios
```

---

## 3. Universal Links Not Working (iOS)

**Symptoms:** Tapping a WarpLink URL opens Safari instead of your app.

### Check Associated Domains entitlement

Verify `applinks:aplnk.to` is added in your Xcode target under **Signing & Capabilities > Associated Domains**.

### AASA not configured

Your iOS app must be registered in the WarpLink dashboard (**Settings > Apps**) with the correct bundle ID and team ID. Verify the AASA file:

```bash
curl -s https://aplnk.to/.well-known/apple-app-site-association | python3 -m json.tool
```

Look for your bundle ID and team ID in the `applinks.details` array.

### Testing on iOS Simulator

**Universal Links do not work on the iOS Simulator.** You must test on a physical iOS device.

### Apple Developer portal

Verify that the **Associated Domains** capability is enabled for your App ID in the [Apple Developer portal](https://developer.apple.com). Regenerate your provisioning profile if needed.

### Domain mismatch

The SDK only recognizes `aplnk.to` as a WarpLink domain. URLs with other hosts will return `E_INVALID_URL`.

---

## 4. App Links Not Verified (Android)

**Symptoms:** Tapping a WarpLink URL shows a disambiguation dialog instead of opening your app directly.

### Check assetlinks.json

Verify the Digital Asset Links file is served correctly:

```bash
curl -s https://aplnk.to/.well-known/assetlinks.json | python3 -m json.tool
```

Look for your package name and SHA256 fingerprint.

### SHA256 fingerprint mismatch

Get your actual signing certificate fingerprint:

```bash
# Debug keystore
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android

# Release keystore
keytool -list -v -keystore your-release-key.keystore -alias your-alias
```

Compare the **SHA256** fingerprint with what's registered in the WarpLink dashboard. They must match exactly.

### Missing autoVerify

Ensure `android:autoVerify="true"` is set on the intent filter in `AndroidManifest.xml`:

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    ...
</intent-filter>
```

### Clear App Links verification cache

After updating the assetlinks.json or SHA256 fingerprint, clear the verification cache on the test device:

```bash
adb shell pm set-app-links --package com.yourcompany.yourapp 0 all
adb shell pm verify-app-links --re-verify com.yourcompany.yourapp
```

---

## 5. Deep Link Not Resolving

**Symptoms:** `handleDeepLink()` or `getInitialDeepLink()` returns `null` or throws an error.

### SDK not configured

Ensure `WarpLink.configure()` is called before any other SDK methods. Check for `E_NOT_CONFIGURED` errors.

### Network issues

The SDK makes a network request to resolve the link. Check device connectivity. Enable debug logging to see the error:

```tsx
WarpLink.configure({
  apiKey: 'wl_live_...',
  debugLogging: true,
});
```

### Invalid URL format

`handleDeepLink()` expects a full URL string (e.g., `https://aplnk.to/abc123`). Passing a malformed string will throw `E_INVALID_URL`.

### Link not found

The link may have been deleted or deactivated. Verify it exists in the WarpLink dashboard.

---

## 6. Deferred Deep Link Returns `null`

**Symptoms:** `checkDeferredDeepLink()` returns `null` when you expect a match.

### Match window expired

The default match window is 72 hours. If the user installs the app after the window expires, no match will be found. Adjust the window if needed:

```tsx
WarpLink.configure({
  apiKey: 'wl_live_...',
  matchWindowHours: 168, // 7 days
});
```

### Fingerprint mismatch

The user's network conditions may have changed between clicking the link and installing the app (VPN, different Wi-Fi network, carrier-grade NAT). This reduces fingerprint accuracy.

### Not first launch

The deferred deep link check only runs on first launch. If the first-launch flag was already consumed (previous install, persisted UserDefaults on iOS), the check returns `null`.

To test deferred deep links:
1. Delete the app from the device
2. Click a WarpLink URL in the browser
3. Install the app (via Xcode, Android Studio, or build tools)
4. Launch the app — `checkDeferredDeepLink()` should return the match

### SharedPreferences / UserDefaults cleared

On Android, SharedPreferences are tied to the app install. On iOS, UserDefaults may persist across reinstalls depending on iCloud backup settings.

---

## 7. TypeScript Type Errors

**Symptoms:** TypeScript compilation errors related to SDK types.

### Version compatibility

Ensure compatible versions of `@types/react` and `react`:

```json
{
  "peerDependencies": {
    "react": ">=18.0.0",
    "react-native": ">=0.71.0"
  }
}
```

### Import paths

Import from the main package entry point:

```tsx
// Correct
import { WarpLink, WarpLinkError, ErrorCodes } from '@warplink/react-native';

// Wrong — don't import from internal paths
import { WarpLink } from '@warplink/react-native/src/WarpLink';
```

### Type inference

`customParams` is typed as `Record<string, unknown>`. Use type assertions when accessing values:

```tsx
const productId = link.customParams['product_id'] as string | undefined;
```

---

## 8. Debug Logging Setup

**Symptoms:** You need to trace SDK behavior but don't see log output.

### Enable debug logging

```tsx
WarpLink.configure({
  apiKey: 'wl_live_abcdefghijklmnopqrstuvwxyz012345',
  debugLogging: true,
});
```

### iOS — Xcode Console

Look for `[WarpLink]` prefixed messages in the Xcode console. Key messages:
- `"Configured with API key: wl_live_****xxxx"` — SDK initialized
- `"First launch — collecting device signals for attribution"` — attribution check started
- `"Deferred deep link matched: <linkId>"` — match found
- `"No deferred deep link match"` — no match found

### Android — Logcat

Filter WarpLink logs in Android Studio or via `adb`:

```bash
adb logcat -s WarpLink
```

### React Native — Metro Console

Native debug log messages from both platforms are bridged to the React Native console. You'll see them in the Metro terminal output or in React Native Debugger.

---

## 9. React Native New Architecture (Fabric / TurboModules)

**Symptoms:** Concerns about compatibility with the New Architecture.

The SDK uses the **old architecture** bridge (`NativeModules`). However, React Native provides an interop layer that makes old-architecture native modules work with the New Architecture.

**Current status:**
- The SDK works with both old and new architecture via the interop layer
- Native TurboModules support is planned for a future release
- No action needed from developers — the interop layer handles it automatically

If you encounter issues specific to the New Architecture, enable debug logging and file an issue on [GitHub](https://github.com/WarpLinkApp/warplink-react-native-sdk/issues).

---

## 10. Expo-Specific Issues

### Config plugins

For Expo managed workflow projects, ensure you've run `npx expo prebuild` after installing the SDK. This generates the native iOS and Android projects with the correct native module linking.

### EAS Build

When using EAS Build, the SDK's native modules are included automatically. Ensure your `eas.json` build profile includes the correct native dependencies.

### Development builds

Always use a development build for testing. The SDK will not work with Expo Go:

```bash
npx expo prebuild
npx expo run:ios   # or run:android
```

## Related Guides

- [Integration Guide](integration-guide.md) — step-by-step setup
- [Error Handling](error-handling.md) — handling SDK errors programmatically
- [Deferred Deep Links](deferred-deep-links.md) — understanding deferred attribution
