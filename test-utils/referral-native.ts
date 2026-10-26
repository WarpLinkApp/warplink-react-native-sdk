// Shared fixtures for the referral conformance tests (WL-S40 to WL-S47).

/** A bridged deep link payload as the 1.2.0 native SDKs send it. */
export function nativeMatch(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    linkId: 'link-123',
    destination: 'https://example.com/invite',
    deepLinkUrl: 'myapp://invite',
    customParams: { campaign: 'summer' },
    isDeferred: true,
    matchType: 'deterministic',
    matchConfidence: 1,
    matchGuaranteed: true,
    attributionId: 'attr-1',
    matchMethod: 'install_token',
    evidenceClass: 'exact',
    replayState: 'original',
    capturedParams: { utm_source: 'friend' },
    tappedAt: '2026-10-20T10:00:00Z',
    ...overrides,
  };
}

/** A native rejection the way the bridge delivers it. */
export function nativeError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

export const REOPEN_MESSAGE =
  'This invitation cannot be used right now. Open the invitation link again.';
export const PENDING_MESSAGE =
  'We could not confirm this invitation yet. Try again in a minute.';
