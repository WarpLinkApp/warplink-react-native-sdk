import type { DeepLinkListener } from '../types';

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
}

/**
 * Starts the generation a configure() owns, before any await, so everything it
 * starts is tagged with it and a later configure() invalidates the lot. `onLink`
 * is the sink for that generation, or null when the host wires its own.
 */
export function beginSession(onLink: DeepLinkListener | null): number {
  autoGeneration += 1;
  if (onLink) {
    autoOnLink = onLink;
  }
  return autoGeneration;
}
