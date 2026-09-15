/**
 * What the native `isWarpLinkUrl` answers for the urls these suites use.
 *
 * The TypeScript layer asks the native module whether an arriving url is a
 * WarpLink link before it stamps the dedupe window or claims a tap
 * (warplink-0csz). Every suite therefore needs an answer for that call, and a
 * suite that leaves it unset would classify every link as foreign and go
 * quietly green while delivering nothing.
 *
 * The real check is a known host plus a single-segment path
 * (`UriParser.isWarpLinkUri` on Android, `URL.isWarpLinkUniversalLink` on iOS).
 * Every foreign url in these suites is a custom scheme, an OAuth callback or a
 * private scheme, so the scheme alone separates them. Deliberately not a second
 * copy of the native rule: a test that needs a different accept-set overrides
 * this per test, the way it already overrides `handleDeepLink`.
 *
 * Lives outside `src/` for the same reason `held` does: `src` ships in the npm
 * package, and this belongs to the tests.
 */
export function classifyLikeNative(url: string): Promise<boolean> {
  return Promise.resolve(url.startsWith('https://'));
}
