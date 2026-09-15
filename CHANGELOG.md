# Changelog

All notable changes to the WarpLink React Native SDK will be documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  has to be recognized as yours immediately, so on a first launch (or any launch
  with no network) a custom-domain link used to be handed back to the host app
  unresolved. Declared domains are known from the first line of `configure()`
  and are merged with the fetched list. The equivalent no-code declarations are
  a `WarpLinkDomains` array in `Info.plist` on iOS and an
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
  screen width/height. They never matched between the mobile browser (click) and
  the native app (install), so they only added noise. The enriched body now
  carries only `accept_language` and `timezone_offset` (plus the optional
  `device_id` / IDFV on iOS); the server derives the IP and computes the
  fingerprint hash.
- **Attribution signals:** the body now also carries `timezone`, the IANA zone
  name (read by the native SDKs this package bridges to), alongside `timezone_offset`. The zone name carries more entropy
  than a raw offset and does not shift at a daylight-saving boundary. The offset
  is still sent, and still used, when the server has no zone name for the click.
- **Match guarantee:** a resolved link now exposes `matchGuaranteed`. It is
  `true` only for a deterministic match (a real universal/app link, the install
  referrer, or a device-id match) and `false` for a probabilistic one. Gate
  auto-login, personal data, and anything else you cannot safely show the wrong
  person on this flag, not on the match alone.
- **Match window:** the deferred payload's default lifetime drops from 72 hours
  to 6, with a 24-hour ceiling. The probabilistic tier only. Deterministic
  matches are unaffected. A deferred link that is claimed more than 24 hours
  after the click will no longer match.
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
- **In-app opens are now recorded as clicks.** An app that opens a link directly
  through verified App Links or Universal Links previously produced no click.
  Those opens now appear in analytics, alongside the redirects that reach the
  link in a browser, and they count toward your plan's click allowance. This is a
  server-side change, so it applies to 1.0.x hosts too, and there is nothing to
  configure.

### Deprecated

- `matchWindowHours` on `configure()` is now an inert no-op. The match window is
  server-authoritative (set per link in the dashboard, `match_window_hours`); the
  option is still accepted for backward compatibility but has no client-side
  effect.

### Removed

- The `installId` field on `AttributionResult`. The native serializers never
  emitted it, so it was always `null`.

### Fixed

- **A foreign url between two taps of one link no longer bills the second tap.**
  An OAuth callback or an unrelated custom scheme reaches the bridge like any
  other url, and it used to take the dedupe window the instant it arrived,
  before anything knew what it was. A re-tap of the link tapped just before it
  then read as a fresh navigation: one tap, two resolves, two tap ids, two
  clicks. The bridge now asks the native SDK whether an arriving url is a
  WarpLink link before it records anything, which is what both native SDKs
  already do for themselves, so a foreign url takes no window, claims no tap,
  supersedes nothing, and is not resolved at all unless an explicit
  `onDeepLink()` subscriber asked for every event. Arrivals are handled in the
  order they arrive, so two taps milliseconds apart still count as one.
- **An install is no longer stranded by an unusable attribution response.** The
  deferred check is allowed to run once per install, and any 200 used to spend
  it, including a match that named no link and carried no destination. The
  native SDK was right to discard such a response, but it then never asked
  again, so the install stayed unattributed for good and only a reinstall could
  clear it. It is now retried on the next launch, while a confirmed no-match
  still completes the check as before. Fixed in the native SDKs this package
  bridges to.
- **A second `configure()` no longer double-dispatches.** When one landed while
  the automatic cold-start or deferred check was still awaiting native, the
  abandoned run found the new `onLink` in module state and delivered to it, and
  the new run then delivered its own. One launch produced two events, with the
  older result arriving last. Each run is now tagged with the configuration it
  belongs to and stays silent once superseded, matching the guards the iOS and
  Android SDKs already had.
- **Reinstalls are attributed again on iOS.** Earlier iOS versions kept a single
  first-launch flag in UserDefaults, which a backup restore carries, so a
  restored install read as "attribution already done" and the deferred check
  never ran. An iOS reinstall produced no install and no deferred deep link,
  while the same reinstall on Android produced both. The gate now lives in
  per-install storage that a delete and a restore from backup both clear, so
  both platforms behave identically. In the rare case where that storage cannot
  be written, iOS falls back to UserDefaults, which a restore does carry. Fixed
  in the native SDKs this package bridges to.
- On Android, an install upgrading from 1.0.x is attributed rather than
  skipped. Fixed in the native SDKs this package bridges to. A deferred link
  is delivered only when the Play install began within the last seven days;
  an older referrer is attributed and nothing is routed.
- On iOS, an install upgrading from 1.0.x is now reported as a first install
  instead of a reinstall of an install that was never recorded. The 1.0.x
  UserDefaults keys are removed on the first launch of this version, and the
  1.0.x cached match is not migrated, so `getAttributionResult()` resolves
  `null` for an upgrading user until their next install. Fixed in the native
  SDKs this package bridges to.
- Android attribution requests sent on the install referrer path now carry the
  device signals too, so a referrer naming a deleted link can still match.
- `linkDomains` passed as a single string from JavaScript is read as one domain
  instead of failing `configure()` with `E_SERVER_ERROR`, on Android.
- A custom param sent as an explicit JSON null reaches JavaScript as `null`, not
  the string `"null"`, on Android.
- `checkDeferredDeepLink()` resolves with `null` on both platforms when a
  reconfigure abandons the check in flight. It used to reject on Android only.

- A URL whose path is not exactly one segment is no longer resolved as a link.
  `https://<your-domain>/blog/hello` used to resolve as slug `blog`, which could
  open a completely unrelated destination, since a slug can never contain `/`
  anywhere else in the system. It now fails with `E_INVALID_URL`, so your app can
  route such a URL itself. Fixed in the native SDKs this package bridges to.
- **Both native SDK pins now track the current release.** The published 1.0.x
  line asked for the wrong version on each platform. The podspec requested the
  iOS SDK `upToNextMajorVersion` from `0.1.0`, a range that stops below `1.0.0`,
  and the Android dependency stayed on `app.warplink:sdk:1.0.0`. An app on
  `@warplink/react-native@1.0.2` therefore built against iOS SDK 0.1.0 and
  Android SDK 1.0.0, and carried none of the native 1.0.1 or 1.0.2 changes,
  including the iOS privacy manifest added in 1.0.2. Both pins now point at
  1.1.0.
- A tapped link that fails on a weak connection is retried by the native SDK
  this bridge is built against. Nothing changes in your JavaScript: one tap is
  still one `onLink` event, and a failure still arrives as a `WarpLinkError`
  with `E_NETWORK_ERROR` once the retries are spent.
- On iOS, a tap arriving after the app was backgrounded long enough for its
  connection to die is now retried instead of failing outright. Fixed in the
  native iOS SDK this bridge is built against; nothing changes in your
  JavaScript beyond the tap now succeeding on the retry instead of surfacing
  `E_NETWORK_ERROR`.
- **On iOS, a superseded tap no longer keeps retrying after this layer has
  moved on.** Every tap resolves through the bridge's one native method, and on
  Android that call has always cancelled whatever the bridge's own previous
  call still had on the wire. iOS's bridge did not, so a tap this layer had
  already stopped waiting on could still succeed on the network afterward and
  record a click for a link that was never delivered to `onLink`. iOS now
  cancels the same way Android does. Nothing changes in your JavaScript: a
  superseded tap's own answer, success or failure, still never reaches
  `onLink`.

## [1.0.2] - 2026-06-26

### Changed

- Version bump only. The JavaScript API and both native bridges are unchanged
  from 1.0.1.

## [1.0.1] - 2026-06-25

### Added

- `engines: { "node": ">=18" }` in `package.json`.

### Fixed

- The requirements table in the README said React Native `>= 0.71.0`.
  `peerDependencies` has required `>= 0.75.0` since 0.1.1. The README now
  matches.

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

- Both native bridges import the module names the SDKs publish. The iOS bridge
  imported `WarpLinkSDK` and the Android bridge imported `app.warplink.sdk.*`;
  the published names are `WarpLink` and `app.warplink.*`.
- `WarpLinkOptions` is built through its initializer on both platforms, in place
  of a mutable-property form on iOS and a `Builder` on Android.
- `matchType` reaches JavaScript as a string. Both bridges previously passed the
  native enum through untranslated.
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
