# Error Handling

The WarpLink React Native SDK uses the `WarpLinkError` class for all error cases. Every error has a `code` property (one of the `ErrorCodes` values) and a human-readable `message`.

## Error Codes

### `E_NOT_CONFIGURED`

**When:** Any SDK method is called before `WarpLink.configure()`.

**Fix:** Call `configure()` at app startup, before any other SDK calls — outside of any React component.

```tsx
import { WarpLink } from '@warplink/react-native';

// Call once at app startup
WarpLink.configure({ apiKey: 'wl_live_yoursdkkeyhere000000000000000000' });
```

---

### `E_INVALID_API_KEY_FORMAT`

**When:** The SDK key passed to `configure()` does not match the expected format: `wl_live_` or `wl_test_` followed by exactly 32 alphanumeric characters.

**Regex:** `/^wl_(live|test)_[a-zA-Z0-9]{32}$/`

**Fix:** Verify your SDK key in the [WarpLink dashboard](https://warplink.app) under **API Keys**. Ensure you're copying the full key.

**Note:** `configure()` does not throw. It logs a warning, reports the error through your `onLink` callback, and leaves the SDK unconfigured. iOS and Android behave the same way.

```tsx
import { WarpLink, ErrorCodes } from '@warplink/react-native';

WarpLink.configure({
  apiKey: 'invalid_key',
  onLink: (event) => {
    if (event.error?.code === ErrorCodes.E_INVALID_API_KEY_FORMAT) {
      console.error('Invalid API key format:', event.error.message);
      return;
    }
    // ...handle the link
  },
});
```

---

### `E_INVALID_API_KEY`

**When:** The server rejects the key (HTTP 401 or 403). The key may be revoked, incorrect, or of the wrong type.

**Fix:**
1. Check that you passed an **SDK key**, not an API key. Install attribution requires an SDK key. An API key cannot record installs, whatever scopes it holds
2. Verify the key is still active in the dashboard under **API Keys**
3. Generate a new one at **API Keys** > **SDK key** if the current one was revoked

**Telltale symptom of the wrong key type:** deep links resolve normally, but no installs appear in your dashboard. Both credentials share the `wl_live_` prefix, so check the key type in the dashboard rather than reading the string.

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
| 401 | Unauthorized | Check the SDK key. Surfaces as `E_INVALID_API_KEY` |
| 403 | Forbidden | A password protected link returns `E_PASSWORD_REQUIRED`, otherwise confirm it is an SDK key, not an API key |
| 404 | Not found | Link doesn't exist. Surfaces as `E_LINK_NOT_FOUND` |
| 429 | Rate limited | Retry after delay |
| 500 | Server error | Retry later, report if persistent |
| 503 | Service unavailable | Retry later |

---

### `E_INVALID_URL`

**When:** A URL passed to `handleDeepLink()` is not a recognized WarpLink domain. The SDK recognizes `aplnk.to` plus your org's verified custom domains, which the native layer fetches from `/sdk/validate` when the SDK is configured and caches for offline launches.

**Fix:** Verify the URL host is `aplnk.to` or one of your verified custom domains. Custom domains must be verified and live in the dashboard.

If a custom-domain link fails only on the first launch after install, or only offline, the fetched list had not arrived yet. Declare the domain locally so it is recognized from the first line of `configure()`: `linkDomains: ['links.yourapp.com']`, a `WarpLinkDomains` array in `Info.plist`, or an `app.warplink.DOMAINS` manifest entry on Android. See [Custom link domains](api-reference.md#custom-link-domains).

Do not pre-filter URLs against a hardcoded host: that discards the custom-domain links the SDK now resolves. Pass the URL straight to `handleDeepLink()` and treat `E_INVALID_URL` as "not a WarpLink URL".

---

### `E_LINK_NOT_FOUND`

**When:** The link slug does not exist, or the link has been deactivated or expired (HTTP 404).

**Fix:**
1. Verify the link exists in the [WarpLink dashboard](https://warplink.app)
2. Check that the link is active (not expired or disabled)
3. Ensure the slug in the URL matches

---

### `E_PASSWORD_REQUIRED`

**When:** The link is password protected (HTTP 403). Resolving it returns no destination and no platform URLs, because the password is checked in the browser and the app never sees it.

**Fix:** Open the short URL itself in a browser. The password form lives there, and a correct password redirects on to the destination.

```tsx
case ErrorCodes.E_PASSWORD_REQUIRED:
  Linking.openURL(tappedUrl);
  break;
```

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
      // SDK key revoked, incorrect, or an API key was passed instead
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

    case ErrorCodes.E_PASSWORD_REQUIRED:
      // Password checked in the browser, never in the app
      Linking.openURL(tappedUrl);
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
