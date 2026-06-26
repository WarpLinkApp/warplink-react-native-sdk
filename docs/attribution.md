# Install Attribution

WarpLink uses two tiers of attribution matching to connect app installs and opens to the links that drove them. The SDK collects device signals and sends them to the WarpLink API, which determines the match.

## Overview

When a user interacts with a WarpLink URL, the platform captures signals from the click. When the app opens (or is installed and opened for the first time), the SDK collects device-side signals. The server compares both sets of signals to determine if there's a match.

The result is returned as an `AttributionResult` with `matchType` and `matchConfidence` properties.

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
| Signals | IP address + User-Agent + Accept-Language + screen resolution + timezone |
| Match type | `probabilistic` |
| Confidence | 0.40 to 0.85 (varies by time window) |
| Requires ATT? | No |
| Requires user permission? | No |

When a user clicks a WarpLink URL, a brief JavaScript interstitial captures browser-side signals. On first app launch, the SDK collects the same categories of signals from the device and sends them to the attribution API. The server computes a fingerprint from both sets and checks for a match.

### Confidence by Time Window

| Time Since Click | Confidence |
|------------------|------------|
| < 1 hour | 0.85 |
| < 24 hours | 0.65 |
| < 72 hours | 0.40 |
| Multiple candidates | -0.15 per additional match |

Confidence decreases over time because IP addresses and network conditions change. The multiple-candidate penalty applies when more than one stored click matches the fingerprint.

## Interpreting Match Results

### Using `getAttributionResult()`

```tsx
import { WarpLink, type AttributionResult } from '@warplink/react-native';

const attribution = await WarpLink.getAttributionResult();
if (attribution) {
  console.log('Link ID:', attribution.linkId);
  console.log('Match type:', attribution.matchType);
  console.log('Confidence:', attribution.matchConfidence);
  console.log('Is deferred:', attribution.isDeferred);
  console.log('Install ID:', attribution.installId);
}
```

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
- **Location data** — not collected
- **Contacts or personal data** — not collected
- **App usage data** — not collected
- **Cross-app identifiers** — not used

### What the SDK Collects

| Signal | Purpose | Platform |
|--------|---------|----------|
| Screen resolution | Fingerprint component | Both |
| Timezone offset | Fingerprint component | Both |
| Preferred languages | Fingerprint component | Both |
| IDFV | Deterministic matching (re-engagement) | iOS only |
| Play Install Referrer | Deterministic matching (first install) | Android only |

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
