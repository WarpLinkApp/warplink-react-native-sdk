# Deferred Deep Links

Deferred deep links let you route users to specific content even when they don't have your app installed yet. The user clicks a link, installs your app from the App Store or Play Store, and on first launch the SDK matches them back to the original link.

## What Are Deferred Deep Links?

Standard Universal Links (iOS) and App Links (Android) only work when the app is already installed. Deferred deep links solve the "click before install" problem:

1. User clicks a WarpLink URL (e.g., a product share link)
2. App is not installed — user is redirected to the App Store or Play Store
3. User installs the app
4. On first launch, the SDK matches the install to the original click
5. Your app routes the user to the intended content (e.g., the shared product)

Without deferred deep links, the user would land on your default home screen with no context about what brought them there.

## How It Works

The deferred deep link flow involves 8 steps:

1. **Click** — User taps a WarpLink URL in a browser or another app
2. **Signal capture** — WarpLink's edge server captures browser signals (IP, User-Agent, Accept-Language, screen size, timezone) via a brief JavaScript interstitial
3. **Store redirect** — User is redirected to the App Store (iOS) or Play Store (Android)
4. **Install** — User installs and opens the app
5. **First launch detection** — The SDK detects this is the first launch (tracked via UserDefaults on iOS, SharedPreferences on Android)
6. **Signal collection** — The SDK collects device signals: screen size, timezone, preferred languages, and platform-specific identifiers (IDFV on iOS)
7. **Attribution request** — The SDK sends collected signals to `/attribution/match`
8. **Match result** — The server matches against stored click signals and returns a `WarpLinkDeepLink` with `isDeferred: true`

## React Native Implementation

Call `checkDeferredDeepLink()` in your root component's `useEffect`, early in the app lifecycle:

```tsx
import { useEffect, useState } from 'react';
import { WarpLink, type WarpLinkDeepLink } from '@warplink/react-native';

function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    WarpLink.checkDeferredDeepLink()
      .then((link) => {
        if (link?.isDeferred) {
          // User arrived via a WarpLink — route to intended content
          navigateTo(link.deepLinkUrl ?? link.destination);
        }
      })
      .catch((error) => {
        // Network error on first launch — show default experience
        console.warn('Deferred deep link check failed:', error.message);
      })
      .finally(() => {
        setIsReady(true);
      });
  }, []);

  if (!isReady) {
    return <SplashScreen />;
  }

  return <>{/* Your app */}</>;
}
```

## Confidence Scores

The match confidence depends on the matching method and time elapsed since the click:

| Scenario | Confidence | Match Type |
|----------|------------|------------|
| IDFV re-engagement (iOS, app was previously installed) | 1.0 | `deterministic` |
| Play Install Referrer (Android) | 1.0 | `deterministic` |
| Enriched fingerprint, < 1 hour since click | 0.85 | `probabilistic` |
| Enriched fingerprint, < 24 hours since click | 0.65 | `probabilistic` |
| Enriched fingerprint, < 72 hours since click | 0.40 | `probabilistic` |
| Multiple candidates matched | -0.15 per additional candidate | `probabilistic` |

**Recommendation:** Route to specific content when `matchConfidence` is above 0.5. Show generic onboarding when below 0.5.

## Match Window Configuration

The match window controls how far back the server looks for matching clicks. Default is 72 hours.

```tsx
WarpLink.configure({
  apiKey: 'wl_live_abcdefghijklmnopqrstuvwxyz012345',
  matchWindowHours: 48, // Reduce for higher accuracy
});
```

A shorter window reduces false positives but may miss users who take longer to install.

## Platform Differences

### iOS

- **Deterministic matching:** IDFV (Identifier for Vendor) — works for re-engagement when the app was previously installed. No ATT prompt needed.
- **Probabilistic matching:** Enriched fingerprint (IP + User-Agent + Accept-Language + screen size + timezone). Used for first-time installs.
- **No IDFA.** The SDK does not use IDFA and does not trigger App Tracking Transparency prompts.

### Android

- **Deterministic matching:** Play Install Referrer — the Play Store passes the click referrer through the install process. This is the most accurate method (confidence 1.0).
- **Probabilistic fallback:** If Play Install Referrer is unavailable (sideloaded app, Play Services missing), the SDK falls back to enriched fingerprint matching.

## Code Example with React Navigation

```tsx
import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';
import { WarpLink, type WarpLinkDeepLink } from '@warplink/react-native';

function useCheckDeferredDeepLink() {
  const navigation = useNavigation();

  useEffect(() => {
    WarpLink.checkDeferredDeepLink().then((link) => {
      if (!link?.isDeferred) return;

      const confidence = link.matchConfidence ?? 0;

      if (confidence > 0.5) {
        // High confidence — navigate directly
        const productId = link.customParams['product_id'] as string | undefined;
        if (productId) {
          navigation.navigate('Product', { id: productId });
        } else {
          navigation.navigate('WebView', { url: link.destination });
        }
      } else if (confidence > 0.3) {
        // Medium confidence — show suggestion
        navigation.navigate('Suggestion', {
          message: 'Were you looking for this?',
          url: link.destination,
        });
      }
      // Below 0.3 — ignore, show default onboarding
    });
  }, [navigation]);
}
```

## Caching Behavior

- The SDK checks for a deferred deep link only on the first launch.
- The result (match or no match) is cached by the native SDK (UserDefaults on iOS, SharedPreferences on Android).
- Subsequent calls to `checkDeferredDeepLink()` return `null` without a network request.
- This means the attribution check happens exactly once per app install.

## Edge Cases

### Offline First Launch

If the device has no network connectivity on first launch, `checkDeferredDeepLink()` rejects with a `WarpLinkError` (code `E_NETWORK_ERROR`). The first-launch flag may have been consumed, so retrying after connectivity is restored may return `null`.

**Recommendation:** Check for connectivity before calling `checkDeferredDeepLink()`, or handle the error gracefully and show your default first-launch experience.

### App Reinstall

- **iOS:** UserDefaults may persist across app delete/reinstall depending on the iOS version and iCloud backup settings. If persisted, the SDK considers it a subsequent launch and returns the cached result.
- **Android:** SharedPreferences are cleared on app uninstall. A fresh install will trigger a new attribution check.

### Multiple Links Clicked Before Install

If a user clicks multiple WarpLink URLs before installing, only the **most recent** click is stored for matching. The server matches against the latest deferred payload for the fingerprint.

### Match Window Expiry

If the user installs the app after the match window has expired (default 72 hours), the deferred deep link will not be found. `checkDeferredDeepLink()` returns `null`.

## Related Guides

- [Attribution](attribution.md) — detailed explanation of matching tiers
- [Error Handling](error-handling.md) — handling deferred deep link errors
- [Troubleshooting](troubleshooting.md) — common deferred deep link issues
- [Architecture](architecture.md) — end-to-end deferred deep link flow
