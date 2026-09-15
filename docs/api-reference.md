# API Reference

Complete reference for all public types and methods in the WarpLink React Native SDK.

## WarpLink

The main entry point for the SDK. Exported as both a named and default export from `@warplink/react-native`.

```typescript
import { WarpLink } from '@warplink/react-native';
// or
import WarpLink from '@warplink/react-native';
```

### Methods

#### `configure(options)`

```typescript
configure(options: WarpLinkConfig): Promise<void>
```

Configure the SDK with your SDK key. Must be called before any other SDK methods.

Pass an `onLink` callback to enable the **opt-out model**: cold-start, warm-start,
and deferred deep links are auto-wired and funneled into that one callback. Each
source is independently disable-able via `automaticDeepLinks` /
`automaticDeferredDeepLinks`.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `options` | `WarpLinkConfig` | Configuration object with your SDK key, `onLink`, and optional settings. |

**Behavior:**
- Returns a `Promise<void>` that resolves once native configuration (and any
  automatic cold-start + deferred dispatch) completes.
- The SDK key **format** is validated **synchronously**, but a malformed key
  does **not** throw. It logs a warning, is reported to `onLink` as an
  `{ error }` event with code `E_INVALID_API_KEY_FORMAT`, and leaves the SDK
  unconfigured. iOS and Android behave the same way.
- A native/server configuration failure is delivered to `onLink` as an
  `{ error }` event when `onLink` is provided; otherwise the returned promise
  rejects with a mapped `WarpLinkError`.
- Cold-start and warm-start auto-wiring only activates when `onLink` is
  provided. The deferred check is the exception: it is the install attribution
  request, so it fires with or without `onLink` unless
  `automaticDeferredDeepLinks` is `false`. A light internal dedupe
  ensures the same source URL is never dispatched twice (e.g. via both cold start
  and a warm-start event).
- Reconfiguring tears down prior auto-wiring first (idempotent).
- `linkDomains` is forwarded to the native layer untouched. Normalization
  (trim, lowercase, full URL reduced to its host) happens natively, so the same
  rules apply to domains declared in `Info.plist` or the Android manifest.
- Call once at app startup, outside of any React component.

**Example:**

```tsx
import { WarpLink } from '@warplink/react-native';

// Opt-out model — one call wires everything.
WarpLink.configure({
  apiKey: 'wl_live_yoursdkkeyhere000000000000000000',
  onLink: ({ deepLink, error }) => {
    if (deepLink) navigate(deepLink.deepLinkUrl ?? deepLink.destination);
    else if (error) console.error(error.code, error.message);
  },
});

// Disable individual pieces to wire them manually.
WarpLink.configure({
  apiKey: 'wl_live_yoursdkkeyhere000000000000000000',
  onLink: handleLink,
  debugLogging: true,
  automaticDeepLinks: false,
  automaticDeferredDeepLinks: false,
});
```

---

#### `handleDeepLink(url)`

```typescript
handleDeepLink(url: string): Promise<WarpLinkDeepLink | null>
```

Resolve a deep link URL to its link data. Call this when you receive a URL from the native layer that you want to resolve manually.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | `string` | The deep link URL to resolve (e.g., `https://aplnk.to/abc123`). |

**Returns:** `Promise<WarpLinkDeepLink | null>` — the resolved deep link, or `null` if the response could not be deserialized.

**Errors:**

| Error Code | When |
|------------|------|
| `E_NOT_CONFIGURED` | SDK not configured yet |
| `E_INVALID_URL` | URL is not a recognized WarpLink domain |
| `E_LINK_NOT_FOUND` | Link does not exist or is inactive |
| `E_PASSWORD_REQUIRED` | Link is password protected, so it resolves to nothing |
| `E_NETWORK_ERROR` | Network request failed |
| `E_SERVER_ERROR` | API returned a 5xx error |
| `E_INVALID_API_KEY` | Key rejected by server |
| `E_DECODING_ERROR` | Response parsing failed |

**Example:**

```tsx
try {
  const deepLink = await WarpLink.handleDeepLink('https://aplnk.to/abc123');
  if (deepLink) {
    console.log('Link ID:', deepLink.linkId);
    console.log('Destination:', deepLink.destination);
    if (deepLink.deepLinkUrl) {
      console.log('Deep link URL:', deepLink.deepLinkUrl);
    }
  }
} catch (error) {
  if (error instanceof WarpLinkError) {
    console.error(`[${error.code}] ${error.message}`);
  }
}
```

---

#### `checkDeferredDeepLink()`

```typescript
checkDeferredDeepLink(): Promise<WarpLinkDeepLink | null>
```

Check for a deferred deep link on first launch. Returns `null` if no match was found. Once the check has completed, later calls return the same cached result instead of running it again.

**Returns:** `Promise<WarpLinkDeepLink | null>` — the matched deep link with `isDeferred: true`, or `null`.

**Behavior:**
- On the first launch of an install: collects device signals, sends them to the attribution API, and returns the match result.
- On subsequent launches of that same install: returns the cached result without a network request, which is the match found on the first launch, or `null` if there was none.
- After a reinstall: the check runs again, on both platforms. A reinstall counts as an install and is attributed again.
- The matched deep link has `isDeferred: true` and includes `matchType`, `matchConfidence`, and `matchGuaranteed`.

**Errors:**

| Error Code | When |
|------------|------|
| `E_NOT_CONFIGURED` | SDK not configured yet |
| `E_NETWORK_ERROR` | Network request failed |
| `E_SERVER_ERROR` | API returned a 5xx error |
| `E_INVALID_API_KEY` | Key rejected by server |
| `E_DECODING_ERROR` | Response parsing failed |

**Example:**

```tsx
const link = await WarpLink.checkDeferredDeepLink();
if (link?.isDeferred) {
  const confidence = link.matchConfidence ?? 0;
  if (link.matchGuaranteed) {
    // Deterministic match: safe to restore identity, not just content
    restoreAccount(link);
  }
  if (confidence > 0.5) {
    // High confidence — route to specific content
    navigateTo(link.deepLinkUrl ?? link.destination);
  } else {
    // Low confidence — show suggestion
    showSuggestion(link.destination);
  }
}
```

---

#### `getAttributionResult()`

```typescript
getAttributionResult(): Promise<AttributionResult | null>
```

Get install attribution data for the current app install. Returns the attribution match including the link that drove the install.

**Returns:** `Promise<AttributionResult | null>` — attribution data, or `null` for a genuine no-match (organic install).

**Behavior:**
- Returns `null` when the native module reports no attribution (organic install).
- Throws `E_DECODING_ERROR` when a non-null but malformed payload is returned —
  so a decode failure is distinguishable from a genuine no-match.

**Errors:**

| Error Code | When |
|------------|------|
| `E_NOT_CONFIGURED` | SDK not configured yet |
| `E_NETWORK_ERROR` | Network request failed |
| `E_SERVER_ERROR` | API returned a 5xx error |
| `E_INVALID_API_KEY` | Key rejected by server |
| `E_DECODING_ERROR` | Non-null response could not be decoded |

**Example:**

```tsx
const attribution = await WarpLink.getAttributionResult();
if (attribution) {
  console.log('Matched link:', attribution.linkId);
  console.log('Match type:', attribution.matchType); // 'deterministic' or 'probabilistic'
  console.log('Confidence:', attribution.matchConfidence);
  console.log('Guaranteed:', attribution.matchGuaranteed); // true only when deterministic
  console.log('Is deferred:', attribution.isDeferred);
}
```

---

#### `isConfigured()`

```typescript
isConfigured(): Promise<boolean>
```

Check whether the SDK has been configured via `configure()`.

**Returns:** `Promise<boolean>` — `true` if `configure()` has been called successfully.

**Example:**

```tsx
const configured = await WarpLink.isConfigured();
if (!configured) {
  console.warn('WarpLink SDK not configured');
}
```

---

#### `onDeepLink(listener)`

```typescript
onDeepLink(listener: DeepLinkListener): () => void
```

Register a listener for incoming deep links (warm-start events). The listener receives deep link events when the app is already running and a new deep link arrives.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `listener` | `DeepLinkListener` | Callback function that receives `DeepLinkEvent` objects. |

**Returns:** `() => void` — an unsubscribe function. Call it to remove the listener.

**Behavior:**
- Supports multiple concurrent listeners. Each listener receives every event.
- When the last listener is removed, the native event subscription is cleaned up.
- The native event name is `onWarpLinkDeepLink`.

**Example:**

```tsx
import { useEffect } from 'react';
import { WarpLink } from '@warplink/react-native';

function App() {
  useEffect(() => {
    const unsubscribe = WarpLink.onDeepLink((event) => {
      if (event.deepLink) {
        console.log('Received deep link:', event.deepLink.destination);
        // Navigate to content
      } else if (event.error) {
        console.error('Deep link error:', event.error.code, event.error.message);
      }
    });

    return unsubscribe; // Clean up on unmount
  }, []);

  return <>{/* Your app */}</>;
}
```

---

#### `getInitialDeepLink()`

```typescript
getInitialDeepLink(): Promise<WarpLinkDeepLink | null>
```

Get the deep link that launched the app (cold start). Returns `null` if the app was not launched via a deep link.

**Returns:** `Promise<WarpLinkDeepLink | null>` — the resolved deep link, or `null`.

**Behavior:**
- Retrieves the initial URL from the native module, then resolves it via `handleDeepLink()`.
- Only returns a value on cold start — if the app was launched by tapping a WarpLink URL.

**Errors:**

| Error Code | When |
|------------|------|
| `E_NOT_CONFIGURED` | SDK not configured yet |
| `E_INVALID_URL` | URL is not a recognized WarpLink domain |
| `E_LINK_NOT_FOUND` | Link does not exist or is inactive |
| `E_PASSWORD_REQUIRED` | Link is password protected, so it resolves to nothing |
| `E_NETWORK_ERROR` | Network request failed |
| `E_SERVER_ERROR` | API returned a 5xx error |
| `E_DECODING_ERROR` | Response parsing failed |

**Example:**

```tsx
useEffect(() => {
  WarpLink.getInitialDeepLink().then((link) => {
    if (link) {
      console.log('App launched via deep link:', link.destination);
      navigateTo(link.deepLinkUrl ?? link.destination);
    }
  });
}, []);
```

---

## Types

### `WarpLinkConfig`

Configuration options passed to `WarpLink.configure()`.

```typescript
interface WarpLinkConfig {
  apiKey: string;
  apiEndpoint?: string;
  debugLogging?: boolean;
  matchWindowHours?: number;
  linkDomains?: string[];
  onLink?: DeepLinkListener;
  automaticDeepLinks?: boolean;
  automaticDeferredDeepLinks?: boolean;
}
```

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `apiKey` | `string` | Yes | | Your WarpLink **SDK key**, created under **API Keys** > **SDK key** in the dashboard. Must match `wl_live_` or `wl_test_` + 32 alphanumeric characters. An API key satisfies the format check but cannot record installs. |
| `onLink` | `DeepLinkListener` | No | | Single sink for cold-start, warm-start, AND deferred deep links. Providing it enables the opt-out auto-wiring. Disambiguate deferred results via `deepLink.isDeferred`. Native config failures arrive here as `{ error }`. |
| `automaticDeepLinks` | `boolean` | No | `true` | Auto-handle cold + warm start through `onLink`. Only applies when `onLink` is set. |
| `automaticDeferredDeepLinks` | `boolean` | No | `true` | Auto-fire the deferred check from `configure()` and deliver through `onLink`. The check itself runs with or without `onLink`, because it is the install attribution request; `onLink` only decides whether the match is handed back to you. |
| `apiEndpoint` | `string` | No | `"https://api.warplink.app/v1"` | The API endpoint URL. Override for testing or custom deployments. |
| `debugLogging` | `boolean` | No | `false` | Enable debug logging in the native console. |
| `linkDomains` | `string[]` | No | `[]` | Extra hosts that serve your links, on top of `aplnk.to`. Declare your verified custom domain here so links on it resolve on the very first launch and on offline launches. Additive: merged with the domains the SDK fetches. Full URLs are accepted and reduced to their host. See [Custom link domains](#custom-link-domains). |
| `matchWindowHours` | `number` | No | | **Server-side only / deprecated.** The effective match window is set per link in the dashboard (6 hours by default, 24 at most). Accepted for backward compatibility but has no client-side effect. |

#### Custom link domains

The SDK always recognizes `aplnk.to`. It also fetches your organization's
verified custom domains and caches them, but that answer arrives over the
network, and "is this URL mine?" has to be answered the instant a link opens
your app. On a genuinely first launch, or any launch that starts offline, the
fetched list is not there yet and a custom-domain link is handed back to your
app unresolved.

Declaring the domain locally closes that gap. Three places work, and all of them
are merged with each other and with the fetched list:

```tsx
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

The native declarations suit an app whose links can arrive before the
JavaScript bundle has run. Entries are trimmed, lowercased, and reduced to their
host, so `https://Links.YourApp.com/` and `links.yourapp.com` mean the same
thing. `www.` is a different host and is never stripped.

Declaring a domain does not by itself make the operating system open your app
for it. The domain still has to be verified and live in the dashboard, listed in
your iOS Associated Domains entitlement (`applinks:links.yourapp.com`), and
declared in your Android intent filter.

---

### `WarpLinkDeepLink`

Resolved deep link data returned by SDK methods.

```typescript
interface WarpLinkDeepLink {
  linkId: string;
  destination: string;
  deepLinkUrl: string | null;
  customParams: Record<string, unknown>;
  isDeferred: boolean;
  matchType: 'deterministic' | 'probabilistic' | null;
  matchConfidence: number | null;
  matchGuaranteed: boolean;
}
```

| Property | Type | Description |
|----------|------|-------------|
| `linkId` | `string` | The unique identifier of the link. |
| `destination` | `string` | The resolved destination URL. |
| `deepLinkUrl` | `string \| null` | The platform-specific deep link URL (e.g., `myapp://product/123`), if configured on the link. |
| `customParams` | `Record<string, unknown>` | Custom parameters attached to the link. |
| `isDeferred` | `boolean` | Whether this deep link was resolved via deferred attribution. |
| `matchType` | `'deterministic' \| 'probabilistic' \| null` | The type of attribution match. `null` for direct links. |
| `matchConfidence` | `number \| null` | The confidence score (0.0 to 1.0). `null` for direct links. |
| `matchGuaranteed` | `boolean` | `true` only when the match was deterministic. Gate anything sensitive (auto sign-in, showing personal data) on this rather than on a confidence threshold: a probabilistic match is a best guess from a network-shaped fingerprint and can name the wrong user. |

**Working with `customParams`:**

```tsx
const link = await WarpLink.handleDeepLink(url);
if (link) {
  const productId = link.customParams['product_id'] as string | undefined;
  const discount = link.customParams['discount'] as number | undefined;
  if (productId) {
    navigateToProduct(productId, discount);
  }
}
```

---

### `AttributionResult`

Install attribution data returned by `getAttributionResult()`.

```typescript
interface AttributionResult {
  linkId: string;
  matchType: 'deterministic' | 'probabilistic';
  matchConfidence: number;
  matchGuaranteed: boolean;
  isDeferred: boolean;
}
```

| Property | Type | Description |
|----------|------|-------------|
| `linkId` | `string` | The ID of the link that drove the install. |
| `matchType` | `'deterministic' \| 'probabilistic'` | The type of attribution match. Always present (unlike `WarpLinkDeepLink` where it's nullable). |
| `matchConfidence` | `number` | Confidence score (0.0 to 1.0). Always present. |
| `matchGuaranteed` | `boolean` | `true` only when the match was deterministic. Gate anything sensitive (auto sign-in, showing personal data) on this rather than on a confidence threshold: a probabilistic match is a best guess from a network-shaped fingerprint and can name the wrong user. |
| `isDeferred` | `boolean` | Whether this attribution was from a deferred deep link. |

> **Removed in 1.1.0:** the `installId` field. The native serializers never
> emitted it, so it was always `null`.

---

### `DeepLinkEvent`

Discriminated union delivered to `onDeepLink` listeners. Exactly one of `deepLink` or `error` is present.

```typescript
type DeepLinkEvent =
  | { deepLink: WarpLinkDeepLink; error?: undefined }
  | { deepLink?: undefined; error: WarpLinkError };
```

| Property | Type | Description |
|----------|------|-------------|
| `deepLink` | `WarpLinkDeepLink \| undefined` | The resolved deep link, if successful. |
| `error` | `WarpLinkError \| undefined` | The error, if resolution failed. |

**Example:**

```tsx
WarpLink.onDeepLink((event) => {
  if (event.deepLink) {
    // Success
    navigateTo(event.deepLink.destination);
  } else if (event.error) {
    // Error
    console.error(event.error.code, event.error.message);
  }
});
```

---

### `DeepLinkListener`

Type alias for the callback function passed to `onDeepLink()`.

```typescript
type DeepLinkListener = (event: DeepLinkEvent) => void;
```

---

## Error Types

### `WarpLinkError`

Custom error class for all SDK errors. Extends `Error`.

```typescript
class WarpLinkError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string);
}
```

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Always `'WarpLinkError'`. |
| `code` | `ErrorCode` | One of the `ErrorCodes` values. |
| `message` | `string` | Human-readable error message. |

**Example:**

```tsx
import { WarpLinkError, ErrorCodes } from '@warplink/react-native';

try {
  const link = await WarpLink.handleDeepLink(url);
} catch (error) {
  if (error instanceof WarpLinkError) {
    switch (error.code) {
      case ErrorCodes.E_NOT_CONFIGURED:
        console.error('SDK not configured');
        break;
      case ErrorCodes.E_NETWORK_ERROR:
        console.error('Network error — retry later');
        break;
      default:
        console.error(`[${error.code}] ${error.message}`);
    }
  }
}
```

---

### `ErrorCodes`

Constant object containing all error code values.

```typescript
const ErrorCodes = {
  E_NOT_CONFIGURED: 'E_NOT_CONFIGURED',
  E_INVALID_API_KEY_FORMAT: 'E_INVALID_API_KEY_FORMAT',
  E_INVALID_API_KEY: 'E_INVALID_API_KEY',
  E_NETWORK_ERROR: 'E_NETWORK_ERROR',
  E_SERVER_ERROR: 'E_SERVER_ERROR',
  E_INVALID_URL: 'E_INVALID_URL',
  E_LINK_NOT_FOUND: 'E_LINK_NOT_FOUND',
  E_PASSWORD_REQUIRED: 'E_PASSWORD_REQUIRED',
  E_DECODING_ERROR: 'E_DECODING_ERROR',
} as const;
```

| Code | Description |
|------|-------------|
| `E_NOT_CONFIGURED` | SDK not initialized — call `configure()` first. |
| `E_INVALID_API_KEY_FORMAT` | Key doesn't match `wl_(live\|test)_[a-zA-Z0-9]{32}`. |
| `E_INVALID_API_KEY` | Key rejected by server (revoked, incorrect, or an API key instead of an SDK key). |
| `E_NETWORK_ERROR` | Network unreachable or request timed out. |
| `E_SERVER_ERROR` | Server returned a 5xx error. |
| `E_INVALID_URL` | URL is not a recognized WarpLink domain. |
| `E_LINK_NOT_FOUND` | Link slug doesn't exist or is inactive (404). |
| `E_PASSWORD_REQUIRED` | Link is password protected (403), so it resolves to no destination and no platform URLs. |
| `E_DECODING_ERROR` | Malformed or unexpected server response. |

See [Error Handling](error-handling.md) for recommended recovery actions for each code.

---

### `ErrorCode`

Union type of all error code string values.

```typescript
type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
// 'E_NOT_CONFIGURED' | 'E_INVALID_API_KEY_FORMAT' | ... | 'E_DECODING_ERROR'
```

## Related Guides

- [Error Handling](error-handling.md) — recovery actions for each error code
- [Deferred Deep Links](deferred-deep-links.md) — `checkDeferredDeepLink()` in depth
- [Attribution](attribution.md) — match types and confidence scores
