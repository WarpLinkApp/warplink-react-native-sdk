import { SUPERSEDE_WAIT_CEILING_MS, settledWithin } from './waits';

/**
 * The claim counter of the automatic path. Every arrival that reaches the
 * native module takes the next number, so a higher number is a newer tap.
 *
 * A number alone does not decide supersession, because a newer arrival may be
 * a foreign url, and a foreign url supersedes nothing: see isSuperseded.
 *
 * Never reset: a tap still in flight across a reconfigure must never share a
 * number with a new one, the same reason the native tap generations are only
 * ever bumped.
 */
let latestAutoTap = 0;

/**
 * Whether each claimed tap is a tap on a WarpLink link, as its native answer
 * reported it: any answer but E_INVALID_URL.
 *
 * Written from the answer, not from the classification that precedes the claim,
 * and that is NOT the native-faithful choice. Both natives supersede at the
 * newer tap's CLAIM, synchronously (Android bumps `claimToken` inside
 * `claimLocked`, iOS bumps in `supersedeInFlightTap`), because a foreign url
 * never reaches their claim at all.
 *
 * It stays at answer time because two React Native layer contracts are written
 * against the wait that produces: the warplink-17r7 ceiling tests, where a newer
 * tap that never settles must not hang an older tap's delivery for ever, and
 * WL-S04's ordering, where the launch link is decided once a newer warm link
 * ANSWERS and the deferred check follows.
 */
const tapIsLink = new Map<number, boolean>();
/** Claimed taps still resolving, each settled when its native answer arrives. */
const tapSettling = new Map<number, Promise<void>>();
/**
 * Claimed taps whose own answer must never reach the automatic sink, no
 * matter how the resolve turns out: see claimAutoTap. Swept on the same
 * TAP_MEMORY schedule as tapIsLink.
 */
const silentTaps = new Set<number>();
/**
 * How many claims back `tapIsLink` remembers. An older tap still deciding would
 * need this many newer claims inside its own resolve, which the bounded retry
 * ends within about twelve seconds, so answers older than that can go.
 */
const TAP_MEMORY = 100;

/**
 * Claims a tap for the automatic path.
 *
 * EVERY arrival that reaches the native module claims one, whether or not the
 * dedupe window would have delivered it. That native call cancels the older
 * WarpLink request still in flight on both platforms, and the cancellation
 * comes back here as a rejected promise (Android's bridge always has; iOS's does
 * as of warplink-3f0f). Either way the older answer is no longer the host's once
 * the newer arrival turns out to be a link. A foreign url cancels nothing.
 *
 * Claimed BEFORE the resolve, deliberately, so a superseded tap's failure cannot
 * stamp the dedupe window and swallow the answer that arrives milliseconds later.
 *
 * `silent` marks a tap that must never be delivered to the automatic sink,
 * whatever its own resolve turns out to be: it still supersedes an older tap it
 * cancels, but its answer belongs elsewhere. A repeat forced through only for an
 * explicit onDeepLink() subscriber is one (warplink-z07t), and so is a manual
 * resolve, which claims purely to supersede.
 */
export function claimAutoTap(silent = false): number {
  latestAutoTap += 1;
  if (silent) {
    silentTaps.add(latestAutoTap);
  }
  return latestAutoTap;
}

/** The last claim made so far. */
export function latestTap(): number {
  return latestAutoTap;
}

export function isSilentTap(tap: number): boolean {
  return silentTaps.has(tap);
}

/** Whether `tap` is claimed and still waiting on its native answer. */
export function isSettling(tap: number): boolean {
  return tapSettling.has(tap);
}

/**
 * A claimed tap that will never resolve, the launch url's when it turns out
 * foreign or a duplicate. It supersedes nothing and nothing waits on it, which
 * is the same in every way that matters as never having claimed a number.
 */
export function markTapUnused(tap: number): void {
  tapIsLink.set(tap, false);
}

/** Registers `tap` as resolving until `answered` settles. */
export function trackSettling(tap: number, answered: Promise<unknown>): void {
  tapSettling.set(tap, answered.then(() => undefined));
}

/** Records `tap`'s native answer and sweeps claims too old to be waited on. */
export function settleTap(tap: number, isLink: boolean): void {
  tapIsLink.set(tap, isLink);
  tapSettling.delete(tap);
  // Taps settle out of order, so the whole map is swept, not a prefix.
  for (const known of tapIsLink.keys()) {
    if (known <= tap - TAP_MEMORY) {
      tapIsLink.delete(known);
      silentTaps.delete(known);
    }
  }
}

/**
 * Whether `tap` is superseded, when that can be told now. `cutoff` is the last
 * claim made before this tap's own answer arrived. True when a tap in between
 * turned out to be a link, false when none can, undefined while one of them is
 * still resolving.
 */
function supersededNow(tap: number, cutoff: number): boolean | undefined {
  let pending = false;
  for (let newer = tap + 1; newer <= cutoff; newer += 1) {
    if (tapIsLink.get(newer) === true) {
      return true;
    }
    if (tapSettling.has(newer)) {
      pending = true;
    }
  }
  return pending ? undefined : false;
}

/**
 * True when a tap on a WarpLink link, claimed after this one and before this
 * one's own answer arrived, has replaced it, whatever link either was for.
 *
 * Both native SDKs silence any tap that is no longer the newest (Android
 * `AutoLinkHandler`, iOS `open()`), and WL-S27 says a superseded tap never
 * reaches the host. Kept as this layer's own guard rather than retired now that
 * both bridges cancel: an installed native SDK older than warplink-3f0f still
 * delivers the older link itself, and when it answers after the newer one the
 * host would navigate back to the link the user tapped first.
 *
 * Only a WarpLink link supersedes. `tapIsLink` is read from the native ANSWER,
 * so a newer tap still resolving is waited for and the older tap is silenced
 * only once a newer one is known to be a link. Both natives silence at the newer
 * tap's claim instead, with no wait at all, so this wait is a React Native layer
 * artifact kept for the two contracts named on `tapIsLink`.
 *
 * Which newer taps count is fixed at `cutoff`. Both natives decide at the
 * answer, so a link tapped afterwards is a later navigation and cannot silence
 * an answer already given.
 *
 * Every tap in the range settles, because resolveOnce turns every failure into
 * an event, EXCEPT one whose own native promise never answers at all:
 * settledWithin bounds that case, and a tap still pending past the ceiling reads
 * as not-a-link, never as superseding. Bead: warplink-y2v9.
 */
export async function isSuperseded(
  tap: number,
  cutoff: number
): Promise<boolean> {
  const known = supersededNow(tap, cutoff);
  if (known !== undefined) {
    return known;
  }
  const waits: Promise<void>[] = [];
  for (let newer = tap + 1; newer <= cutoff; newer += 1) {
    const settling = tapSettling.get(newer);
    if (settling) {
      waits.push(settling);
    }
  }
  await settledWithin(Promise.all(waits), SUPERSEDE_WAIT_CEILING_MS);
  return supersededNow(tap, cutoff) === true;
}
