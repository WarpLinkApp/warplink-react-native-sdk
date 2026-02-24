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
configure(options: WarpLinkConfig): void
```

Configure the SDK with your API key. Must be called before any other SDK methods.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `options` | `WarpLinkConfig` | Configuration object with API key and optional settings. |

**Behavior:**
- **Synchronous.** Validates the API key format locally. Delegates to the native SDK for async server-side validation.
- Throws `WarpLinkError` with code `E_INVALID_API_KEY_FORMAT` if the key format is invalid.
- Call once at app startup, outside of any React component.

**Example:**

```tsx
import { WarpLink } from '@warplink/react-native';

// Basic configuration
WarpLink.configure({
  apiKey: 'wl_live_abcdefghijklmnopqrstuvwxyz012345',
});

// With options
WarpLink.configure({
  apiKey: 'wl_live_abcdefghijklmnopqrstuvwxyz012345',
  debugLogging: true,
  matchWindowHours: 48,
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
| `E_NETWORK_ERROR` | Network request failed |
| `E_SERVER_ERROR` | API returned a 5xx error |
| `E_INVALID_API_KEY` | API key rejected by server |
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

Check for a deferred deep link on first launch. Returns `null` if no match was found or if this is not the first launch.

**Returns:** `Promise<WarpLinkDeepLink | null>` — the matched deep link with `isDeferred: true`, or `null`.

**Behavior:**
- On first launch: collects device signals, sends them to the attribution API, and returns the match result.
- On subsequent launches: returns `null` (cached result) without a network request.
- The matched deep link has `isDeferred: true` and includes `matchType` and `matchConfidence`.

**Errors:**

| Error Code | When |
|------------|------|
| `E_NOT_CONFIGURED` | SDK not configured yet |
| `E_NETWORK_ERROR` | Network request failed |
| `E_SERVER_ERROR` | API returned a 5xx error |
| `E_INVALID_API_KEY` | API key rejected by server |
| `E_DECODING_ERROR` | Response parsing failed |

**Example:**

```tsx
const link = await WarpLink.checkDeferredDeepLink();
if (link?.isDeferred) {
  const confidence = link.matchConfidence ?? 0;
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

**Returns:** `Promise<AttributionResult | null>` — attribution data, or `null` if no attribution match was found or the data was incomplete.

**Errors:**

| Error Code | When |
|------------|------|
| `E_NOT_CONFIGURED` | SDK not configured yet |
| `E_NETWORK_ERROR` | Network request failed |
| `E_SERVER_ERROR` | API returned a 5xx error |
| `E_INVALID_API_KEY` | API key rejected by server |
| `E_DECODING_ERROR` | Response parsing failed |

**Example:**

```tsx
const attribution = await WarpLink.getAttributionResult();
if (attribution) {
  console.log('Matched link:', attribution.linkId);
  console.log('Match type:', attribution.matchType); // 'deterministic' or 'probabilistic'
  console.log('Confidence:', attribution.matchConfidence);
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
}
```

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `apiKey` | `string` | Yes | — | Your WarpLink API key. Must match `wl_live_` or `wl_test_` + 32 alphanumeric characters. |
| `apiEndpoint` | `string` | No | `"https://api.warplink.app/v1"` | The API endpoint URL. Override for testing or custom deployments. |
| `debugLogging` | `boolean` | No | `false` | Enable debug logging in the native console. |
| `matchWindowHours` | `number` | No | `72` | The match window in hours for deferred deep link attribution. |

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
  isDeferred: boolean;
  installId: string | null;
}
```

| Property | Type | Description |
|----------|------|-------------|
| `linkId` | `string` | The ID of the link that drove the install. |
| `matchType` | `'deterministic' \| 'probabilistic'` | The type of attribution match. Always present (unlike `WarpLinkDeepLink` where it's nullable). |
| `matchConfidence` | `number` | Confidence score (0.0 to 1.0). Always present. |
| `isDeferred` | `boolean` | Whether this attribution was from a deferred deep link. |
| `installId` | `string \| null` | The install identifier, if available. |

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
  E_DECODING_ERROR: 'E_DECODING_ERROR',
} as const;
```

| Code | Description |
|------|-------------|
| `E_NOT_CONFIGURED` | SDK not initialized — call `configure()` first. |
| `E_INVALID_API_KEY_FORMAT` | API key doesn't match `wl_(live\|test)_[a-zA-Z0-9]{32}`. |
| `E_INVALID_API_KEY` | API key rejected by server (revoked or incorrect). |
| `E_NETWORK_ERROR` | Network unreachable or request timed out. |
| `E_SERVER_ERROR` | Server returned a 5xx error. |
| `E_INVALID_URL` | URL is not a recognized WarpLink domain. |
| `E_LINK_NOT_FOUND` | Link slug doesn't exist or is inactive (404). |
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
