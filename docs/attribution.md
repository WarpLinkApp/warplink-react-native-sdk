# Install Attribution

WarpLink uses two tiers of attribution matching to connect app installs and opens to the links that drove them. The SDK collects device signals and sends them to the WarpLink API, which determines the match.

## Overview

When a user interacts with a WarpLink URL, the platform captures signals from the click. When the app opens (or is installed and opened for the first time), the SDK collects device-side signals. The server compares both sets of signals to determine if there's a match.

The result is returned as an `AttributionResult` with `matchType`, `matchConfidence`, and `matchGuaranteed` properties.

## Deterministic Matching

Deterministic matching uses stable device identifiers that guarantee an exact match.

### iOS — IDFV

**Used for:** Re-engagement — when the app is already installed or was previously installed on the same device.

| Property | Value |
|----------|-------|
| Signal | IDFV (Identifier for Vendor) |
| Match type | `deterministic` |
| Confidence | 1.0 (exact match) |
| Requires ATT? | No |
| Requires user permission? | No |

IDFV is a UUID unique to the combination of your app's vendor and the device. It does not require any user permission and is **exempt from App Tracking Transparency (ATT)**. The SDK includes IDFV in attribution requests automatically.

### Android — Play Install Referrer

**Used for:** First-install attribution — the Play Store passes the click referrer through the install process.

| Property | Value |
|----------|-------|
| Signal | Play Install Referrer |
| Match type | `deterministic` |
| Confidence | 1.0 (exact match) |
| Requires Google Play? | Yes |
| Requires user permission? | No |

When available, Play Install Referrer provides deterministic attribution with no fingerprint ambiguity. Falls back to probabilistic matching if Play Services is unavailable (sideloaded apps, alternative stores).

## Probabilistic Matching (Enriched Fingerprint)

**Used for:** First-install attribution when deterministic signals are not available.

| Property | Value |
|----------|-------|
| Signals | IP address + preferred language + timezone |
| Match type | `probabilistic` |
| Confidence | 0.20 to 0.85 before the multipliers below, never `matchGuaranteed` |
| Requires ATT? | No |
| Requires user permission? | No |

When a user clicks a WarpLink URL, a brief JavaScript interstitial captures request-side signals. On first app launch, the SDK collects the same categories of signals from the device and sends them to the attribution API. The server computes the fingerprint hash from both sets (IP is derived server-side from the request) and checks for a match.

Since 1.1.0 the native modules send the IANA timezone name (`timezone`, e.g. `America/Toronto`) alongside the minute offset (`timezone_offset`). The zone name carries far more entropy than the offset, roughly 340 zones against roughly 38 offsets, and it does not shift at a daylight-saving boundary, which used to break a click and its install apart when the clocks changed between them. The server prefers the zone name and falls back to the offset for older SDKs.

> **Note:** the fingerprint intentionally excludes User-Agent and screen
> dimensions. They differ between a mobile browser and a native app (browser UA vs
> app UA; CSS pixels vs iOS points vs Android physical pixels) and never match, so
> including them only adds noise.

## App Identity

Every attribution request also carries the host app's identifier: `app_bundle_id` on iOS, `app_package_name` on Android. It is not a fingerprint component and does not affect confidence.

An API key is scoped to your organization, not to a single app. If your organization ships more than one app, this identifier is what lets the server attribute an install to the app it actually happened in. The native modules read it from the app itself (`Bundle.main.bundleIdentifier` and `Context.getPackageName()`), so there is nothing to configure and no JavaScript field to pass.

### Confidence by Time Window

The elapsed time and the fingerprint variant set the ceiling. `enriched_tz` is the zone-name variant that an SDK collecting a zone name sends; `enriched` is the offset variant kept for older SDKs; `basic` is the language-only key the server tries last.

| Time Since Click | `enriched_tz` | `enriched` | `basic` |
|------------------|---------------|------------|---------|
| < 1 hour | 0.85 | 0.80 | 0.70 |
| < 3 hours | 0.65 | 0.60 | 0.50 |
| < 6 hours | 0.50 | 0.45 | 0.35 |
| < 24 hours | 0.30 | 0.25 | 0.20 |
| 24 hours or more | no match | no match | no match |

Confidence decreases over time because IP addresses and network conditions change. Those values are ceilings, and two multipliers pull the score down when the answer was less certain than the clock alone suggests:

| Condition | Multiplier |
|-----------|------------|
| More than one claimable click sat in the fingerprint's bucket | 0.6 |
| The click's IP was carrier-grade NAT or private | 0.6 |
| The click's IP was a household IPv4 address | 0.9 |
| The click's IP was IPv6 | 1.0 |

### The match window

The match window is server-side, set per link in the dashboard. It **defaults to 6 hours and cannot exceed 24**; a link created before that ceiling may still carry a longer value, but the platform clamps it to 24 hours on read.

The window is short on purpose. The fingerprint key is a network, not a device: an IP address, a normalized language, and a timezone. Every phone behind one NAT that shares a language and timezone lands in the same bucket, so each extra hour lets another stranger join it while adding almost no real matches. This governs the probabilistic tier only. The deterministic paths (IDFV on iOS, Play Install Referrer on Android) read stored click data instead of the fingerprint bucket, so the window does not apply to them.

## Interpreting Match Results

### Using `getAttributionResult()`

```tsx
import { WarpLink, type AttributionResult } from '@warplink/react-native';

const attribution = await WarpLink.getAttributionResult();
if (attribution) {
  console.log('Link ID:', attribution.linkId);
  console.log('Match type:', attribution.matchType);
  console.log('Confidence:', attribution.matchConfidence);
  console.log('Guaranteed:', attribution.matchGuaranteed);
  console.log('Is deferred:', attribution.isDeferred);
}
```

`getAttributionResult()` returns `null` for a genuine no-match (organic install).
A non-null but malformed native payload instead throws a `WarpLinkError`
(`E_DECODING_ERROR`), so you can tell "no attribution" apart from "the data could
not be read".

### Gate sensitive work on `matchGuaranteed`

`matchGuaranteed` is `true` only when the match came from a deterministic signal (IDFV on iOS, Play Install Referrer on Android). Gate anything sensitive on it (auto sign-in, restoring an account, showing personal data) rather than on a confidence threshold. A probabilistic match is a best guess drawn from a network-shaped fingerprint, so even a high score can name the wrong user.

```tsx
if (attribution.matchGuaranteed) {
  restoreAccount(attribution.linkId); // this is the person we think it is
} else {
  showContent(attribution.linkId);    // route content, but never identity
}
```

### Reinstalls are attributed, and flagged

A reinstall counts as an install. Attribution runs again on the first launch
after a reinstall, on both platforms, so the install is measured and the user
still reaches the content they clicked for.

The SDK reports which of the two it was to the attribution API, so a reinstall
can be measured separately later. It is not surfaced to your app today.

### Recommended Thresholds

| Confidence | Recommended Action |
|------------|-------------------|
| 1.0 (deterministic) | Route directly to content |
| > 0.5 (probabilistic) | Route to content — high confidence |
| 0.3 to 0.5 | Show content with a confirmation (e.g., "Were you looking for...?") |
| < 0.3 | Show generic onboarding — too uncertain |

### Confidence-Based Branching

```tsx
const attribution = await WarpLink.getAttributionResult();
if (!attribution) {
  // No attribution — organic install
  showOnboarding();
  return;
}

if (attribution.matchConfidence >= 0.5) {
  // High confidence — route to attributed content
  navigateToLink(attribution.linkId);
} else if (attribution.matchConfidence >= 0.3) {
  // Medium confidence — suggest content
  showSuggestion(attribution.linkId);
} else {
  // Low confidence — treat as organic
  showOnboarding();
}
```

## Privacy Considerations

The WarpLink SDK is designed with privacy as a core principle:

### What the SDK Does NOT Collect

- **IDFA** (iOS Advertising Identifier) — never accessed
- **GAID** (Google Advertising ID) — never accessed
- **Android ID** — never accessed
- **User-Agent** — not collected for attribution
- **Screen dimensions** — not collected for attribution
- **Location data** — not collected
- **Contacts or personal data** — not collected
- **App usage data**: no screens, sessions, taps, or in-app events. The reinstall flag below is install history, not usage.
- **Cross-app identifiers** — not used

### What the SDK Collects

| Signal | Purpose | Platform |
|--------|---------|----------|
| Preferred language | Fingerprint component | Both |
| Timezone name | Fingerprint component | Both |
| Timezone offset | Fingerprint component (fallback key) | Both |
| Reinstall flag (`is_reinstall`) | Routes a returning user back to the content they tapped, and separates reinstalls from first installs afterwards | Both |
| IDFV | Deterministic matching (re-engagement) | iOS only |
| Play Install Referrer | Deterministic matching (first install) | Android only |

The IP address used in the fingerprint is derived server-side from the request —
the SDK never sends a precomputed fingerprint or the device's IP.

The reinstall flag is retained on the install record, so it outlives the request
that carried it. Everything else in that table is used for the match and nothing
else.

### Store privacy declarations

This package bridges to the native SDKs, so you ship on both stores and each one
wants a different thing from you.

- **App Store.** The iOS SDK ships a privacy manifest and Xcode folds it into
  your app's privacy report automatically. See
  [the iOS privacy manifest section](https://github.com/WarpLinkApp/warplink-ios-sdk/blob/main/docs/attribution.md#privacy-manifest)
  for what it declares.
- **Google Play.** Android has no equivalent, so nothing reaches Google on its
  own and the Data safety form in your Play Console listing is yours to fill in.
  [The Android Data safety mapping](https://github.com/WarpLinkApp/warplink-android-sdk/blob/main/docs/attribution.md#play-data-safety-mapping)
  gives you a field-by-field table to copy from.

Neither one answers for your whole app. Both cover only what this SDK
contributes.

### ATT Compliance (iOS)

- The SDK does **not** prompt for App Tracking Transparency permission
- IDFV is [exempt from ATT](https://developer.apple.com/documentation/apptrackingtransparency) — it does not track users across apps
- The SDK does **not** interfere with your app's own ATT strategy
- You can use WarpLink alongside any ATT implementation

### Data Handling

- Device signals are sent to the WarpLink API over HTTPS
- Fingerprint data is used solely for attribution matching
- No cross-app tracking is performed
- IDFV is scoped to your vendor — WarpLink cannot use it to track users across different vendors' apps
- GDPR compliant — only ephemeral device signals are collected for the purpose of attribution

## Related Guides

- [Deferred Deep Links](deferred-deep-links.md) — how deferred deep linking uses attribution
- [API Reference](api-reference.md) — `AttributionResult` and `WarpLinkDeepLink` documentation
- [Architecture](architecture.md) — end-to-end attribution flow
