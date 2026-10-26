# Changelog

All notable changes to the WarpLink React Native SDK will be documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-10-25

### Added

- **`WarpLink.redeemInvitation(text)`.** Pass the text a person pasted. It
  resolves a `WarpLinkDeepLink` when the text is an invitation that matched, and
  `null` when it is not an invitation. A refused invitation rejects with a
  `WarpLinkError` (code `E_SERVER_ERROR`) whose message tells the person to open
  the link again. A network failure rejects once. The native SDK keeps the
  invitation and tries again on a later launch, a bounded number of times. A
  resumed invitation is delivered through `getAttributionResult()` and
  `claimReferral`, not through `onLink`.
- **`WarpLink.claimReferral(installerId)`.** Claim the referral behind this
  install for the person who just signed up. It resolves a `ReferralClaimResult`
  whose `status` is `claimed`, `flagged`, `ignored` or `none`. Status `none` is
  an answer, not an error. Calling again with the same id returns the same
  claim.
- **Evidence fields on `WarpLinkDeepLink` and `AttributionResult`.**
  `attributionId`, `matchMethod`, `evidenceClass`, `replayState`,
  `capturedParams` and `tappedAt`. A payload from an older native SDK, or a
  value this version does not know, reads as `null` (`{}` for `capturedParams`).
  An unknown value is never read as exact.

### Changed

- **Upgrade note for TypeScript.** `WarpLinkDeepLink` and `AttributionResult`
  now carry the six evidence fields (`attributionId`, `matchMethod`,
  `evidenceClass`, `replayState`, `capturedParams`, `tappedAt`) as required
  properties. Code that only reads these objects needs no change. Code that
  builds them itself, such as test fixtures and mocks, must set all six, using
  `null` for the first four and the last, and `{}` for `capturedParams`.
- The native SDKs this package bridges to are now 1.2.0 on Android and iOS.
- The package reads no clipboard. The host app passes the pasted text.

## [1.1.1] - 2026-10-10

### Changed

- **Rate limits are retried once.** The native SDKs this package bridges to now
  retry a `429` from the link resolve or the attribution match once when its
  `Retry-After` is 5 seconds or less (1 second when the header is unreadable). A
  longer `Retry-After` is not retried. When the call still fails, it rejects with
  a `WarpLinkError` whose code is `E_SERVER_ERROR`. The JavaScript API does not
  change.

### Match guarantee

`matchGuaranteed` is not a credential. Use it, like a confidence threshold, to
pick the destination the attribution result routes to, and keep sign-in and
personal data on your own authentication.

On Android, a deterministic match comes from the Play Install Referrer. On iOS,
the IDFV lookup returns the install the device already has, with that install's
own match type and confidence.

## [1.1.0] - 2026-09-15

Additive, opt-out release. A bare `configure({ apiKey, onLink })` now makes deep
linking, deferred deep linking, and attribution work automatically. Every piece
stays disable-able and all existing manual methods are preserved, so upgrading is
non-breaking.

### Added

- Opt-out configuration: `configure()` gains a single `onLink` sink plus
  `automaticDeepLinks` (default `true`) and `automaticDeferredDeepLinks`
  (default `true`). When `onLink` is provided, cold-start, warm-start, and
  deferred matches are auto-wired into that one callback (disambiguate deferred
  installs via `WarpLinkDeepLink.isDeferred`). A light internal dedupe prevents
  the same source URL from being dispatched twice.
- The deferred deep link check auto-fires from `configure()` and routes its
  result through `onLink`. It fires with or without `onLink`, matching iOS and
  Android: that request is what attributes the install, and the match is
  recorded server-side either way. Pass `automaticDeferredDeepLinks: false` to
  switch it off. With no `onLink` the check runs in the background, so the
  promise returned by `configure()` does not wait on it.
- Custom domain support: the native SDKs this package bridges to now resolve deep
  links on your organization's verified custom domains, fetched when the SDK is
  configured and cached for offline launches, instead of only `aplnk.to`.
- **`linkDomains` configure option:** declare the hosts that serve your links,
  for example `linkDomains: ['links.yourapp.com']`. Optional and additive. The
  fetched domain list arrives over the network, but a link that opens your app
  has to be recognized as yours immediately. Declared domains are known from the
  first line of `configure()`, so custom-domain links resolve on first launch and
  offline, and they are merged with the fetched list. The equivalent no-code
  declarations are a `WarpLinkDomains` array in `Info.plist` on iOS and an
  `<meta-data android:name="app.warplink.DOMAINS" android:value="..." />` entry
  in the Android manifest, both read natively; declaring in several places is
  safe. Entries are trimmed, lowercased and reduced to their host natively
  (`https://Links.YourApp.com/` and `links.yourapp.com` are the same domain);
  `www.` is a real host and is never stripped.
- Attribution requests now carry the host app's identifier (`app_bundle_id` on
  iOS, `app_package_name` on Android), added by the native SDKs this package
  bridges to. An API key is scoped to an organization rather than to one app, so
  an organization shipping more than one app could have an install attributed to
  a sibling app. Nothing to configure and no JavaScript field to pass: the
  native modules read the identifier from the app itself.
- **Reinstall flag:** attribution requests now carry `is_reinstall`, added by
  the native SDKs this package bridges to. It is `true` when the device had
  already completed WarpLink attribution for your app under an earlier install.
  A reinstall is still an install: it is still attributed and still counted, and
  the flag only lets the two be told apart afterwards. The native SDKs decide
  the value from two separate markers, one tied to the install and one tied to
  the device. Nothing to configure and no JavaScript field to pass: the flag is
  reported to the attribution API and is not surfaced to your app.
- **`E_PASSWORD_REQUIRED`:** a named error code for a password protected link.
  Resolving one returns no destination and no platform URLs, because the password
  is checked in the browser and the app never sees it. Earlier versions reported
  that refusal as an invalid API key. Handle it by opening the short URL itself
  with `Linking.openURL`: the password form lives there, and a correct password
  redirects on to the destination. A link on a suspended custom domain reuses the
  existing `E_LINK_NOT_FOUND`, so no second code was added.

### Changed

- **`configure()` now returns a `Promise<void>`** instead of being synchronous
  fire-and-forget. The API key **format** is still validated synchronously, but
  a malformed key no longer throws: it logs a warning, is reported to `onLink` as
  an `{ error }` event with code `E_INVALID_API_KEY_FORMAT`, and leaves the SDK
  unconfigured, matching iOS and Android. The returned promise resolves once native
  configuration (including the automatic cold-start and deferred dispatch)
  completes. A native configuration failure is delivered to `onLink` as an
  `{ error }` event when `onLink` is provided, or rejects the promise when it is
  not.
- **Attribution signals:** attribution requests stop sending `user_agent` and
  screen width/height. The enriched body carries `accept_language` and
  `timezone_offset` (plus the optional `device_id` / IDFV on iOS); the server
  derives the IP and computes the fingerprint hash.
- **Attribution signals:** the body now also carries `timezone`, the IANA zone
  name (read by the native SDKs this package bridges to), alongside `timezone_offset`. The zone name carries more entropy
  than a raw offset and does not shift at a daylight-saving boundary. The offset
  is still sent, and still used, when the server has no zone name for the click.
- **Match guarantee:** a resolved link now exposes `matchGuaranteed`. It is
  `true` only for a deterministic match (a real universal/app link or the install
  referrer) and `false` for a probabilistic one.
- **Match window:** the deferred payload's default lifetime drops from 72 hours
  to 6, with a 24-hour ceiling. The probabilistic tier only. Deterministic
  matches are unaffected.
- **First-launch robustness:** the first-launch marker is split into "attempted"
  vs "completed" and is consumed only on a definitive server response, so an
  offline first launch retries on the next launch. The marker is now scoped to
  one install on both platforms, in storage that neither an uninstall nor a
  restore from backup brings back, so a reinstall always re-runs attribution.
- **The tapped URL's parameters now reach the resolved link.** The native SDKs
  this package bridges to forward the tapped URL's query string when they resolve
  a link, so `WarpLinkDeepLink`'s `destination` and `deepLinkUrl` carry the link's
  UTM and custom parameters exactly as a browser redirect would, and
  `customParams` is the full parameter set on the resolved destination rather
  than an empty object. Nothing to configure and no JavaScript field to pass.
- **Resolved URLs are normalized like redirected ones.** `WarpLinkDeepLink`'s
  `destination` and the platform URLs come back shaped exactly the way the
  redirect path shapes them, so a bare origin arrives carrying its trailing
  slash, and the `customParams` object now includes the query parameters already
  present on the stored destination. Both were always true of a browser redirect.
  This happens on the server, so there is nothing to configure and no JavaScript
  field to pass.
- **In-app opens are now recorded as clicks.** Links an app opens directly
  through verified App Links or Universal Links appear in analytics, alongside
  the redirects that reach the link in a browser, and they count toward your
  plan's click allowance. This is a server-side change, so it applies to 1.0.x
  hosts too, and there is nothing to configure.

### Deprecated

- `matchWindowHours` on `configure()` is deprecated and ignored. The match window is
  server-authoritative (set per link in the dashboard, `match_window_hours`).

### Removed

- The `installId` field on `AttributionResult`. The native serializers never
  emitted it, so it was always `null`.

### Fixed

- **Taps count once.** An OAuth callback or an unrelated custom scheme reaches
  the bridge like any other url. The bridge asks the native SDK whether an
  arriving url is a WarpLink link before it records anything, which is what both
  native SDKs already do for themselves, so a foreign url takes no window,
  claims no tap, supersedes nothing, and is not resolved at all unless an
  explicit `onDeepLink()` subscriber asked for every event. Arrivals are handled
  in the order they arrive, so two taps milliseconds apart still count as one.
- **Attribution retries on the next launch** when the first response carries no
  usable match. A confirmed no-match completes the check. Fixed in the native
  SDKs this package bridges to.
- **A second `configure()` supersedes the first.** Each run is tagged with its
  configuration and stays silent once superseded.
- **Reinstalls are attributed on iOS and Android alike.** The gate lives in
  per-install storage that a delete and a restore from backup both clear. Fixed
  in the native SDKs this package bridges to.
- On Android, an install upgrading from 1.0.x is attributed.
- On iOS, an install upgrading from 1.0.x is reported as a first install. Fixed
  in the native SDKs this package bridges to.
- Android attribution requests on the install referrer path carry the device
  signals.
- `linkDomains` accepts a single string or an array on Android.
- A custom param sent as an explicit JSON null reaches JavaScript as `null`, not
  the string `"null"`, on Android.
- `checkDeferredDeepLink()` resolves with `null` on both platforms when a
  reconfigure abandons the check in flight.

- A URL whose path is not exactly one segment fails with `E_INVALID_URL`.
- **Both native SDK pins point at 1.1.0.**
- A tapped link that fails on a weak connection is retried by the native SDK
  this bridge is built against. Nothing changes in your JavaScript: one tap is
  still one `onLink` event.
- On iOS, a tap arriving after the app was backgrounded is retried by the native
  iOS SDK. Nothing changes in your JavaScript.
- **iOS and Android cancel a superseded tap the same way.** A superseded tap's
  own answer, success or failure, never reaches `onLink`.

## [1.0.2] - 2026-06-26

### Changed

- Version bump only. The JavaScript API and both native bridges are unchanged
  from 1.0.1.

## [1.0.1] - 2026-06-25

### Added

- `engines: { "node": ">=18" }` in `package.json`.

### Fixed

- The README requirements table lists React Native `>= 0.75.0`.

## [1.0.0] - 2026-06-17

### Changed

- First stable release. Promotes the initial API surface to 1.0.0 with semantic
  versioning guarantees. Single TypeScript API bridging to the native iOS and
  Android WarpLink SDKs: `configure()`, `handleDeepLink()`,
  `getInitialDeepLink()`, `onDeepLink()`, `checkDeferredDeepLink()`, and
  `getAttributionResult()`.

## [0.1.1] - 2026-06-07

### Changed

- The podspec now declares the iOS SDK as a Swift Package Manager dependency,
  which React Native 0.75 and later autolink. It was previously left for the
  consuming app to add to its own Xcode project. `peerDependencies` moves to
  React Native `>= 0.75.0`, and the Podfile needs
  `use_frameworks! :linkage => :dynamic`.
- The Android dependency moves to `app.warplink:sdk:0.1.1`, which carries the
  Play Install Referrer attribution fix.
- The explicit Android `sourceDir` is dropped from `react-native.config.js`.

### Fixed

- Both native bridges import the module names the SDKs publish: `WarpLink` and
  `app.warplink.*`.
- `WarpLinkOptions` is built through its initializer on both platforms, in place
  of a mutable-property form on iOS and a `Builder` on Android.
- `matchType` reaches JavaScript as a string.
- A rejected promise carries an `E_*` code mapped from the specific SDK error,
  in place of a single fallback code.
- `addListener` and `removeListeners` are declared on the Android module, which
  `NativeEventEmitter` requires of the module it wraps.

## [0.1.0] - 2026-05-16

### Added

- First published release. One TypeScript API bridging to the native iOS and
  Android WarpLink SDKs: `configure()`, `handleDeepLink()`,
  `getInitialDeepLink()`, `onDeepLink()`, `checkDeferredDeepLink()`,
  `getAttributionResult()`, and `isConfigured()`.
