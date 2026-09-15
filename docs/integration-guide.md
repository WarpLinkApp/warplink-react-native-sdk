# Integration Guide

Step-by-step guide to integrate the WarpLink React Native SDK into your app. You'll go from zero to working deep links in under 30 minutes.

## Prerequisites

- React Native >= 0.75.0, React >= 18.0.0, either architecture
- iOS 15+ and/or Android API 26+ (Android 8.0)
- Node.js 18+
- A physical iOS device (Universal Links do not work on the iOS Simulator)
- An Android device or emulator (App Links verification requires network access)

## Step 1: Create a WarpLink Account

Sign up at [warplink.app](https://warplink.app). The free tier includes 10,000 clicks per month.

## Step 2: Register Your App

Since React Native targets both platforms, register both iOS and Android in the WarpLink dashboard.

### iOS

1. In the WarpLink dashboard, go to **Apps**
2. Click **Register App** and select **iOS**
3. Fill in your app details:
   - **Bundle ID** (e.g., `com.yourcompany.yourapp`)
   - **Team ID** (found in Apple Developer portal under Membership)
   - **App Store URL** (or leave blank during development)
4. Save the app. WarpLink generates the Apple App Site Association (AASA) file automatically.

### Android

1. In the WarpLink dashboard, go to **Apps**
2. Click **Register App** and select **Android**
3. Fill in your app details:
   - **Package name** (e.g., `com.yourcompany.yourapp`)
   - **SHA256 fingerprint** (see [how to get your SHA256 fingerprint](#get-sha256-fingerprint) below)
   - **Play Store URL** (or leave blank during development)
4. Save the app. WarpLink generates the `assetlinks.json` file automatically.

## Step 3: Create an SDK Key

WarpLink issues two kinds of credentials. Mobile apps need an **SDK key**, which is pre-scoped for link resolution and install attribution. API keys are for backend scripts, CI, and AI agents, and they cannot record installs.

1. Go to **API Keys** in the dashboard
2. Click **SDK key**
3. Name it (for example, `React Native production`) and click **Create SDK Key**
4. Copy the key. It is shown once, so store it securely

> **Using an API key here is the most common setup mistake.** Deep links still resolve, so the integration looks healthy, but every attribution call is rejected and no installs appear in your dashboard.

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

### Enable dynamic frameworks in your Podfile

The WarpLink iOS SDK is distributed via Swift Package Manager and pulled in automatically by the React Native podspec. SPM integration requires dynamic frameworks, so add this to your `ios/Podfile` inside your app's `target` block:

```ruby
use_frameworks! :linkage => :dynamic
```

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

### iOS host hook (required)

<a id="ios-host-hook"></a>

> **This step is mandatory. iOS deep links are 100% broken without it.**

React Native does not automatically forward incoming Universal Links to native
modules. Your `AppDelegate` must hand each incoming URL to the WarpLink native
module by calling `WarpLinkModule.handleIncomingURL(url)`. The SDK buffers
cold-start URLs and emits warm-start events from there.

Add the calls in **`application(_:continue:restorationHandler:)`** (Universal
Links) and, if your app uses custom URL schemes, **`application(_:open:options:)`**.

**Read this before you copy anything below.** Your app very likely already
implements these delegate methods. Whatever they forward to, that forwarding is
what React Navigation `linking`, Expo Linking, and OAuth callbacks rely on.
The WarpLink call is **additive**: add it alongside the code you have, and return
whatever your existing linking code returns. `handleIncomingURL` returns nothing
and does no domain filtering, so it must never decide the return value of a
delegate method. Forwarding every URL is safe: the SDK tries to resolve each one
and silently drops anything that is not a WarpLink link, so custom schemes and
OAuth callbacks never reach the `onLink` you passed to `configure()`. An explicit
`onDeepLink()` subscriber can still receive them, as an `{ error }` event with
code `E_INVALID_URL`. If you also forward to `super`, store each result in a
local before combining them: a `||` chain short-circuits, so a handler placed
after one that returns `true` never runs.

The import path is the WarpLink RN pod name with hyphens replaced by underscores
(`warplink_react_native`).

**Swift `AppDelegate` (React Native 0.77+):**

```swift
import React
import warplink_react_native

// Universal Links (https:// links): cold start and warm start
func application(
  _ application: UIApplication,
  continue userActivity: NSUserActivity,
  restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
) -> Bool {
  if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
     let url = userActivity.webpageURL {
    WarpLinkModule.handleIncomingURL(url)
  }
  return RCTLinkingManager.application(
    application, continue: userActivity, restorationHandler: restorationHandler)
}

// Custom URL schemes (myapp://): only if your app uses them
func application(
  _ application: UIApplication,
  open url: URL,
  options: [UIApplication.OpenURLOptionsKey: Any] = [:]
) -> Bool {
  WarpLinkModule.handleIncomingURL(url)
  return RCTLinkingManager.application(application, open: url, options: options)
}
```

**Objective-C `AppDelegate.mm` (React Native 0.75 to 0.76):**

```objc
#import <React/RCTLinkingManager.h>
#import <warplink_react_native/warplink_react_native-Swift.h>

// Universal Links (https:// links): cold start and warm start
- (BOOL)application:(UIApplication *)application
    continueUserActivity:(NSUserActivity *)userActivity
      restorationHandler:(void (^)(NSArray<id<UIUserActivityRestoring>> *))restorationHandler
{
  if ([userActivity.activityType isEqualToString:NSUserActivityTypeBrowsingWeb] &&
      userActivity.webpageURL != nil) {
    [WarpLinkModule handleIncomingURL:userActivity.webpageURL];
  }
  return [RCTLinkingManager application:application
                  continueUserActivity:userActivity
                    restorationHandler:restorationHandler];
}

// Custom URL schemes (myapp://): only if your app uses them
- (BOOL)application:(UIApplication *)application
            openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey, id> *)options
{
  [WarpLinkModule handleIncomingURL:url];
  return [RCTLinkingManager application:application openURL:url options:options];
}
```

> **Expo:** there is no WarpLink config plugin, and `expo prebuild` regenerates a
> stock `AppDelegate` with no WarpLink call in it. Either commit the generated
> `ios/` directory and edit the `AppDelegate` there, or add the calls from an
> [Expo config plugin](https://docs.expo.dev/config-plugins/introduction/) using
> `withAppDelegate` so they survive every prebuild. Expo Go cannot load native
> modules, so a development build is required either way.

### iOS SceneDelegate hook

<a id="ios-scenedelegate-hook"></a>

> **Skip this unless your app declares a `UIApplicationSceneManifest` in
> `Info.plist` and has a `SceneDelegate` that owns the window.** That is the
> default shape of a plain Xcode single-view app template. Apple requires the
> scene life cycle for apps built with its newer SDKs: an app built without
> one does not launch at all.

Once a scene manifest exists, iOS routes Universal Link and custom-scheme
delivery to the scene, and stops calling the AppDelegate hook above
entirely. The AppDelegate methods stay in the app, but never run again.
Nothing errors, nothing crashes, and `configure()` still reports the SDK as
healthy. The app only stops resolving WarpLink links, silently, which is
why this step is easy to miss: everything looks correct until someone taps
a link.

Add the same `WarpLinkModule.handleIncomingURL(url)` call to the
`SceneDelegate` methods that receive delivery once a scene owns the window:
`scene(_:willConnectTo:options:)` for cold start, `scene(_:continue:)` for a
Universal Link on a warm start, and `scene(_:openURLContexts:)` for a
custom scheme on a warm start. Keep the AppDelegate hook too: it is
harmless once a scene exists, and an app that later turns scenes off still
needs it.

**Swift `SceneDelegate.swift` (React Native 0.77+):**

```swift
import React
import warplink_react_native

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    // ... your existing window and React Native startup ...

    // Cold start: a Universal Link arrives here, never in the AppDelegate,
    // once a scene manifest exists.
    if let userActivity = connectionOptions.userActivities.first(where: {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }), let url = userActivity.webpageURL {
      WarpLinkModule.handleIncomingURL(url)
    } else if let urlContext = connectionOptions.urlContexts.first {
      WarpLinkModule.handleIncomingURL(urlContext.url)
    }
  }

  // Warm start, Universal Link (https://): the scene counterpart of the
  // AppDelegate's continue userActivity.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
       let url = userActivity.webpageURL {
      WarpLinkModule.handleIncomingURL(url)
    }
  }

  // Warm start, custom URL schemes (myapp://): only if your app uses them.
  // The scene counterpart of the AppDelegate's open url.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    if let url = URLContexts.first?.url {
      WarpLinkModule.handleIncomingURL(url)
    }
  }
}
```

**Objective-C `SceneDelegate.h` / `SceneDelegate.m` (React Native 0.75 to 0.76):**

```objc
#import <UIKit/UIKit.h>

@interface SceneDelegate : UIResponder <UIWindowSceneDelegate>
@property (nonatomic, strong) UIWindow *window;
@end
```

```objc
#import "SceneDelegate.h"
#import <warplink_react_native/warplink_react_native-Swift.h>

@implementation SceneDelegate

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                  options:(UISceneConnectionOptions *)connectionOptions
{
  // ... your existing window and React Native startup ...

  NSUserActivity *userActivity = nil;
  for (NSUserActivity *activity in connectionOptions.userActivities) {
    if ([activity.activityType isEqualToString:NSUserActivityTypeBrowsingWeb]) {
      userActivity = activity;
      break;
    }
  }
  if (userActivity != nil && userActivity.webpageURL != nil) {
    [WarpLinkModule handleIncomingURL:userActivity.webpageURL];
  } else if (connectionOptions.URLContexts.count > 0) {
    [WarpLinkModule handleIncomingURL:connectionOptions.URLContexts.anyObject.URL];
  }
}

// Warm start, Universal Link (https://): the scene counterpart of the
// AppDelegate's continueUserActivity.
- (void)scene:(UIScene *)scene continueUserActivity:(NSUserActivity *)userActivity
{
  if ([userActivity.activityType isEqualToString:NSUserActivityTypeBrowsingWeb] &&
      userActivity.webpageURL != nil) {
    [WarpLinkModule handleIncomingURL:userActivity.webpageURL];
  }
}

// Warm start, custom URL schemes (myapp://): only if your app uses them.
// The scene counterpart of the AppDelegate's open url.
- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts
{
  NSURL *url = URLContexts.anyObject.URL;
  if (url != nil) {
    [WarpLinkModule handleIncomingURL:url];
  }
}

@end
```

Register the delegate the way any React Native scene-based app does: name
this class in `Info.plist`'s `UIApplicationSceneManifest`
(`$(PRODUCT_MODULE_NAME).SceneDelegate` in Swift, the plain class name in
Objective-C), or return it from
`application(_:configurationForConnecting:options:)` if you configure
scenes in code. Neither step is specific to WarpLink.

`handleIncomingURL` still returns nothing and does no domain filtering
here either, so forwarding every url from these methods is exactly as safe
as forwarding every url from the AppDelegate hook: the SDK resolves what it
recognizes and silently drops the rest.

> **React Native's own `Linking` API.** If you also forward to
> `RCTLinkingManager` from these scene methods
> (`RCTLinkingManager.application(_:continue:restorationHandler:)`,
> `RCTLinkingManager.application(_:open:options:)`), a warm start keeps
> `Linking.addEventListener('url', ...)` working: neither call depends on
> which delegate makes it. `Linking.getInitialURL()` on a scene-based cold
> start is a separate, unrelated gap: it reads from the `launchOptions`
> dictionary handed to your React Native startup call, which a scene-based
> cold start never receives from the OS. Reconstructing that dictionary is
> outside the WarpLink SDK and outside this guide.

## Step 6: Android Setup

### Set the Activity launch mode (required)

<a id="android-launchmode"></a>

> **Required for warm-start deep links on Android.**

Set `android:launchMode="singleTask"` on your main Activity in
`android/app/src/main/AndroidManifest.xml`. Without it, Android creates a new
Activity instance for each incoming link instead of delivering it to the running
app via `onNewIntent`, so warm-start deep links are lost.

```xml
<activity
    android:name=".MainActivity"
    android:launchMode="singleTask"
    ... >
```

The WarpLink native module registers its own `ActivityEventListener`, so no other
Android host code is required once `launchMode` is set. Cold-start links are read
from the launch intent automatically.

> **Expo:** set the launch mode via the `expo-build-properties` config plugin or
> in `app.json` under `android`.

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

## Step 7: Configure the SDK (opt-out model)

Initialize the SDK as early as possible — before any React components mount. Call `configure()` once, outside of any component, and pass an `onLink` callback. This single sink receives **cold-start, warm-start, and deferred** deep links automatically. No `useEffect`, no manual subscriptions.

```tsx
import { WarpLink } from '@warplink/react-native';

WarpLink.configure({
  apiKey: 'wl_live_yoursdkkeyhere000000000000000000',
  onLink: ({ deepLink, error }) => {
    if (deepLink) {
      // deepLink.isDeferred === true only for a first-launch install match.
      navigateTo(deepLink.deepLinkUrl ?? deepLink.destination);
    } else if (error) {
      console.error('WarpLink error:', error.code, error.message);
    }
  },
});
```

With this one call, and the native host hooks from Steps 5 and 6 in place, deep linking and attribution are fully wired. You can skip Steps 8 and 9 unless you want manual control.

`apiKey` takes the **SDK key** from Step 3. An API key is accepted by the format check and resolves deep links, but it cannot record installs, so attribution stays empty.

### Configuration Options

```tsx
WarpLink.configure({
  apiKey: 'wl_live_yoursdkkeyhere000000000000000000',
  onLink: handleLink,
  debugLogging: true,                 // Enable debug logging (default: false)
  automaticDeepLinks: true,           // Auto cold + warm start (default: true)
  automaticDeferredDeepLinks: true,   // Auto deferred check (default: true)
  linkDomains: ['links.yourapp.com'], // Your custom link domains (default: none)
});
```

See [API Reference](api-reference.md) for full `WarpLinkConfig` documentation.

### Using a custom link domain

Skip this if all your links are on `aplnk.to`.

The SDK recognizes `aplnk.to` from the start and fetches your verified custom
domains in the background. That fetch is a network round trip, and a link that
opens your app has to be identified as yours right then, with no time to wait. On
a first launch, or any launch that starts offline, the fetched list is not there
yet and a link on your custom domain is passed back to your app unresolved.

Declare the domain locally to close that gap. Any of these three work, and all
of them are merged together and with the fetched list:

```tsx
// JavaScript, at configure() time.
WarpLink.configure({
  apiKey: 'wl_live_yoursdkkeyhere000000000000000000',
  linkDomains: ['links.yourapp.com'],
  onLink: handleLink,
});
```

```xml
<!-- iOS: ios/YourApp/Info.plist -->
<key>WarpLinkDomains</key>
<array>
  <string>links.yourapp.com</string>
</array>
```

```xml
<!-- Android: android/app/src/main/AndroidManifest.xml, inside <application> -->
<meta-data
    android:name="app.warplink.DOMAINS"
    android:value="links.yourapp.com,go.yourapp.com" />
```

Values are trimmed, lowercased, and reduced to their host natively, so
`https://Links.YourApp.com/` and `links.yourapp.com` are the same domain.
`www.yourapp.com` is a different host and is never rewritten.

This tells the SDK which links are yours. It does not make iOS or Android open
your app: the custom domain must also be verified and live in the dashboard,
added to your Associated Domains entitlement (`applinks:links.yourapp.com`) in
Step 5, and added to your intent filter in Step 6.

> **Note:** `configure()` returns a `Promise<void>` and does not throw on a
> malformed SDK key. The key **format** is validated synchronously, and a bad
> key is logged and reported to `onLink` as an `{ error }` event with code
> `E_INVALID_API_KEY_FORMAT`, leaving the SDK unconfigured. iOS and Android
> behave the same way. Native/server configuration happens asynchronously; the
> returned promise resolves once configuration (and any automatic cold-start +
> deferred dispatch) completes.
>
> When `onLink` is provided, a native configuration failure is delivered to
> `onLink` as an `{ error }` event rather than rejecting the promise. When
> `onLink` is omitted, the promise rejects with a `WarpLinkError` instead — so
> `await configure(...)` (or a `.catch`) is recommended in the manual model.

> **`matchWindowHours` is server-side only.** The effective match window is
> controlled per link in the dashboard (`match_window_hours`). The option is still
> accepted for backward compatibility but has no client-side effect.

## Step 8: Handle Deep Links Manually (opt-out)

**You only need this section if you set `automaticDeepLinks: false`** (or omitted
`onLink`). Otherwise cold-start and warm-start deep links already flow into your
`onLink` callback from Step 7.

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

The opt-out model composes cleanly with React Navigation — route from a single
`onLink`:

```tsx
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { WarpLink } from '@warplink/react-native';

const navigationRef = useNavigationContainerRef();

// At startup, outside the component tree:
WarpLink.configure({
  apiKey: 'wl_live_yoursdkkeyhere000000000000000000',
  onLink: ({ deepLink }) => {
    if (!deepLink) return;
    const url = deepLink.deepLinkUrl ?? deepLink.destination;
    navigationRef.navigate('Product', { url });
  },
});

function App() {
  return (
    <NavigationContainer ref={navigationRef}>
      {/* Your navigator */}
    </NavigationContainer>
  );
}
```

## Step 9: Deferred Deep Links (automatic)

Deferred deep links work when a user clicks a WarpLink URL, installs your app, and opens it for the first time. The SDK matches the install back to the original click and delivers it through `onLink` with `isDeferred: true` — **automatically**, as part of Step 7.

If you set `automaticDeferredDeepLinks: false`, or you omitted `onLink` and so have nowhere for the match to arrive, call `checkDeferredDeepLink()` yourself once on app startup. Omitting `onLink` does not stop the check: the install is attributed either way, and the manual call reads the result.

```tsx
useEffect(() => {
  WarpLink.checkDeferredDeepLink().then((link) => {
    if (link?.isDeferred) {
      navigateTo(link.deepLinkUrl ?? link.destination);
    }
  });
}, []);
```

The SDK detects first launch, performs the attribution request once, and caches whatever came back. Later calls return that cached result with no network request: the same match if one was found, `null` if there was none. So calling `checkDeferredDeepLink()` again on a later launch is cheap, and it still hands you the original match.

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
  -H "Authorization: Bearer wl_live_YOUR_API_KEY" \
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

1. Uninstall the app. That is enough on both platforms: the deferred check is
   scoped to one install, so a reinstall runs it again. The matched link comes
   back on a device that had been attributed before, tagged as a reinstall on
   the attribution request. A device last attributed under 1.0.x is reported
   as a first install, because 1.0.x wrote no marker to inherit. On Android, a
   Play referrer from an install that began more than seven days earlier is
   attributed but not delivered as a deferred link.
   Erasing the simulator also works if you want a device with no history at all.
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
