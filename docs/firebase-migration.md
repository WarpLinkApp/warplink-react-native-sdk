# Firebase Dynamic Links Migration Guide

Firebase Dynamic Links was deprecated on August 25, 2025. This guide walks you through migrating your React Native app from `@react-native-firebase/dynamic-links` to `@warplink/react-native`.

## Concept Mapping

| Firebase Dynamic Links | WarpLink |
|----------------------|----------|
| Dynamic Links | Links |
| Firebase console | [WarpLink dashboard](https://warplink.app) |
| `@react-native-firebase/dynamic-links` | `@warplink/react-native` |
| `yourapp.page.link` domain | `aplnk.to` domain |
| `dynamicLinks()` | `WarpLink` (singleton object) |
| Link parameters (social metadata, analytics) | Link fields (destination, deep link URL, custom params) |
| Firebase Analytics integration | WarpLink attribution |

## Step 1: Recreate Your Links

Recreate your Firebase Dynamic Links as WarpLink links via the [dashboard](https://warplink.app) or the [REST API](https://api.warplink.app/v1).

### Parameter Mapping

| Firebase Parameter | WarpLink Field |
|-------------------|----------------|
| `link` (deep link URL) | `destination_url` |
| `isi` (iOS App Store ID) | Configured per-app in dashboard |
| `ibi` (iOS bundle ID) | Configured per-app in dashboard |
| `ifl` (iOS fallback link) | `ios_fallback_url` |
| `apn` (Android package name) | Configured per-app in dashboard |
| `afl` (Android fallback link) | `android_fallback_url` |
| `efr` (skip preview page) | N/A (WarpLink uses 302 redirects by default) |
| `st` / `sd` / `si` (social metadata) | OG tags on destination page |
| Custom parameters | `custom_params` JSON object |

### Via Dashboard

1. Go to **Links** > **Create Link**
2. Set the destination URL
3. Add iOS and/or Android deep link URLs if needed
4. Add any custom parameters

### Via API

```bash
curl -X POST https://api.warplink.app/v1/links \
  -H "Authorization: Bearer wl_live_abcdefghijklmnopqrstuvwxyz012345" \
  -H "Content-Type: application/json" \
  -d '{
    "destination_url": "https://yourapp.com/product/123",
    "ios_url": "myapp://product/123",
    "android_url": "myapp://product/123",
    "custom_params": { "referrer": "campaign_spring" }
  }'
```

## Step 2: Swap the SDK

### Remove Firebase Dynamic Links

```bash
npm uninstall @react-native-firebase/dynamic-links
```

If you don't use any other Firebase packages, also remove the core package:

```bash
npm uninstall @react-native-firebase/app
```

Then reinstall iOS pods:

```bash
cd ios && pod install
```

### Add WarpLink

```bash
npm install @warplink/react-native
cd ios && pod install
```

### Update imports

Remove all Firebase Dynamic Links imports from your source files:

```tsx
// Remove these
import dynamicLinks from '@react-native-firebase/dynamic-links';
```

Add WarpLink imports:

```tsx
import { WarpLink } from '@warplink/react-native';
```

## Step 3: Update SDK Initialization

**Firebase:**

```tsx
// Firebase required no explicit initialization for Dynamic Links
// (initialized automatically via @react-native-firebase/app)
```

**WarpLink:**

```tsx
import { WarpLink } from '@warplink/react-native';

// Call once at app startup, outside any component
WarpLink.configure({
  apiKey: 'wl_live_abcdefghijklmnopqrstuvwxyz012345',
});
```

## Step 4: Migrate Deep Link Handling

### Get Initial Link (Cold Start)

**Firebase:**

```tsx
useEffect(() => {
  dynamicLinks()
    .getInitialLink()
    .then((link) => {
      if (link) {
        handleDeepLink(link.url);
      }
    });
}, []);
```

**WarpLink:**

```tsx
useEffect(() => {
  WarpLink.getInitialDeepLink().then((link) => {
    if (link) {
      navigateTo(link.destination);
    }
  });
}, []);
```

### Listen for Links (Warm Start)

**Firebase:**

```tsx
useEffect(() => {
  const unsubscribe = dynamicLinks().onLink((link) => {
    handleDeepLink(link.url);
  });
  return unsubscribe;
}, []);
```

**WarpLink:**

```tsx
useEffect(() => {
  const unsubscribe = WarpLink.onDeepLink((event) => {
    if (event.deepLink) {
      navigateTo(event.deepLink.destination);
    } else if (event.error) {
      console.error('Deep link error:', event.error.message);
    }
  });
  return unsubscribe;
}, []);
```

### Key Differences

| | Firebase | WarpLink |
|-|---------|----------|
| Cold start | `dynamicLinks().getInitialLink()` | `WarpLink.getInitialDeepLink()` |
| Warm start | `dynamicLinks().onLink(callback)` | `WarpLink.onDeepLink(callback)` |
| Return type | `FirebaseDynamicLinksTypes.DynamicLink` | `WarpLinkDeepLink` |
| Deep link URL | `link.url` | `deepLink.destination` or `deepLink.deepLinkUrl` |
| Error handling | No typed errors | `WarpLinkError` with error codes |
| Custom parameters | Embedded in the URL as query params | `deepLink.customParams` dictionary |
| Unsubscribe | Returns unsubscribe function | Returns unsubscribe function (same pattern) |

### Accessing Link Parameters

**Firebase:**

```tsx
// Firebase: parameters embedded in the URL
const link = await dynamicLinks().getInitialLink();
if (link) {
  const url = new URL(link.url);
  const productId = url.searchParams.get('product_id');
  const referrer = url.searchParams.get('referrer');
}
```

**WarpLink:**

```tsx
// WarpLink: parameters in a typed object
const link = await WarpLink.getInitialDeepLink();
if (link) {
  const productId = link.customParams['product_id'] as string | undefined;
  const referrer = link.customParams['referrer'] as string | undefined;
  // Also available:
  console.log('Destination:', link.destination);
  console.log('Link ID:', link.linkId);
}
```

## Step 5: Migrate Deferred Deep Links

**Firebase:**

```tsx
// Firebase handled deferred deep links via getInitialLink() on first launch
useEffect(() => {
  dynamicLinks()
    .getInitialLink()
    .then((link) => {
      if (link) {
        // Could be a deferred deep link — no way to distinguish
        handleDeepLink(link.url);
      }
    });
}, []);
```

**WarpLink:**

```tsx
// WarpLink: explicit deferred deep link API with attribution data
useEffect(() => {
  WarpLink.checkDeferredDeepLink().then((link) => {
    if (link?.isDeferred) {
      console.log('Match confidence:', link.matchConfidence);
      navigateTo(link.deepLinkUrl ?? link.destination);
    }
  });
}, []);
```

### Key Differences

| | Firebase | WarpLink |
|-|---------|----------|
| API | `getInitialLink()` (same as cold start) | `checkDeferredDeepLink()` (dedicated API) |
| Deferred detection | No `isDeferred` flag | `link.isDeferred === true` |
| Attribution data | None | `matchType`, `matchConfidence` |
| Caching | Manual | Automatic (cached after first check) |

## Step 6: Link Migration Strategy

### Redirect Existing Firebase Links

If you have existing Firebase Dynamic Links in the wild (shared on social media, in emails, etc.), you can redirect them to WarpLink:

1. Set up a redirect from your Firebase `*.page.link` domain to the equivalent WarpLink short link
2. Or update the destination in Firebase console to point to the WarpLink short URL

### Bulk Create via API

For large numbers of links, use the WarpLink REST API to bulk create:

```bash
# Create links in batch via the API
for url in "${urls[@]}"; do
  curl -X POST https://api.warplink.app/v1/links \
    -H "Authorization: Bearer wl_live_abcdefghijklmnopqrstuvwxyz012345" \
    -H "Content-Type: application/json" \
    -d "{\"destination_url\": \"$url\"}"
done
```

### Transition Period

During migration, you can maintain both SDKs temporarily:
1. Keep `@react-native-firebase/dynamic-links` for existing links
2. Add `@warplink/react-native` for new links
3. Once all links are migrated, remove Firebase

## Step 7: Feature Comparison

| Feature | Firebase Dynamic Links | WarpLink |
|---------|----------------------|----------|
| Short links | Yes | Yes |
| Deferred deep links | Yes (limited data) | Yes (with confidence scores) |
| Install attribution | No | Yes (deterministic + probabilistic) |
| Custom domains | Yes | Yes |
| Analytics | Via Firebase Analytics | Built-in click analytics |
| Social previews (OG tags) | Built-in | Built-in (via bot detection) |
| Cross-platform | iOS + Android + web | iOS + Android + React Native + web |
| Pricing | Free (deprecated) | Free tier (10K clicks/mo) |
| Open source SDK | No | Yes (MIT) |

## Step 8: Testing Checklist

After migration, verify each flow works:

- [ ] **SDK initializes** — enable `debugLogging: true` and check console
- [ ] **Cold start deep link** — `getInitialDeepLink()` returns the correct link
- [ ] **Warm start deep link** — `onDeepLink()` listener fires when a link is tapped while the app is running
- [ ] **Custom parameters preserved** — check `deepLink.customParams` matches what you configured
- [ ] **Deferred deep links work** — delete app, click link, reinstall, launch, verify `checkDeferredDeepLink()` returns match
- [ ] **iOS Universal Links work** — tap a WarpLink URL on a physical iOS device
- [ ] **Android App Links work** — tap a WarpLink URL on an Android device
- [ ] **Error handling works** — test with an invalid URL, expired link, and no connectivity
- [ ] **Old Firebase code fully removed** — no remaining `@react-native-firebase/dynamic-links` imports
- [ ] **Build succeeds** — clean build with no Firebase Dynamic Links dependencies

## Related Guides

- [Integration Guide](integration-guide.md) — full setup walkthrough
- [API Reference](api-reference.md) — all public types and methods
- [Troubleshooting](troubleshooting.md) — common issues after migration
