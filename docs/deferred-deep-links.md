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

1. **Click.** User taps a WarpLink URL in a browser or another app
2. **Signal capture.** WarpLink's edge server captures request signals (IP, Accept-Language, timezone) via a brief JavaScript interstitial
3. **Store redirect.** User is redirected to the App Store (iOS) or Play Store (Android)
4. **Install.** User installs and opens the app
5. **First launch detection.** The SDK detects this is the first launch of this install. The completion marker is a backup-excluded file on iOS and a file in the no-backup directory on Android, so a reinstall runs the check again. A separate device-seen marker (Keychain on iOS, `SharedPreferences` on Android) outlives an uninstall and only sets `is_reinstall`.
6. **Signal collection.** The SDK collects device signals: preferred language, timezone (IANA zone name plus the minute offset), and platform-specific identifiers (IDFV on iOS)
7. **Attribution request.** The SDK sends collected signals to `/attribution/match`
8. **Match result.** The server matches against stored click signals and returns a `WarpLinkDeepLink` with `isDeferred: true`

## React Native Implementation

**With the opt-out model, deferred deep links are automatic.** As long as you
pass `onLink` to `configure()` and leave `automaticDeferredDeepLinks` at its
default (`true`), a first-launch match is delivered through `onLink` with
`isDeferred: true`:

```tsx
WarpLink.configure({
  apiKey: 'wl_live_yoursdkkeyhere000000000000000000',
  onLink: ({ deepLink }) => {
    if (deepLink?.isDeferred) {
      // Install matched to an original click — route to intended content.
      navigateTo(deepLink.deepLinkUrl ?? deepLink.destination);
    }
  },
});
```

### Manual check (opt-out)

If you set `automaticDeferredDeepLinks: false`, or you omitted `onLink` and so
have nowhere for the match to arrive, call `checkDeferredDeepLink()` in your
root component's `useEffect`, early in the app lifecycle. Note that omitting
`onLink` does not stop the check: the install is attributed either way, and the
manual call reads the result.

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
| Fingerprint, < 1 hour since click | 0.85 | `probabilistic` |
| Fingerprint, < 3 hours since click | 0.65 | `probabilistic` |
| Fingerprint, < 6 hours since click | 0.50 | `probabilistic` |
| Fingerprint, < 24 hours since click | 0.30 | `probabilistic` |
| 24 hours or more since click | no match | none |

The fingerprint rows are the ceilings for the zone-name variant that an SDK
collecting a zone name sends. The offset variant kept for older SDKs scores a band lower (0.80
down to 0.25), and the language-only fallback lower still (0.70 down to 0.20).
Two multipliers then reduce whichever ceiling applied: 0.6 when more than one
claimable click shared the fingerprint, and 0.6 / 0.9 / 1.0 for a
carrier-grade-NAT, household-IPv4, or IPv6 click address.

**Recommendation:** Route to specific content when `matchConfidence` is above 0.5. Show generic onboarding when below 0.5. Gate anything sensitive on `matchGuaranteed` instead, which is `true` only for a deterministic match: a probabilistic match is a best guess from a network-shaped fingerprint and can name the wrong user.

## Match Window Configuration

The match window controls how far back the server looks for matching clicks. It
is **server-authoritative**, configured per link in the WarpLink dashboard
(`match_window_hours`) and enforced by the attribution API. It **defaults to 6
hours and cannot exceed 24**; a link created before that ceiling may still carry
a longer value, but the platform clamps it to 24 hours on read. There is no
client-side setting to change it.

The window is short on purpose. The fingerprint key is a network, not a device:
an IP address, a normalized language, and a timezone. Every phone behind one NAT
that shares a language and timezone lands in the same bucket, so each extra hour
lets another stranger join it while adding almost no real matches. It governs the
probabilistic tier only; the deterministic paths are unaffected.

> The `matchWindowHours` option on `configure()` is retained for backward
> compatibility but has no client-side effect. Configure the window per link in
> the dashboard instead.

## Platform Differences

### iOS

- **Deterministic matching:** IDFV (Identifier for Vendor) — works for re-engagement when the app was previously installed. No ATT prompt needed.
- **Probabilistic matching:** Fingerprint (IP + preferred language + timezone, hashed server-side). Used for first-time installs.
- **No IDFA.** The SDK does not use IDFA and does not trigger App Tracking Transparency prompts.

### Android

- **Deterministic matching:** Play Install Referrer — the Play Store passes the click referrer through the install process. This is the most accurate method (confidence 1.0).
- **Probabilistic fallback:** If Play Install Referrer is unavailable (sideloaded app, Play Services missing), the SDK falls back to fingerprint matching (IP + preferred language + timezone).

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

      // Identity work needs a deterministic match, not a high score.
      if (link.matchGuaranteed) {
        restoreAccount(link);
      }

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
- The first-launch marker is split into "attempted" and "completed": it is
  consumed only on a definitive server response. If the first attempt fails
  (e.g. offline), the check retries on the next launch.
- The result (match or no match) is cached by the native SDK once completed.
- Subsequent calls to `checkDeferredDeepLink()` return that cached result without
  a network request: the same match if one was found, `null` if there was none.
- This means the attribution check completes exactly once per app install.

## Edge Cases

### Offline First Launch

If the device has no network connectivity on first launch, the check fails with a
`WarpLinkError` (code `E_NETWORK_ERROR`) — surfaced through `onLink` as an
`{ error }` event (or rejected from a manual `checkDeferredDeepLink()` call). The
first-launch marker is **not** consumed on a failed attempt, so the check
automatically retries on the next launch once connectivity is restored.

**Recommendation:** Handle the error gracefully and show your default
first-launch experience; the retry happens on its own.

### App Reinstall

A reinstall counts as an install. The deferred check runs again on the first
launch after a reinstall, on both platforms, so the install is attributed and the
user reaches the content they clicked for. Deleting the app and installing it
again is enough to retest on iOS and on Android.

The SDK reports whether the install followed an earlier one to the attribution
API, so the two can be measured separately later. It is not surfaced to your
app today.

Two separate native markers produce this, and neither is readable from
JavaScript:

- The **gate** answers "has attribution already completed for this install?". It
  is deliberately tied to the install and does not come back from a delete or
  from a restored backup, so it can never suppress the check on a reinstall.
- The **device-seen marker** answers "has this device ever completed
  attribution?". It survives a delete and a restore, and it gates nothing. It
  only tags the attribution request so a reinstall can be counted separately.

### Multiple Links Clicked Before Install

A fingerprint is a network rather than a device, so several clicks can land under
one key: your own user clicking twice, or two strangers behind the same NAT. The
platform keeps them as a list, newest first, up to 10 per fingerprint. A second
click no longer overwrites the first, so the install that belongs to the earlier
click can still find it.

The server matches against the newest entry your app is allowed to claim, and
removes only that entry once it becomes an install. When more than one entry was
claimable, the match is scored lower to reflect that the answer was picked from a
set.

### Match Window Expiry

If the user installs the app after the match window has expired (6 hours by
default, 24 at most), the deferred deep link will not be found.
`checkDeferredDeepLink()` returns `null`.

## Related Guides

- [Attribution](attribution.md) — detailed explanation of matching tiers
- [Error Handling](error-handling.md) — handling deferred deep link errors
- [Troubleshooting](troubleshooting.md) — common deferred deep link issues
- [Architecture](architecture.md) — end-to-end deferred deep link flow
