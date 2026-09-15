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

2. For older React Native versions (< 0.75), you may need manual linking. See the [React Native docs on manual linking](https://reactnative.dev/docs/linking-libraries-ios).

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

**Symptoms:** Tapping a WarpLink URL opens Safari instead of your app, or the app
opens but `onLink` / your deep link handler never fires.

### Missing the AppDelegate host hook (most common)

If the app opens but no deep link is delivered, the `AppDelegate` is almost
certainly not forwarding the URL to WarpLink. React Native does **not** do this
automatically. Your `AppDelegate` must call `WarpLinkModule.handleIncomingURL(url)`
from `application(_:continue:restorationHandler:)` (Universal Links) and, if you
use custom schemes, `application(_:open:options:)`. See the
[iOS host hook](integration-guide.md#ios-host-hook) in the Integration Guide.
**iOS deep links are 100% broken without this.**

### App declares a UIApplicationSceneManifest (also common)

If the `AppDelegate` hook above is present and the app still never delivers a
link, check `Info.plist` for `UIApplicationSceneManifest`. Once a scene
manifest exists, iOS stops calling the `AppDelegate` hook entirely and routes
delivery to `SceneDelegate` instead: the method stays in the app, but never
runs again, and nothing errors, so this is easy to miss. Add the same
`WarpLinkModule.handleIncomingURL(url)` call to `SceneDelegate`'s
`scene(_:willConnectTo:options:)`, `scene(_:continue:)`, and
`scene(_:openURLContexts:)`. See the
[iOS SceneDelegate hook](integration-guide.md#ios-scenedelegate-hook) in the
Integration Guide.

### Check Associated Domains entitlement

Verify `applinks:aplnk.to` is added in your Xcode target under **Signing & Capabilities > Associated Domains**.

### AASA not configured

Your iOS app must be registered in the WarpLink dashboard (**Apps**) with the correct bundle ID and team ID. Verify the AASA file:

```bash
curl -s https://aplnk.to/.well-known/apple-app-site-association | python3 -m json.tool
```

Look for your bundle ID and team ID in the `applinks.details` array.

### Testing on iOS Simulator

**Universal Links do not work on the iOS Simulator.** You must test on a physical iOS device.

### Apple Developer portal

Verify that the **Associated Domains** capability is enabled for your App ID in the [Apple Developer portal](https://developer.apple.com). Regenerate your provisioning profile if needed.

### Domain mismatch

The SDK recognizes `aplnk.to` plus your org's verified custom domains, which it fetches when the SDK is configured and caches for offline launches. A URL on a host that isn't in that set returns `E_INVALID_URL`. If you're testing a custom domain, confirm it is verified and live in the dashboard, and that the custom domain is also listed in your **Associated Domains** entitlement (`applinks:go.yourbrand.com`), or iOS won't open your app for it in the first place.

If it only fails on the first launch after install, or with no network, the fetch had not completed when the link arrived. Declare the domain locally and it is recognized immediately: `linkDomains: ['go.yourbrand.com']` in `configure()`, a `WarpLinkDomains` array in `Info.plist`, or an `app.warplink.DOMAINS` manifest entry on Android. See [Custom link domains](api-reference.md#custom-link-domains).

---

## 4. App Links Not Verified (Android)

**Symptoms:** Tapping a WarpLink URL shows a disambiguation dialog instead of opening your app directly.

### Warm-start links lost (missing launchMode)

If cold-start links work but tapping a link while the app is already running does
nothing, your launch Activity is missing `android:launchMode="singleTask"`. Without
it, Android starts a new Activity instead of delivering the intent to the running
app via `onNewIntent`, so the SDK never sees the warm-start URL. See
[Android setup](integration-guide.md#android-launchmode).

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
  apiKey: 'wl_live_yoursdkkeyhere000000000000000000',
  debugLogging: true,
});
```

### Invalid URL format

`handleDeepLink()` expects a full URL string (e.g., `https://aplnk.to/abc123`). Passing a malformed string will throw `E_INVALID_URL`.

### Link not found

The link may have been deleted or deactivated. Verify it exists in the WarpLink dashboard.

---

## 6. Deferred Deep Link Returns `null`

**Symptoms:** `checkDeferredDeepLink()` returns `null` when you expect a match, or deep links resolve fine but no installs appear in your dashboard.

### Wrong key type (most common)

Install attribution requires an **SDK key**. An API key cannot record installs, whatever scopes it holds, so the attribution request is rejected and no match comes back. Deep links keep resolving normally, which is what makes this one hard to spot.

Create an SDK key at **API Keys** > **SDK key** in the dashboard and pass it to `WarpLink.configure()`. Both credentials use the `wl_live_` prefix followed by 32 alphanumeric characters, so check the key type in the dashboard rather than reading the string.

### Match window expired

The default match window is 6 hours, and the ceiling is 24 hours. If the user installs the app after the window expires, no match will be found. The match window is server-authoritative: configure it per link in the WarpLink dashboard (the `matchWindowHours` option on `configure()` is accepted for backward compatibility but has no client-side effect).

### Fingerprint mismatch

The user's network conditions may have changed between clicking the link and installing the app (VPN, different Wi-Fi network, carrier-grade NAT). This reduces fingerprint accuracy.

### Not first launch

The deferred deep link check runs once per install. If the gate was already consumed on a definitive server response, the check does not run again for that install: it returns the cached result from that completed check, which is `null` when the completed check found no match.

The gate is scoped to one install on both platforms, so deleting the app and installing it again always retests. A reinstall counts as an install and is attributed again.

To test deferred deep links:
1. Uninstall the app (iOS and Android both work; erasing the simulator also works)
2. Click a WarpLink URL in the browser
3. Install the app (via Xcode, Android Studio, or build tools)
4. Launch the app. `checkDeferredDeepLink()` should return the match

If the check still does not run after a reinstall, the device most likely restored from a backup that carried the gate. That is a bug: file it. The gate is deliberately stored where neither an uninstall nor a restore can bring it back.

### Marker storage

Each native SDK keeps two separate markers, and neither is readable from JavaScript.

The **gate** answers "has attribution already completed for this install?". On Android it lives in backup-excluded storage (`noBackupFilesDir`); on iOS it is a file marked as excluded from backup. Neither survives an uninstall, and neither is restored from an iCloud or iTunes backup, so a reinstall always runs a fresh check.

The **device-seen marker** answers "has this device ever completed attribution?". On iOS it is a Keychain entry; on Android it is a backed-up shared preference. It survives an uninstall and a restore by design, and it gates nothing. Its only job is to tag the attribution request, so a reinstall can be counted separately from a genuine first install.

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
  apiKey: 'wl_live_yoursdkkeyhere000000000000000000',
  debugLogging: true,
});
```

### iOS — Xcode Console

Look for `[WarpLink]` prefixed messages in the Xcode console. Key messages:
- `"Configured with API key: wl_live_****xxxx"`: SDK initialized
- `"First launch: collecting device signals for attribution"`: attribution check started
- `"Deferred deep link matched: <linkId>"`: match found
- `"No deferred deep link match"`: no match found

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

The SDK is written against the classic native module API (`NativeModules` and
`NativeEventEmitter`). React Native's interop layer runs those modules under the
New Architecture, so no host setup differs between the two.

**Current status:**
- The New Architecture is the only architecture from React Native 0.82 onward,
  and the SDK supports it. Cold start, warm start, deferred delivery and every
  error path are exercised on a device on the current React Native each release.
- The classic architecture, React Native 0.75 to 0.81, is still supported. The
  Android bridge is compiled against both ends of the range on every check.
- No action needed from developers. There is no flag to set and no separate
  build.

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
