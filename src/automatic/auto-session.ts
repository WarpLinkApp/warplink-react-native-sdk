import type { DeepLinkListener, WarpLinkDeepLink } from '../types';

let autoOnLink: DeepLinkListener | null = null;

/**
 * Which configure() the current auto-wiring belongs to (WL-S07).
 *
 * The automatic dispatches await native calls, so a second configure() can land
 * while one is still in flight. Without this, the abandoned run would deliver
 * its result to the NEW sink, and the new run would then deliver its own: one
 * launch, two dispatches, and the older result arriving after the newer one.
 * Each dispatch captures the generation it started in and stays silent if it is
 * no longer current. iOS does this with applyIfCurrent(generation:) and Android
 * by checking autoHandler identity; this is the same guard for the TS layer.
 */
let autoGeneration = 0;

/** What the running configure() asked for, read by `clearAttribution`. */
export interface SessionReset {
  /** The key is a `wl_test_` key: the only kind a reset acts on. */
  readonly testKey: boolean;
  /** The automatic deferred check is on, so a reset starts a fresh one. */
  readonly restartDeferred: boolean;
}

let sessionReset: SessionReset | null = null;

/**
 * Counts resets. A deferred dispatch captures it when it starts and stays
 * silent if a reset has landed since, so a match fetched before the reset
 * cannot reach `onLink` after it. Separate from the generation on purpose: a
 * reset must not silence a cold-start link that is still resolving.
 */
let resetEpoch = 0;

export function currentResetEpoch(): number {
  return resetEpoch;
}

export function currentSessionReset(): SessionReset | null {
  return sessionReset;
}

/**
 * The last deferred link the sink was given. A Tether code that later resolves
 * a different link is delivered to the sink again, so the app can replace the
 * estimate it routed on. Null before any deferred link, and after a reset.
 */
let routedDeferred: WarpLinkDeepLink | null = null;

export function noteDeferredRoute(link: WarpLinkDeepLink): void {
  routedDeferred = link;
}

export function currentDeferredRoute(): WarpLinkDeepLink | null {
  return routedDeferred;
}

/** Marks every deferred dispatch in flight as stale. */
export function invalidateDeferredDispatches(): void {
  resetEpoch += 1;
  routedDeferred = null;
}

export function currentGeneration(): number {
  return autoGeneration;
}

export function isCurrentGeneration(generation: number): boolean {
  return generation === autoGeneration;
}

/** The sink to deliver to, or null when `generation` has been superseded. */
export function currentSink(generation: number): DeepLinkListener | null {
  return isCurrentGeneration(generation) ? autoOnLink : null;
}

/**
 * Abandons every dispatch in flight and drops the sink: their results belong to
 * a configuration that no longer exists.
 */
export function abandonSession(): void {
  autoGeneration += 1;
  autoOnLink = null;
  sessionReset = null;
  routedDeferred = null;
}

/** Hands the current generation's results to a newer `onLink`, with no new generation. */
export function replaceSink(onLink: DeepLinkListener | null): void {
  if (onLink) {
    autoOnLink = onLink;
  }
}

/**
 * Starts the generation a configure() owns, before any await, so everything it
 * starts is tagged with it and a later configure() invalidates the lot. `onLink`
 * is the sink for that generation, or null when the host wires its own.
 */
export function beginSession(
  onLink: DeepLinkListener | null,
  reset: SessionReset
): number {
  autoGeneration += 1;
  sessionReset = reset;
  if (onLink) {
    autoOnLink = onLink;
  }
  return autoGeneration;
}
