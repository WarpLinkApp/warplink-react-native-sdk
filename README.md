# @warplink/react-native

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@warplink/react-native.svg)](https://www.npmjs.com/package/@warplink/react-native)
[![CI](https://github.com/WarpLinkApp/warplink-react-native-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/WarpLinkApp/warplink-react-native-sdk/actions/workflows/ci.yml)

Deep linking SDK for React Native — handle Universal Links and App Links, resolve deferred deep links, and attribute installs with [WarpLink](https://warplink.app).

## Requirements

| Requirement | Minimum Version |
|-------------|----------------|
| React Native | >= 0.71.0 |
| React | >= 18.0.0 |
| iOS | 15+ |
| Android | API 26+ (Android 8.0) |
| Node.js | 18+ |

## Installation

### Bare React Native

```bash
npm install @warplink/react-native
```

Then install iOS pods:

```bash
cd ios && pod install
```

Android auto-links via React Native CLI — no additional setup required.

### Expo Managed Workflow

```bash
npx expo install @warplink/react-native
```

Then generate native projects:

```bash
npx expo prebuild
```

> **Note:** This SDK requires native modules and does **not** work with Expo Go. You must use a development build (`npx expo prebuild` or EAS Build).

## Quick Start

```tsx
import { useEffect } from 'react';
import { WarpLink } from '@warplink/react-native';

// Initialize on app startup (outside component — runs once)
WarpLink.configure({ apiKey: 'wl_live_abcdefghijklmnopqrstuvwxyz012345' });

function App() {
  useEffect(() => {
    // Handle warm-start deep links
    const unsubscribe = WarpLink.onDeepLink((event) => {
      if (event.deepLink) {
        console.log('Deep link destination:', event.deepLink.destination);
        // Navigate to event.deepLink.destination
      } else if (event.error) {
        console.error('Deep link error:', event.error.message);
      }
    });

    // Handle cold-start deep link
    WarpLink.getInitialDeepLink().then((link) => {
      if (link) {
        console.log('Cold start deep link:', link.destination);
        // Navigate to link.destination
      }
    });

    // Check for deferred deep link (first launch after install)
    WarpLink.checkDeferredDeepLink().then((link) => {
      if (link?.isDeferred) {
        console.log('Deferred deep link:', link.destination);
        // Navigate to link.deepLinkUrl ?? link.destination
      }
    });

    return unsubscribe;
  }, []);

  return <>{/* Your app */}</>;
}
```

## Features

- **Universal Link & App Link Handling** — resolve incoming deep links to destinations and custom parameters. See the [Integration Guide](docs/integration-guide.md).
- **Deferred Deep Links** — route users to specific content even after App Store or Play Store install. See [Deferred Deep Links](docs/deferred-deep-links.md).
- **Install Attribution** — deterministic and probabilistic matching with confidence scores. See [Attribution](docs/attribution.md).
- **Cross-Platform** — single TypeScript API for both iOS and Android with platform-specific native bridges.
- **No ATT Required** — uses IDFV on iOS (exempt from App Tracking Transparency). No IDFA, no user prompts.
- **Debug Logging** — enable with `{ debugLogging: true }` in configure options to trace SDK behavior.
- **Zero Dependencies** — no third-party runtime dependencies. Only peer dependencies on `react` and `react-native`.

## Documentation

| Guide | Description |
|-------|-------------|
| [Integration Guide](docs/integration-guide.md) | Step-by-step setup from zero to working deep links |
| [API Reference](docs/api-reference.md) | Complete reference for all public types and methods |
| [Deferred Deep Links](docs/deferred-deep-links.md) | How deferred deep linking works and how to use it |
| [Attribution](docs/attribution.md) | Install attribution tiers and confidence scores |
| [Error Handling](docs/error-handling.md) | Every error case with recommended recovery actions |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |
| [Firebase Migration](docs/firebase-migration.md) | Migrate from Firebase Dynamic Links to WarpLink |
| [Architecture](docs/architecture.md) | How the SDK bridges to native iOS and Android SDKs |

## Links

- [WarpLink Dashboard](https://warplink.app)
- [Changelog](CHANGELOG.md)

## License

MIT License. See [LICENSE](LICENSE) for details.
