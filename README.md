# @warplink/react-native

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@warplink/react-native.svg)](https://www.npmjs.com/package/@warplink/react-native)
[![CI](https://github.com/WarpLinkApp/warplink-react-native-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/WarpLinkApp/warplink-react-native-sdk/actions/workflows/ci.yml)

Deep linking SDK for React Native. Handle Universal Links and App Links, resolve deferred deep links, and attribute installs with [WarpLink](https://warplink.app).

## Requirements

| Requirement | Minimum Version |
|-------------|----------------|
| React Native | >= 0.75.0 |
| React | >= 18.0.0 |
| iOS | 15+ |
| Android | API 26+ (Android 8.0) |
| Node.js | 18+ |

Both React Native architectures are supported. The New Architecture is the only
one from React Native 0.82 onward, and it is what a new app gets today. The
Android bridge is compiled against both ends of that range on every check, and
the current React Native is exercised on a device each release.

## Installation

### Bare React Native

```bash
npm install @warplink/react-native
```

The iOS SDK is distributed via Swift Package Manager and pulled in automatically by the React Native podspec. SPM integration requires dynamic frameworks, so add this to your `ios/Podfile` inside your app's `target` block:

```ruby
use_frameworks! :linkage => :dynamic
```

Then install iOS pods:

```bash
cd ios && pod install
```

Android auto-links via React Native CLI. No additional setup required.

### Expo Managed Workflow

```bash
npx expo install @warplink/react-native
```

Then generate native projects:

```bash
npx expo prebuild
```

> **Note:** This SDK requires native modules and does **not** work with Expo Go. You must use a development build (`npx expo prebuild` or EAS Build).

## Quick Start

The SDK is **opt-out**: a bare `configure({ apiKey, onLink })` wires cold-start,
warm-start, and deferred deep links automatically. All three flow into your one
`onLink` callback. No `useEffect`, no manual subscriptions.

A **background deferred check that fails**, for example on a launch with no network, also reaches `onLink` as a failure. The gate stays open, so the next launch retries by itself, and the error is a report rather than something for the host to act on.

```tsx
import { WarpLink } from '@warplink/react-native';

// Call once at app startup, outside any component.
WarpLink.configure({
  apiKey: 'wl_live_yoursdkkeyhere000000000000000000',
  onLink: ({ deepLink, error }) => {
    if (deepLink) {
      // Fires for cold start, warm start, AND deferred (first launch).
      // Disambiguate deferred installs with deepLink.isDeferred.
      navigate(deepLink.deepLinkUrl ?? deepLink.destination);
    } else if (error) {
      console.error('WarpLink error:', error.code, error.message);
    }
  },
}).catch((e) => console.error('WarpLink configure failed:', e));
```

That's the whole happy path. `onLink` receives every deep link the app sees.

An exception thrown by your `onLink` propagates out of the promise `configure()`
returns, so keep the `.catch()`. It matters most on the first launch after an
install, when `navigate()` can throw because the navigation container has not
mounted yet. Attribution still runs when that happens, but without a `.catch()`
the throw surfaces as an unhandled rejection.

### Getting your SDK key

`apiKey` takes an **SDK key**, created under **API Keys** > **SDK key** in the
dashboard. It is pre-scoped for link resolution and install attribution. API keys
are a separate credential for backend scripts, CI, and AI agents, and they cannot
record installs. Both share the `wl_live_` prefix, so pasting an API key here is
an easy mistake: deep links keep resolving, but no installs ever appear in your
dashboard. See the [Integration Guide](docs/integration-guide.md) for the full
walkthrough.

### Required native host setup

Two native hooks are **required** for deep links to reach the SDK. They are not
optional.

- **iOS:** your `AppDelegate` must forward incoming URLs to
  `WarpLinkModule.handleIncomingURL(url)`. Without this, iOS Universal Links are
  100% broken. See [iOS host hook](docs/integration-guide.md#ios-host-hook). If
  your app declares a `UIApplicationSceneManifest` and has a `SceneDelegate`
  (the default for a plain Xcode template, and required by Apple for apps
  built with its newer SDKs, which do not launch at all without one), the same
  forward is also required in `SceneDelegate`: iOS stops calling the
  `AppDelegate` hook entirely once a scene exists. See
  [iOS SceneDelegate hook](docs/integration-guide.md#ios-scenedelegate-hook).
- **Android:** your launch Activity must declare `android:launchMode="singleTask"`
  so warm-start intents reach the SDK. See
  [Android setup](docs/integration-guide.md#android-launchmode).

### Using a custom link domain

`aplnk.to` works out of the box. If your links are on your own domain, declare it
so the SDK recognizes it on the very first launch, before it has fetched your
domain list and even with no network:

```tsx
WarpLink.configure({
  apiKey: 'wl_live_yoursdkkeyhere000000000000000000',
  linkDomains: ['links.yourapp.com'],
  onLink: handleLink,
});
```

The same declaration can live in `Info.plist` (`WarpLinkDomains`) or the Android
manifest (`app.warplink.DOMAINS`) instead. All sources are merged, so declaring
in more than one place is safe. See
[Custom link domains](docs/api-reference.md#custom-link-domains).

### Disabling any piece

Each source is independently disable-able. Turn one off and wire it yourself.

```tsx
WarpLink.configure({
  apiKey: 'wl_live_yoursdkkeyhere000000000000000000',
  onLink: handleLink,
  automaticDeepLinks: false,          // you call onDeepLink()/getInitialDeepLink()
  automaticDeferredDeepLinks: false,  // you call checkDeferredDeepLink()
});
```

Omit `onLink` entirely to keep the manual model for deep links. Two things
changed from 1.0.x: `configure()` no longer throws on a malformed key (it reports
through `onLink` and a console warning instead), and `AttributionResult.installId`
was removed. Everything else in the pre-1.1 API is unchanged and still supported.
The deferred check still fires,
because that request is what attributes the install; call
`checkDeferredDeepLink()` to read the match, or pass
`automaticDeferredDeepLinks: false` to switch the check off:

```tsx
WarpLink.configure({ apiKey: 'wl_live_yoursdkkeyhere000000000000000000' });

function App() {
  useEffect(() => {
    const unsubscribe = WarpLink.onDeepLink(({ deepLink }) => {
      if (deepLink) navigate(deepLink.destination);
    });
    WarpLink.getInitialDeepLink().then((l) => l && navigate(l.destination));
    WarpLink.checkDeferredDeepLink().then((l) => l?.isDeferred && navigate(l.destination));
    return unsubscribe;
  }, []);
  return <>{/* Your app */}</>;
}
```

## Features

- **Opt-out by default:** one `configure({ apiKey, onLink })` call turns on cold-start, warm-start, and deferred deep linking. Each is independently disable-able.
- **Universal Link & App Link Handling:** resolve incoming deep links to destinations and custom parameters. See the [Integration Guide](docs/integration-guide.md).
- **Deferred Deep Links:** route users to specific content even after App Store or Play Store install. See [Deferred Deep Links](docs/deferred-deep-links.md).
- **Install Attribution:** deterministic and probabilistic matching with confidence scores. See [Attribution](docs/attribution.md).
- **Cross-Platform:** single TypeScript API for both iOS and Android with platform-specific native bridges.
- **No ATT Required:** uses IDFV on iOS (exempt from App Tracking Transparency). No IDFA, no user prompts.
- **Debug Logging:** enable with `{ debugLogging: true }` in configure options to trace SDK behavior.
- **Native SDK version:** `await WarpLink.sdkVersion()` returns the version the native SDK reports, which is what to check when a deep link behaves unexpectedly after an upgrade.
- **Attribution completion:** `await WarpLink.isAttributionComplete()` tells you whether the deferred check has definitively finished for this install.
- **Zero Dependencies:** no third-party runtime dependencies. Only peer dependencies on `react` and `react-native`.

## Documentation

| Guide | Description |
|-------|-------------|
| [Integration Guide](docs/integration-guide.md) | Step-by-step setup from zero to working deep links |
| [API Reference](docs/api-reference.md) | Complete reference for all public types and methods |
| [Deferred Deep Links](docs/deferred-deep-links.md) | How deferred deep linking works and how to use it |
| [Attribution](docs/attribution.md) | Install attribution tiers and confidence scores |
| [Error Handling](docs/error-handling.md) | Every error case with recommended recovery actions |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |
| [Firebase Migration](docs/firebase-migration.md) | Migrate from Firebase Dynamic Links to WarpLink |
| [Architecture](docs/architecture.md) | How the SDK bridges to native iOS and Android SDKs |

## Links

- [WarpLink Dashboard](https://warplink.app)
- [Changelog](CHANGELOG.md)

## License

MIT License. See [LICENSE](LICENSE) for details.
