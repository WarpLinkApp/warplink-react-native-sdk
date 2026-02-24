# Error Handling

The WarpLink React Native SDK uses the `WarpLinkError` class for all error cases. Every error has a `code` property (one of the `ErrorCodes` values) and a human-readable `message`.

## Error Codes

### `E_NOT_CONFIGURED`

**When:** Any SDK method is called before `WarpLink.configure()`.

**Fix:** Call `configure()` at app startup, before any other SDK calls — outside of any React component.

```tsx
import { WarpLink } from '@warplink/react-native';

// Call once at app startup
WarpLink.configure({ apiKey: 'wl_live_abcdefghijklmnopqrstuvwxyz012345' });
```

---

### `E_INVALID_API_KEY_FORMAT`

**When:** The API key passed to `configure()` does not match the expected format: `wl_live_` or `wl_test_` followed by exactly 32 alphanumeric characters.

**Regex:** `/^wl_(live|test)_[a-zA-Z0-9]{32}$/`

**Fix:** Verify your API key in the [WarpLink dashboard](https://warplink.app) under **Settings > API Keys**. Ensure you're copying the full key.

**Note:** This error is thrown synchronously by `configure()`, not returned as a rejected Promise.

```tsx
import { WarpLink, WarpLinkError, ErrorCodes } from '@warplink/react-native';

try {
  WarpLink.configure({ apiKey: 'invalid_key' });
} catch (error) {
  if (error instanceof WarpLinkError && error.code === ErrorCodes.E_INVALID_API_KEY_FORMAT) {
    console.error('Invalid API key format:', error.message);
  }
}
```

---

### `E_INVALID_API_KEY`

**When:** The server rejects the API key (HTTP 401 or 403). The key may be revoked, expired, or incorrect.

**Fix:**
1. Check that you're using the correct key (live vs. test environment)
2. Verify the key is still active in the dashboard
3. Generate a new key if the current one was revoked

---

### `E_NETWORK_ERROR`

**When:** A network request fails — no internet connectivity, DNS resolution failure, or request timeout.

**Fix:** Retry with exponential backoff. Check device connectivity before retrying.

```tsx
import { WarpLinkError, ErrorCodes } from '@warplink/react-native';

try {
  const link = await WarpLink.handleDeepLink(url);
} catch (error) {
  if (error instanceof WarpLinkError && error.code === ErrorCodes.E_NETWORK_ERROR) {
    // Show offline message or retry
    console.warn('Network error:', error.message);
  }
}
```

---

### `E_SERVER_ERROR`

**When:** The WarpLink API returns a 5xx HTTP status code.

**Fix:** Retry after a delay. If the error persists, check [WarpLink status](https://warplink.app).

#### Server Status Code Reference

| Status Code | Meaning | Action |
|-------------|---------|--------|
| 401 | Unauthorized | Check API key → `E_INVALID_API_KEY` |
| 403 | Forbidden | Check API key permissions |
| 404 | Not found | Link doesn't exist → `E_LINK_NOT_FOUND` |
| 429 | Rate limited | Retry after delay |
| 500 | Server error | Retry later, report if persistent |
| 503 | Service unavailable | Retry later |

---

### `E_INVALID_URL`

**When:** A URL passed to `handleDeepLink()` is not a recognized WarpLink domain. Currently, only the `aplnk.to` domain is recognized.

**Fix:** Verify the URL host before calling `handleDeepLink()`:

```tsx
function isWarpLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.host === 'aplnk.to';
  } catch {
    return false;
  }
}
```

Custom domain support in the SDK is planned for a future release.

---

### `E_LINK_NOT_FOUND`

**When:** The link slug does not exist, or the link has been deactivated or expired (HTTP 404).

**Fix:**
1. Verify the link exists in the [WarpLink dashboard](https://warplink.app)
2. Check that the link is active (not expired or disabled)
3. Ensure the slug in the URL matches

---

### `E_DECODING_ERROR`

**When:** The API response could not be parsed. This may indicate an SDK version mismatch with the API.

**Fix:** Update the SDK to the latest version. If the issue persists, enable `debugLogging` and report the error.

---

## Listener Error Events

When using `onDeepLink()`, errors are delivered via the `DeepLinkEvent` discriminated union:

```tsx
WarpLink.onDeepLink((event) => {
  if (event.deepLink) {
    // Success — navigate to content
    navigateTo(event.deepLink.destination);
  } else if (event.error) {
    // Error — handle gracefully
    handleWarpLinkError(event.error);
  }
});
```

Listener errors occur when the native layer receives a deep link URL but resolution fails (network error, link not found, etc.).

## Complete Error Handling Example

```tsx
import { WarpLink, WarpLinkError, ErrorCodes } from '@warplink/react-native';

function handleWarpLinkError(error: WarpLinkError): void {
  switch (error.code) {
    case ErrorCodes.E_NOT_CONFIGURED:
      // Programming error — configure SDK earlier in app lifecycle
      console.error('WarpLink SDK not configured');
      break;

    case ErrorCodes.E_INVALID_API_KEY_FORMAT:
      // Programming error — check API key format
      console.error('Invalid WarpLink API key format');
      break;

    case ErrorCodes.E_INVALID_API_KEY:
      // API key revoked or incorrect
      showAlert('Authentication error. Please update the app.');
      break;

    case ErrorCodes.E_NETWORK_ERROR:
      // No connectivity or timeout
      showAlert('No internet connection. Please try again.');
      break;

    case ErrorCodes.E_SERVER_ERROR:
      // Server issue — retry later
      showAlert('Server error. Please try again later.');
      break;

    case ErrorCodes.E_INVALID_URL:
      // URL is not a WarpLink URL — ignore or log
      break;

    case ErrorCodes.E_LINK_NOT_FOUND:
      // Link deleted or expired
      showAlert('This link is no longer available.');
      break;

    case ErrorCodes.E_DECODING_ERROR:
      // SDK may be outdated
      showAlert('Please update the app to the latest version.');
      break;
  }
}
```

### Usage with async methods

```tsx
try {
  const link = await WarpLink.handleDeepLink(url);
  if (link) {
    navigateTo(link.destination);
  }
} catch (error) {
  if (error instanceof WarpLinkError) {
    handleWarpLinkError(error);
  }
}
```

### Usage with listeners

```tsx
useEffect(() => {
  const unsubscribe = WarpLink.onDeepLink((event) => {
    if (event.deepLink) {
      navigateTo(event.deepLink.destination);
    } else if (event.error) {
      handleWarpLinkError(event.error);
    }
  });
  return unsubscribe;
}, []);
```

## Related Guides

- [API Reference](api-reference.md) — `WarpLinkError` and `ErrorCodes` documentation
- [Troubleshooting](troubleshooting.md) — common issues and solutions
