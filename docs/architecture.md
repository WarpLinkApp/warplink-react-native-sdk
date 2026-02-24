# Architecture Overview

How the WarpLink React Native SDK works end-to-end. This guide covers the native bridge architecture, request flows, event handling, and caching behavior.

## Native Bridge Architecture

The React Native SDK is a TypeScript bridge layer that delegates to the native iOS and Android WarpLink SDKs:

```
TypeScript API (WarpLink.ts)
    → React Native NativeModules bridge (NativeWarpLink.ts)
    → Native module
        → iOS: WarpLinkModule.swift → WarpLinkSDK (Swift)
        → Android: WarpLinkModule.kt → app.warplink.sdk (Kotlin)
```

### Layer Responsibilities

| Layer | File | Responsibility |
|-------|------|----------------|
| Public API | `src/WarpLink.ts` | TypeScript API, input validation, error mapping, event dispatch |
| Types | `src/types.ts` | All TypeScript interfaces, error class, error codes |
| Native bridge | `src/NativeWarpLink.ts` | NativeModules interface, linking error detection |
| iOS native | `ios/WarpLinkModule.swift` | Bridges to WarpLinkSDK, handles UIApplicationDelegate events |
| Android native | `android/.../WarpLinkModule.kt` | Bridges to app.warplink.sdk, handles Activity intents |

### Key Design Decisions

- **`configure()` is synchronous.** It validates the API key format locally (throwing `WarpLinkError` for invalid format) and delegates to the native SDK via a fire-and-forget async call. This avoids forcing developers to `await` configuration.
- **All other methods return Promises.** `handleDeepLink()`, `checkDeferredDeepLink()`, `getAttributionResult()`, `isConfigured()`, and `getInitialDeepLink()` bridge to native async operations.
- **Error mapping in TypeScript.** Native errors are caught and mapped to `WarpLinkError` instances with typed error codes via `mapNativeError()`. This provides a consistent error interface across platforms.
- **Deserialization in TypeScript.** Raw objects from the native bridge are deserialized into typed `WarpLinkDeepLink` and `AttributionResult` objects via `deserializeDeepLink()` and `deserializeAttributionResult()`.

## Link Creation

Developers create links via the [WarpLink dashboard](https://warplink.app) or the [REST API](https://api.warplink.app/v1). Each link has:

- A **short URL** (e.g., `https://aplnk.to/abc123`)
- A **destination URL** — where the user should end up
- Optional **platform-specific deep link URLs** (e.g., `myapp://product/123`)
- Optional **custom parameters** — arbitrary key-value data attached to the link

When a link is created, it's stored in the database and cached at the edge for sub-10ms resolution globally.

## Click Flow

When a user clicks a WarpLink URL:

```
User taps link
    → Edge server resolves the link (sub-10ms)
    → Parses User-Agent
    → Bot? → Returns HTML with OG/Twitter Card tags (social previews)
    → Real user on iOS with app installed?
        → 302 redirect → iOS Universal Link opens your app
    → Real user on Android with app installed?
        → 302 redirect → Android App Link opens your app
    → App not installed?
        → Captures browser signals (JS interstitial)
        → Redirects to App Store / Play Store (or fallback URL)
    → Other platform?
        → 302 redirect to destination URL
```

## Deep Link Event Flow

When the native OS delivers a deep link to the app:

### Cold Start (App Not Running)

```
User taps WarpLink URL → OS launches app
    → iOS: application(_:continue:) stores URL in WarpLinkModule
    → Android: WarpLinkModule constructor captures intent data
    → React Native JavaScript initializes
    → App calls WarpLink.getInitialDeepLink()
    → TypeScript calls NativeWarpLink.getInitialURL()
    → Native module returns the stored URL
    → TypeScript calls handleDeepLink(url)
    → Native SDK resolves the link via API
    → TypeScript deserializes result → WarpLinkDeepLink
    → App navigates to content
```

### Warm Start (App in Background)

```
User taps WarpLink URL → OS brings app to foreground
    → iOS: application(_:continue:) fires
    → Android: onNewIntent() fires
    → Native module emits 'onWarpLinkDeepLink' event with URL
    → NativeEventEmitter delivers event to TypeScript
    → WarpLink.ts handleNativeDeepLinkEvent(event)
    → resolveAndDispatch(url) calls NativeWarpLink.handleDeepLink(url)
    → Native SDK resolves the link via API
    → TypeScript deserializes result → WarpLinkDeepLink
    → Dispatches to all registered listeners
    → App navigates to content
```

### Event Listener Management

```
App calls WarpLink.onDeepLink(listener)
    → Creates NativeEventEmitter (if not already created)
    → Subscribes to 'onWarpLinkDeepLink' native event (if first listener)
    → Adds listener to Set<DeepLinkListener>
    → Returns unsubscribe function

App calls unsubscribe()
    → Removes listener from Set
    → If no listeners remain → removes native event subscription
```

## Deferred Deep Link Flow

When a user clicks a link before the app is installed:

```
User taps link (app not installed)
    → Edge captures browser signals (IP, UA, language, screen, timezone)
    → Stores signals as a deferred payload (keyed by fingerprint)
    → Redirects user to App Store / Play Store

User installs and opens the app
    → App calls WarpLink.checkDeferredDeepLink()
    → TypeScript calls NativeWarpLink.checkDeferredDeepLink()
    → Native SDK detects first launch (UserDefaults / SharedPreferences)
    → Native SDK collects device signals
        → iOS: screen size, timezone, language, IDFV
        → Android: screen size, timezone, language, Play Install Referrer
    → Native SDK calls POST /attribution/match with device signals
    → Server compares device signals against stored click signals
        → IDFV match? → deterministic (confidence 1.0)
        → Play Install Referrer match? → deterministic (confidence 1.0)
        → Fingerprint match? → probabilistic (confidence 0.40–0.85)
    → Native SDK caches result
    → TypeScript deserializes result → WarpLinkDeepLink (isDeferred: true)
    → App navigates to content
```

## Caching Behavior

### First Launch Detection

The native SDK tracks whether the app has been launched before:

- **iOS:** `UserDefaults.standard.bool(forKey: "warplink_first_launch_done")`
- **Android:** `SharedPreferences.getBoolean("warplink_first_launch_done", false)`

On the very first launch, `checkDeferredDeepLink()` performs the attribution request. On all subsequent launches, it returns `null` (cached result, no network request).

### Deferred Deep Link Result

After the first attribution check, the result (match or no match) is cached by the native SDK:

- The attribution API is called at most once per app install
- Subsequent calls to `checkDeferredDeepLink()` return instantly from cache
- No unnecessary network requests on subsequent app launches

### API Key Validation

The native SDK caches a successful API key validation for 24 hours:

- First `configure()` call triggers async server validation via `/sdk/validate`
- Successful validation stored in UserDefaults / SharedPreferences with timestamp
- Subsequent launches skip validation if < 24 hours since last success

## Thread Safety

- **Native modules** dispatch results to the main thread before bridging to JavaScript
- **JavaScript callbacks** are delivered on the React Native bridge thread
- **NativeEventEmitter** events are delivered on the React Native event loop
- **`configure()`** can be called from any thread but should be called once during initialization
- **Multiple listeners** are safe — the `Set<DeepLinkListener>` and event subscription are managed in module-level state

## Zero Dependencies Philosophy

The SDK has **no third-party runtime dependencies**:

- **TypeScript layer:** Only imports from `react-native` (peer dependency)
- **iOS native:** Built on Apple frameworks (Foundation, UIKit)
- **Android native:** Built on Android SDK + Kotlin stdlib
- **Peer dependencies:** `react >= 18.0.0` and `react-native >= 0.71.0`

This minimizes bundle size, avoids supply chain risks, and eliminates version conflicts.

## Related Guides

- [API Reference](api-reference.md) — all public types and methods
- [Deferred Deep Links](deferred-deep-links.md) — detailed deferred deep link flow
- [Attribution](attribution.md) — matching tiers and confidence scores
- [Integration Guide](integration-guide.md) — step-by-step setup
