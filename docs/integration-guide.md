# Integration Guide

Step-by-step guide to integrate the WarpLink React Native SDK into your app. You'll go from zero to working deep links in under 30 minutes.

## Prerequisites

- React Native >= 0.71.0, React >= 18.0.0
- iOS 15+ and/or Android API 26+ (Android 8.0)
- Node.js 18+
- A physical iOS device (Universal Links do not work on the iOS Simulator)
- An Android device or emulator (App Links verification requires network access)

## Step 1: Create a WarpLink Account

Sign up at [warplink.app](https://warplink.app). The free tier includes 10,000 clicks per month.

## Step 2: Register Your App

Since React Native targets both platforms, register both iOS and Android in the WarpLink dashboard.

### iOS

1. In the WarpLink dashboard, go to **Settings > Apps**
2. Click **Add App** and select **iOS**
3. Fill in your app details:
   - **Bundle ID** (e.g., `com.yourcompany.yourapp`)
   - **Team ID** (found in Apple Developer portal under Membership)
   - **App Store URL** (or leave blank during development)
4. Save the app. WarpLink generates the Apple App Site Association (AASA) file automatically.

### Android

1. In the WarpLink dashboard, go to **Settings > Apps**
2. Click **Add App** and select **Android**
3. Fill in your app details:
   - **Package name** (e.g., `com.yourcompany.yourapp`)
   - **SHA256 fingerprint** (see [how to get your SHA256 fingerprint](#get-sha256-fingerprint) below)
   - **Play Store URL** (or leave blank during development)
4. Save the app. WarpLink generates the `assetlinks.json` file automatically.

## Step 3: Create an API Key

1. Go to **Settings > API Keys** in the dashboard
2. Click **Create API Key**
3. Copy your key (format: `wl_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
4. Store it securely — you'll use this to configure the SDK

> **Tip:** Use `wl_test_` prefixed keys for development and `wl_live_` keys for production.

## Step 4: Install the SDK

### Bare React Native

```bash
npm install @warplink/react-native
```

### Expo Managed Workflow

```bash
npx expo install @warplink/react-native
```

> **Note:** This SDK requires native modules and does **not** work with Expo Go. You must use a development build via `npx expo prebuild` or EAS Build.

## Step 5: iOS Setup

### Install CocoaPods

```bash
cd ios && pod install
```

> **Monorepo users:** If your `ios/` directory is nested, use `pod install --project-directory=path/to/ios`.

### Add Associated Domains Entitlement

1. Open your project in Xcode
2. Select your app target
3. Go to **Signing & Capabilities**
4. Click **+ Capability** and add **Associated Domains**
5. Add the domain: `applinks:aplnk.to`

### Apple Developer Portal

1. Go to [developer.apple.com](https://developer.apple.com) > **Certificates, Identifiers & Profiles**
2. Select your App ID
3. Enable **Associated Domains** capability
4. Regenerate your provisioning profile if needed

### Expo

For Expo projects, add the Associated Domains entitlement in `app.json`:

```json
{
  "expo": {
    "ios": {
      "associatedDomains": ["applinks:aplnk.to"]
    }
  }
}
```

Then run `npx expo prebuild` to regenerate the native project.

## Step 6: Android Setup

### Add App Links Intent Filter

Add the following intent filter to your main Activity in `android/app/src/main/AndroidManifest.xml`:

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data
        android:scheme="https"
        android:host="aplnk.to" />
</intent-filter>
```

### Get SHA256 Fingerprint

Get your signing certificate's SHA256 fingerprint:

```bash
# Debug keystore
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android

# Release keystore
keytool -list -v -keystore your-release-key.keystore -alias your-alias
```

Copy the **SHA256** fingerprint and add it to your app registration in the WarpLink dashboard.

### Expo

For Expo projects, add the intent filter in `app.json`:

```json
{
  "expo": {
    "android": {
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            {
              "scheme": "https",
              "host": "aplnk.to"
            }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

Then run `npx expo prebuild` to regenerate the native project.

## Step 7: Configure the SDK

Initialize the SDK as early as possible — before any React components mount. Call `configure()` outside of any component:

```tsx
import { WarpLink } from '@warplink/react-native';

// Call once at app startup, outside any component
WarpLink.configure({
  apiKey: 'wl_live_abcdefghijklmnopqrstuvwxyz012345',
});
```

### Configuration Options

```tsx
WarpLink.configure({
  apiKey: 'wl_live_abcdefghijklmnopqrstuvwxyz012345',
  debugLogging: true,       // Enable debug logging (default: false)
  matchWindowHours: 48,     // Attribution match window in hours (default: 72)
});
```

See [API Reference](api-reference.md) for full `WarpLinkConfig` documentation.

> **Note:** `configure()` is synchronous. It validates the API key format locally and delegates to the native SDK for async server-side validation. It throws a `WarpLinkError` with code `E_INVALID_API_KEY_FORMAT` if the key format is invalid.

## Step 8: Handle Deep Links

Deep links arrive in two scenarios:

- **Cold start** — the app was not running and is launched by a deep link
- **Warm start** — the app was in the background and is brought to the foreground by a deep link

Handle both in your root component:

```tsx
import { useEffect } from 'react';
import { WarpLink } from '@warplink/react-native';

function App() {
  useEffect(() => {
    // Warm-start deep links (app already running)
    const unsubscribe = WarpLink.onDeepLink((event) => {
      if (event.deepLink) {
        // Navigate to the deep link destination
        navigateTo(event.deepLink.destination);
      } else if (event.error) {
        console.error('Deep link error:', event.error.message);
      }
    });

    // Cold-start deep link (app launched by a link)
    WarpLink.getInitialDeepLink().then((link) => {
      if (link) {
        navigateTo(link.destination);
      }
    });

    return unsubscribe; // Clean up the listener
  }, []);

  return <>{/* Your app */}</>;
}
```

### With React Navigation

```tsx
import { useEffect, useRef } from 'react';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { WarpLink } from '@warplink/react-native';

function App() {
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    const unsubscribe = WarpLink.onDeepLink((event) => {
      if (event.deepLink) {
        const url = event.deepLink.deepLinkUrl ?? event.deepLink.destination;
        // Parse the URL and navigate
        navigationRef.navigate('Product', { url });
      }
    });

    WarpLink.getInitialDeepLink().then((link) => {
      if (link) {
        const url = link.deepLinkUrl ?? link.destination;
        navigationRef.navigate('Product', { url });
      }
    });

    return unsubscribe;
  }, [navigationRef]);

  return (
    <NavigationContainer ref={navigationRef}>
      {/* Your navigator */}
    </NavigationContainer>
  );
}
```

## Step 9: Handle Deferred Deep Links

Deferred deep links work when a user clicks a WarpLink URL, installs your app, and opens it for the first time. The SDK matches the install back to the original click.

Call `checkDeferredDeepLink()` once on app startup, in your root component's `useEffect`:

```tsx
useEffect(() => {
  WarpLink.checkDeferredDeepLink().then((link) => {
    if (link?.isDeferred) {
      // User arrived via a WarpLink — route to intended content
      const destination = link.deepLinkUrl ?? link.destination;
      navigateTo(destination);
    }
  });
}, []);
```

The SDK automatically detects first launch and caches the result. Subsequent calls return `null` without a network request.

See [Deferred Deep Links](deferred-deep-links.md) for details on confidence scores and edge cases.

## Step 10: Create a Test Link

### Via Dashboard

1. Go to **Links** in the WarpLink dashboard
2. Click **Create Link**
3. Set the destination URL (e.g., `https://yourapp.com/product/123`)
4. Optionally set an iOS deep link URL and/or Android deep link URL
5. Copy the generated short link (e.g., `https://aplnk.to/abc123`)

### Via API

```bash
curl -X POST https://api.warplink.app/v1/links \
  -H "Authorization: Bearer wl_live_abcdefghijklmnopqrstuvwxyz012345" \
  -H "Content-Type: application/json" \
  -d '{
    "destination_url": "https://yourapp.com/product/123",
    "ios_url": "myapp://product/123",
    "android_url": "myapp://product/123"
  }'
```

## Step 11: Test on Physical Devices

### iOS

> **Universal Links do not work on the iOS Simulator.** You must test on a physical device.

1. Build and run your app on a physical iOS device
2. Open the test link in Safari (or send it via Messages/Notes)
3. Tap the link — your app should open and the deep link callback should fire
4. Check the Xcode console for debug log messages if you enabled `debugLogging`

### Android

1. Build and run your app on a device or emulator
2. Open the test link in Chrome
3. Tap the link — your app should open directly (if App Links verification succeeded)
4. Check `adb logcat` for WarpLink log messages if you enabled `debugLogging`

### Testing Deferred Deep Links

1. Delete your app from the test device
2. Open the test link in the browser — you'll be redirected to the App Store / Play Store (or a fallback URL during development)
3. Install the app (via Xcode, Android Studio, or TestFlight/internal testing)
4. Launch the app — `checkDeferredDeepLink()` should return the matched deep link

## Step 12: Debugging Tips

- Enable debug logging: `WarpLink.configure({ apiKey: '...', debugLogging: true })`
- **iOS:** Check Xcode console for `[WarpLink]` prefixed messages
- **Android:** Use `adb logcat -s WarpLink` to filter WarpLink log messages
- **React Native:** Debug log messages from the native layer appear in the Metro console
- Verify AASA is served correctly: `curl https://aplnk.to/.well-known/apple-app-site-association`
- Verify assetlinks.json: `curl https://aplnk.to/.well-known/assetlinks.json`
- See [Troubleshooting](troubleshooting.md) for common issues

## Next Steps

- [API Reference](api-reference.md) — full documentation of all public types and methods
- [Error Handling](error-handling.md) — how to handle every error case
- [Attribution](attribution.md) — understanding confidence scores and match types
- [Deferred Deep Links](deferred-deep-links.md) — in-depth deferred deep link guide
