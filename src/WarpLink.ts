import {
  NativeEventEmitter,
  type EmitterSubscription,
  type NativeModule,
} from 'react-native';
import NativeWarpLink, { DEEP_LINK_EVENT } from './NativeWarpLink';
import {
  ErrorCodes,
  WarpLinkError,
  type ErrorCode,
  type WarpLinkConfig,
  type WarpLinkDeepLink,
  type AttributionResult,
  type DeepLinkListener,
  type DeepLinkEvent,
} from './types';

function isErrorCode(code: string): code is ErrorCode {
  return Object.values(ErrorCodes).includes(code as ErrorCode);
}

function mapNativeError(error: unknown): WarpLinkError {
  if (error instanceof WarpLinkError) {
    return error;
  }
  if (error instanceof Error) {
    const nativeError = error as Error & { code?: string };
    const code =
      nativeError.code && isErrorCode(nativeError.code)
        ? nativeError.code
        : ErrorCodes.E_SERVER_ERROR;
    return new WarpLinkError(code, nativeError.message);
  }
  return new WarpLinkError(ErrorCodes.E_SERVER_ERROR, String(error));
}

// Boolean flags the native module owns outright. A native SDK older than this
// one omits them from the bridged payload, and absent has to read as false: a
// missing `matchGuaranteed` must not let a host over-trust a probabilistic
// guess. Never derive these in JavaScript.
function deserializeNativeFlag(value: unknown): boolean {
  return Boolean(value);
}

function deserializeDeepLink(raw: unknown): WarpLinkDeepLink | null {
  if (raw == null || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  return {
    linkId: String(obj['linkId'] ?? ''),
    destination: String(obj['destination'] ?? ''),
    deepLinkUrl:
      obj['deepLinkUrl'] != null ? String(obj['deepLinkUrl']) : null,
    customParams:
      obj['customParams'] != null &&
      typeof obj['customParams'] === 'object'
        ? (obj['customParams'] as Record<string, unknown>)
        : {},
    isDeferred: Boolean(obj['isDeferred']),
    matchType: deserializeMatchType(obj['matchType']),
    matchConfidence:
      typeof obj['matchConfidence'] === 'number'
        ? obj['matchConfidence']
        : null,
    matchGuaranteed: deserializeNativeFlag(obj['matchGuaranteed']),
  };
}

function deserializeMatchType(
  value: unknown
): 'deterministic' | 'probabilistic' | null {
  if (value === 'deterministic' || value === 'probabilistic') {
    return value;
  }
  return null;
}

function deserializeAttributionResult(
  raw: unknown
): AttributionResult | null {
  if (raw == null || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const matchType = deserializeMatchType(obj['matchType']);
  if (matchType == null) {
    return null;
  }
  const matchConfidence = obj['matchConfidence'];
  if (typeof matchConfidence !== 'number') {
    return null;
  }

  return {
    linkId: String(obj['linkId'] ?? ''),
    matchType,
    matchConfidence,
    matchGuaranteed: deserializeNativeFlag(obj['matchGuaranteed']),
    isDeferred: Boolean(obj['isDeferred']),
  };
}

const API_KEY_PATTERN = /^wl_(live|test)_[a-zA-Z0-9]{32}$/;

// --- Native deep-link event plumbing (shared by manual + auto-wiring) -------

// A handler receives the raw url plus the result of resolving it ONCE for the
// event, so N registered handlers never trigger N redundant native/server
// resolutions of the same event. `resolved` is null when the url resolved to no
// deep link (nothing to deliver). `generation` is the configure() that was
// current when the url arrived.
type UrlHandler = (
  url: string,
  resolved: DeepLinkEvent | null,
  tap: number | null,
  generation: number
) => void;

let emitter: NativeEventEmitter | null = null;
let nativeSubscription: EmitterSubscription | null = null;
const urlHandlers = new Set<UrlHandler>();

async function resolveOnce(url: string): Promise<DeepLinkEvent | null> {
  try {
    const result = await NativeWarpLink.handleDeepLink(url);
    const deepLink = deserializeDeepLink(result);
    return deepLink ? { deepLink } : null;
  } catch (error) {
    return { error: mapNativeError(error) };
  }
}

/**
 * Ceiling on the link check alone, deliberately far shorter than
 * `SUPERSEDE_WAIT_CEILING_MS`, because the two bound completely different
 * things.
 *
 * A supersede wait covers a native RESOLVE: a network round trip to the
 * WarpLink API with its own bounded retry schedule behind it, which legitimately
 * takes seconds. A link check covers a bridge round trip over a computation that
 * is synchronous on both platforms: `UriParser.isWarpLinkUri` reads a cached set
 * and a path, `URL.isWarpLinkUniversalLink` the same. Nothing in it can be slow.
 * Even on a loaded cold start, with the bridge queue at its worst, that is
 * hundreds of milliseconds, so two seconds is already generous by an order of
 * magnitude.
 *
 * Sharing the 15 s ceiling made a wedged check hold a launch link, and
 * `configure()` with it, for fifteen seconds. Failing open sooner costs only the
 * pre-fix behaviour for that one url: it stamps the window as any url used to,
 * and its own `E_INVALID_URL` still keeps it from reaching the host.
 */
const CLASSIFY_CEILING_MS = 2_000;

/**
 * Whether the native module would treat `url` as a WarpLink link.
 *
 * This layer cannot decide it. The effective link-domain set is the union of
 * `aplnk.to`, what the host declared in code or in the native manifest /
 * Info.plist, and what `/sdk/validate` returned, and only the native SDK holds
 * all three. Both natives ask the same question of themselves before they touch
 * anything: Android `AutoLinkHandler.dispatch` returns on
 * `WarpLink.isWarpLinkUri` before `claimLocked`, iOS `open()` returns on
 * `WarpLink.isWarpLinkURL` before `shouldSuppressDuplicate`.
 *
 * Answers TRUE, failing open, whenever the native module does not answer:
 *
 * - it has no such method (an older native SDK), or the package is not linked
 *   at all, so the call throws where it stands;
 * - it rejects;
 * - it never settles, which `CLASSIFY_CEILING_MS` turns into an answer.
 *
 * False in any of those cases would silence every link on that install, which
 * is far worse than the duplicate this check exists to prevent. True degrades
 * to exactly the behaviour this layer had before the check existed, where a
 * foreign url is found out from its own `E_INVALID_URL` answer.
 *
 * The ceiling is what keeps a wedged native module from being fatal rather than
 * merely wrong. Admission is serialized (see `arrivalQueue`), so an unbounded
 * wait here would stop that one chain for good: every later url unclassified,
 * unresolved and undelivered, and a launch link queued behind it unresolved,
 * which leaves `configure()` itself unsettled. A late answer is not applied
 * retroactively; by then this arrival has already been decided.
 */
async function classifyUrl(url: string): Promise<boolean> {
  let answer: boolean | undefined;
  try {
    const asked = NativeWarpLink.isWarpLinkUrl(url).then(
      (isLink) => {
        answer = isLink;
      },
      () => undefined
    );
    await settledWithin(asked, CLASSIFY_CEILING_MS);
  } catch {
    return true;
  }
  return answer ?? true;
}

/**
 * Every automatic arrival's classify-and-claim step runs on this one chain, in
 * the order the urls arrived.
 *
 * An arrival can no longer decide anything synchronously: whether a url is a
 * WarpLink link is a question for the native module, and the answer is a
 * promise. Left to race, two taps of one link 10 ms apart would both be
 * classified before either had stamped the dedupe window, and both would
 * resolve, which is the duplicate that window exists to suppress. Queued, every
 * arrival decides against the state the previous one left.
 *
 * ONLY that step is queued. The resolve itself is started and left to run,
 * because two resolves overlapping is precisely the case supersession handles.
 */
let arrivalQueue: Promise<unknown> = Promise.resolve();

function enqueueArrival<T>(work: () => Promise<T>): Promise<T> {
  const run = arrivalQueue.then(work, work);
  // The chain outlives any one arrival, so a rejection must not break it for
  // everything queued after. Nothing queued here rejects today (classifyUrl
  // swallows its own failure), which is why this is a guard rather than a
  // behaviour anything depends on.
  arrivalQueue = run.catch(() => undefined);
  return run;
}

function deliverResolved(
  sink: DeepLinkListener,
  resolved: DeepLinkEvent | null
): void {
  if (resolved) {
    sink(resolved);
  }
}

/** True when a host wired onDeepLink() itself, beyond the automatic path. */
function hasExplicitSubscribers(): boolean {
  for (const handler of urlHandlers) {
    if (handler !== autoDispatchUrl) {
      return true;
    }
  }
  return false;
}

function dispatchNativeEvent(event: { url: string }): void {
  // Resolve the url a single time, then fan the shared result to every handler.
  if (urlHandlers.size === 0) {
    return;
  }
  // Everything about the moment of arrival is read HERE, synchronously with the
  // arrival, and carried into admission. Admission now waits on a native round
  // trip first, and each of these would otherwise drift with however long that
  // takes:
  //
  // - the configure() this arrival belongs to (WL-S07), which must be the one
  //   current when the url arrived, not the one current when its classification
  //   or its answer comes back: see autoDispatchUrl;
  // - the clock the dedupe window is measured against, which both natives read
  //   synchronously with the arrival, inside the same call that claims
  //   (`AutoLinkHandler.claimLocked`, `shouldSuppressDuplicate`). Read at
  //   admission, a slow classification pushed both the comparison and the new
  //   stamp later, so a duplicate could measure its way out of the window and
  //   resolve a second time;
  // - whether a host has its own onDeepLink() subscribers, which decides
  //   whether a foreign url is resolved at all and whether a repeat is forced
  //   through.
  const arrival: Arrival = {
    url: event.url,
    at: Date.now(),
    generation: autoGeneration,
    hasSubscribers: hasExplicitSubscribers(),
  };
  void enqueueArrival(() => admitWarmArrival(arrival));
}

/** Everything about an arrival that is true of the moment it arrived. */
type Arrival = {
  url: string;
  at: number;
  generation: number;
  hasSubscribers: boolean;
};

/**
 * Decides what an arriving warm url IS, and only then what to do about it.
 *
 * Runs inside the arrival queue, so everything it reads and writes about the
 * dedupe window is settled before the next arrival looks at it.
 */
async function admitWarmArrival(arrival: Arrival): Promise<void> {
  const { url, at, generation, hasSubscribers } = arrival;
  if (!(await classifyUrl(url))) {
    // A foreign url: an OAuth callback, an unrelated custom scheme, a link on
    // a domain this org does not own. It does not stamp the dedupe window,
    // does not claim a tap, supersedes nothing, and never reaches the
    // automatic sink. That is what both natives do by refusing it before their
    // own claim, and what this layer could not do while it learned a url was
    // foreign only from the answer to resolving it (warplink-0csz).
    //
    // Explicit onDeepLink() subscribers asked for every event and still get
    // this one, unchanged: the native module's own refusal, resolved for them
    // alone. With no such subscriber there is nobody to answer, so nothing is
    // resolved at all.
    if (hasSubscribers) {
      void resolveAndFan(url, null, generation);
    }
    return;
  }
  const fresh = shouldAutoDispatch(url, at);
  // A repeat arrival inside the dedupe window must not reach the native module
  // at all. Resolving it anyway would cancel the tap already in flight, and the
  // host would be handed that cancellation instead of its link. The native
  // SDKs dedupe before the request for the same reason; the TypeScript layer
  // used to dedupe after it.
  //
  // Explicit onDeepLink() subscribers asked for every event, so when any are
  // wired the resolve runs even for a repeat. That call still cancels the tap
  // already in flight, so the repeat claims a tap of its own to supersede it.
  if (!fresh && !hasSubscribers) {
    return;
  }
  // A repeat forced through only for an explicit subscriber is claimed silent
  // (delivered to the subscriber, never to onLink: see claimAutoTap) UNLESS
  // the tap that owns the current dedupe stamp is still resolving. Still in
  // flight, this repeat is standing in for the delivery that tap would have
  // made once superseded, and has to reach onLink the same as any other
  // superseding tap (warplink-8jih). Already answered, onLink already has this
  // navigation's answer, and delivering the repeat's own too would be the
  // second delivery WL-S03 forbids (warplink-z07t).
  const silent =
    !fresh && lastAutoTap !== null && !tapSettling.has(lastAutoTap);
  const tap = claimAutoTap(silent);
  // Only an arrival that (re)stamped the dedupe window owns it. A repeat
  // forwarded solely for an explicit subscriber did not touch the stamp, so
  // its own tap must not be allowed to clear someone else's stamp later.
  if (fresh) {
    lastAutoTap = tap;
  }
  void resolveAndFan(url, tap, generation);
}

async function resolveAndFan(
  url: string,
  tap: number | null,
  generation: number
): Promise<void> {
  const resolved = await (tap === null ? resolveOnce(url) : resolveClaimed(url, tap));
  for (const handler of urlHandlers) {
    handler(url, resolved, tap, generation);
  }
}

function ensureEmitterSubscribed(): void {
  if (!emitter) {
    emitter = new NativeEventEmitter(
      NativeWarpLink as unknown as NativeModule
    );
  }
  if (!nativeSubscription) {
    nativeSubscription = emitter.addListener(
      DEEP_LINK_EVENT,
      dispatchNativeEvent
    );
  }
}

function unsubscribeIfIdle(): void {
  if (urlHandlers.size === 0 && nativeSubscription) {
    nativeSubscription.remove();
    nativeSubscription = null;
  }
}

function subscribeUrlHandler(handler: UrlHandler): () => void {
  urlHandlers.add(handler);
  ensureEmitterSubscribed();
  return () => {
    urlHandlers.delete(handler);
    unsubscribeIfIdle();
  };
}

// --- Auto-wiring state ------------------------------------------------------

let autoOnLink: DeepLinkListener | null = null;
let autoWarmUnsub: (() => void) | null = null;
// Which configure() the current auto-wiring belongs to (WL-S07).
//
// The automatic dispatches await native calls, so a second configure() can land
// while one is still in flight. Without this, the abandoned run would deliver
// its result to the NEW sink, and the new run would then deliver its own: one
// launch, two dispatches, and the older result arriving after the newer one.
// Each dispatch captures the generation it started in and stays silent if it is
// no longer current. iOS does this with applyIfCurrent(generation:) and Android
// by checking autoHandler identity; this is the same guard for the TS layer.
let autoGeneration = 0;
// Light time-boxed dedupe: a single arrival is reconciled once across cold
// start + a warm-start event, but a repeat tap on the same URL after the window
// is a new navigation and dispatches again. Mirrors the iOS (1s) and Android
// (1.5s) SDKs, which track (lastUrl, lastAt) rather than suppressing a URL for
// the app's lifetime.
const DEDUPE_WINDOW_MS = 1500;
let lastAutoUrl: string | null = null;
let lastAutoAt = 0;
// Which tap set the current stamp, so its own failure is the only one allowed
// to clear it: see releaseStampOnFailure.
let lastAutoTap: number | null = null;

/** The sink to deliver to, or null when `generation` has been superseded. */
function isCurrentGeneration(generation: number): boolean {
  return generation === autoGeneration;
}

function currentSink(generation: number): DeepLinkListener | null {
  return isCurrentGeneration(generation) ? autoOnLink : null;
}

function teardownAutoWiring(): void {
  if (autoWarmUnsub) {
    autoWarmUnsub();
    autoWarmUnsub = null;
  }
  // reset() abandons any in-flight dispatch for the same reason configure()
  // does: its result belongs to a configuration that no longer exists.
  autoGeneration += 1;
  autoOnLink = null;
  lastAutoUrl = null;
  lastAutoAt = 0;
  lastAutoTap = null;
  // The tap counters are deliberately NOT reset. A tap still in flight across a
  // reconfigure must never share a number with a new one, the same reason the
  // native tap generations are only ever bumped.
}

// Records the URL and returns true when it should dispatch; returns false when
// it repeats the previous arrival within DEDUPE_WINDOW_MS.
//
// Only ever called for a url the native module has already classified as a
// WarpLink link. A foreign url must never reach this function, because the
// stamp it would leave is the whole of warplink-0csz: both natives refuse a
// foreign url before their own claim, so their window still holds the last
// real link. See admitWarmArrival and admitLaunchUrl.
//
// `at` is when the url ARRIVED, not when this runs. On both natives those are
// the same instant, because each reads its clock inside the call that claims
// (`AutoLinkHandler.claimLocked`, `shouldSuppressDuplicate`). They came apart
// here once classification put a native round trip in front of admission, and
// reading the clock here instead moved both the comparison and the new stamp
// later by however long that took, so a duplicate could measure its way out of
// the window and resolve a second time.
//
// The window is checked as a RANGE, not a bare `<`. Date.now() is wall clock
// and can move backwards when NTP corrects a drifted device or the user edits
// the date. The elapsed subtraction then goes negative, and a bare `<` reads
// every negative value as "inside the window", so repeat taps on a link are
// swallowed until the clock catches up. The lower bound turns a backward step
// into a fresh arrival, which is the safe direction: dispatching twice is
// recoverable, silently dropping a navigation is not.
//
// The native SDKs use a monotonic clock instead (Android elapsedRealtime, iOS
// systemUptime). The JS layer has no clock that is monotonic across every
// supported React Native runtime, so it guards the arithmetic instead.
function shouldAutoDispatch(url: string, at: number): boolean {
  const elapsed = at - lastAutoAt;
  if (url === lastAutoUrl && elapsed >= 0 && elapsed < DEDUPE_WINDOW_MS) {
    return false;
  }
  lastAutoUrl = url;
  lastAutoAt = at;
  return true;
}

// The claim counter of the automatic path. Every arrival that reaches the
// native module takes the next number, so a higher number is a newer tap.
//
// A number alone does not decide supersession, because a newer arrival may be
// a foreign url, and a foreign url supersedes nothing: see isSuperseded.
//
// Never reset, like the native tap generations: a tap still in flight across a
// reconfigure must never share a number with a new one.
let latestAutoTap = 0;
/**
 * Whether each claimed tap is a tap on a WarpLink link, as its native answer
 * reported it: any answer but E_INVALID_URL.
 *
 * Written from the answer, not from the classification that now precedes the
 * claim, and that is NOT the native-faithful choice.
 *
 * Both natives supersede at the newer tap's CLAIM, synchronously: Android bumps
 * `claimToken` inside `claimLocked` (`AutoLinkHandler.kt:191-205`), iOS bumps in
 * `supersedeInFlightTap` inside `open()`. Neither waits to learn what the newer
 * tap is, because a foreign url never reaches their claim at all; the older tap
 * simply finds itself superseded when its own answer arrives. Classification
 * gives this layer the same guarantee, so claim time is available here too, and
 * it is where this belongs.
 *
 * It stays at answer time because two React Native layer contracts are written
 * against the wait that produces: the warplink-17r7 ceiling tests (#318), where
 * a newer tap that never settles must not hang an older tap's delivery for
 * ever, and WL-S04's ordering, where the launch link is decided once a newer
 * warm link ANSWERS and the deferred check follows. Moving it belongs with the
 * 1.2 bead that delegates the automatic path to native, which retires both.
 */
const tapIsLink = new Map<number, boolean>();
/** Claimed taps still resolving, each settled when its native answer arrives. */
const tapSettling = new Map<number, Promise<void>>();
/**
 * How many claims back `tapIsLink` remembers. An older tap still deciding would
 * need this many newer claims inside its own resolve, which the bounded retry
 * ends within about twelve seconds, so answers older than that can go.
 */
const TAP_MEMORY = 100;
/**
 * Claimed taps whose own answer must never reach the automatic sink, no
 * matter how the resolve turns out: see claimAutoTap. Swept on the same
 * TAP_MEMORY schedule as tapIsLink, since neither is needed once a claim this
 * far back could still be waited on.
 */
const silentTaps = new Set<number>();

/**
 * Claims a tap for the automatic path.
 *
 * EVERY arrival that reaches the native module claims one, whether or not the
 * dedupe window would have delivered it. That native call cancels the older
 * WarpLink request still in flight on both platforms, and the cancellation
 * comes back here as a rejected promise: Android's bridge always has (shared
 * `resolveDeepLink`), and iOS's bridge does too as of warplink-3f0f, which
 * fixed a superseded tap retrying on the wire for its whole budget and able to
 * bill a link this layer had already moved past. Either way the older answer
 * is no longer the host's once the newer arrival turns out to be a link. A
 * foreign url cancels nothing on either platform.
 *
 * Claimed BEFORE the resolve, deliberately. The window used to be checked when
 * the answer came back, which meant a superseded tap's failure could stamp it
 * and swallow the answer that arrived milliseconds later.
 *
 * `silent` marks a tap that must never be delivered to the automatic sink,
 * whatever its own resolve turns out to be: it still supersedes an older tap
 * it cancels, exactly like any other claim, but its answer belongs elsewhere.
 * A repeat forced through only for an explicit onDeepLink() subscriber is one
 * such tap (warplink-z07t); other callers that need a claim purely to
 * supersede, without asking the automatic path to deliver anything, reuse the
 * same flag.
 */
function claimAutoTap(silent = false): number {
  latestAutoTap += 1;
  if (silent) {
    silentTaps.add(latestAutoTap);
  }
  return latestAutoTap;
}

/**
 * Settles the dedupe stamp once `tap`'s own native answer is known, while
 * `tap` still owns it.
 *
 * A failed resolve of a real link is not a duplicate to suppress: both native
 * SDKs drop their own claim on a failure, so a user's own re-tap inside the
 * window reaches the native module instead of being swallowed by the cached
 * failure for the rest of it. Mirrors Android `AutoLinkHandler.settle`
 * (`lastUri = null` for a failed current claim) and iOS
 * `releaseDuplicateClaim` (`WarpLink+Supersede.swift`). A url that resolved as
 * a genuine link (`code === undefined`: success, or a no-match) leaves the
 * stamp exactly as `tap` set it.
 *
 * E_INVALID_URL is no longer a case of its own. A foreign url cannot reach a
 * claim any more, because it is classified before anything is stamped
 * (admitWarmArrival, warplink-0csz). So a CLAIMED tap answering E_INVALID_URL
 * means the classification and the resolve disagreed: the known-domain set
 * changed between the two native calls, or the native module was too old to
 * classify and this layer assumed a link (classifyUrl). Clearing the stamp is
 * the right answer to both, exactly as for any other failure, because nothing
 * was delivered and the user's own re-tap must reach the native module.
 *
 * Guarded on ownership either way: a re-tap of the same url past the window,
 * or a tap on a different url, claims a fresh stamp before this one's answer
 * arrives; touching it then would undo the newer tap's own protection instead
 * of this tap's. Mirrors `releaseDuplicateClaim`'s own URL-equality guard in
 * `WarpLink+Supersede.swift`.
 */
function releaseStampOnFailure(tap: number, resolved: DeepLinkEvent | null): void {
  const code = resolved?.error?.code;
  if (code === undefined) {
    return;
  }
  if (tap !== lastAutoTap) {
    return;
  }
  lastAutoUrl = null;
  lastAutoAt = 0;
  lastAutoTap = null;
}

/**
 * Resolves a claimed tap, and records whether the native module treated it as
 * a WarpLink link: any answer but E_INVALID_URL, a failure included. Called
 * synchronously at the claim, so an older tap sees the newer one as pending
 * from the moment it exists.
 */
function resolveClaimed(url: string, tap: number): Promise<DeepLinkEvent | null> {
  const resolving = resolveOnce(url).then((resolved) => {
    tapIsLink.set(tap, resolved?.error?.code !== ErrorCodes.E_INVALID_URL);
    releaseStampOnFailure(tap, resolved);
    tapSettling.delete(tap);
    // Taps settle out of order, so the whole map is swept, not a prefix.
    for (const known of tapIsLink.keys()) {
      if (known <= tap - TAP_MEMORY) {
        tapIsLink.delete(known);
        silentTaps.delete(known);
      }
    }
    return resolved;
  });
  tapSettling.set(tap, resolving.then(() => undefined));
  return resolving;
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
 * This used to be scoped to one url, on the reasoning that taps on two
 * different links are two navigations. Neither native SDK agrees: both silence
 * any tap that is no longer the newest (Android `AutoLinkHandler`, iOS
 * `open()`), and WL-S27 says a superseded tap never reaches the host. Scoped to
 * one url, the older tap's answer reached the host anyway. On Android that
 * answer is the cancellation the newer resolve caused, an E_NETWORK_ERROR for a
 * network that never failed. Before warplink-3f0f, iOS's bridge cancelled
 * nothing, so the older link itself arrived, and when it answered after the
 * newer one the host navigated back to the link the user tapped first. Kept as
 * this layer's own guard rather than retired now that both bridges cancel: an
 * installed native SDK older than the fix still behaves the pre-3f0f way.
 *
 * Only a WarpLink link supersedes. Both natives refuse a foreign url, an OAuth
 * callback or a custom scheme, before it can claim anything, and since
 * warplink-0csz this layer refuses one at the same point, so a claimed tap is
 * a foreign url only when the classification and the resolve disagreed, or
 * when the native module was too old to classify at all (see classifyUrl).
 * `tapIsLink` is nevertheless read from the native ANSWER rather than from that
 * classification, so a newer tap still resolving is waited for and the older
 * tap is silenced only once a newer one is known to be a link. Both natives
 * silence at the newer tap's claim instead, with no wait at all, so this wait
 * is a React Native layer artifact rather than the native contract. It is kept
 * because two contracts here depend on it: see `tapIsLink`.
 *
 * Which newer taps count is fixed at `cutoff`, the last claim made before this
 * tap's own answer arrived. Both natives decide at that answer, so a link
 * tapped afterwards is a later navigation and cannot silence an answer already
 * given. Two links that do not overlap are two navigations for the same reason.
 *
 * Bead: warplink-y2v9.
 */
/**
 * Ceiling on a wait that is really a wait on a native RESOLVE, so a resolve
 * that never answers cannot hang something the host is waiting on.
 *
 * Two waits are bounded by it:
 * - `isSuperseded`, on a newer tap still resolving, so one that never answers
 *   cannot hang an older tap's delivery to `onLink`. This hazard predates
 *   warplink-17r7 (a stuck automatic or forced-repeat tap could already trigger
 *   it), but that fix newly reaches it through the public `handleDeepLink` /
 *   `getInitialDeepLink` API: nothing bounds how long a host's own native call
 *   may take to answer.
 * - `arrivalsSettled`, on urls that arrived before an answer but have not been
 *   classified yet. A backstop rather than the real bound: every classification
 *   in that queue is itself capped at `CLASSIFY_CEILING_MS`, so the queue drains
 *   in time proportional to its depth without this ever being reached.
 *
 * The link check has its own, much shorter ceiling. It is not a resolve and
 * nothing about it is slow: see `CLASSIFY_CEILING_MS`.
 *
 * Derived from the native retry schedule (`RetrySettings`, `RetryPolicy.kt`):
 * three attempts of 4s, 3s and 3s sum to 10s, the longest a single WarpLink
 * resolve's own per-attempt timeouts add up to. `RetrySettings.totalBudgetMs`
 * (12s) is a separate, independent cap checked before each retry, not the
 * sum of the three attempts, so it does not raise this figure. This constant
 * adds a margin on top of that 10s for the waits between attempts and for
 * this layer having no visibility into that schedule (a manual resolve is
 * one native call, not the bounded retry itself).
 *
 * Passing it decides one thing once, and never rewrites what has already
 * happened. A newer tap still unsettled is treated as NOT a link for that one
 * supersede decision, and its own eventual answer still settles
 * `tapSettling`/`tapIsLink` normally.
 */
const SUPERSEDE_WAIT_CEILING_MS = 15_000;

/**
 * Resolves when `settled` does, or once `ceilingMs` has passed, whichever is
 * first. Clears its own timer on the settle path so a wait that DOES answer
 * promptly leaves nothing pending afterward: in Jest that is the difference
 * between a clean test and one that hangs the process on an open handle.
 *
 * The ceiling is a parameter rather than the constant it started as, because
 * the two things waited on here are not the same size: a native resolve takes
 * seconds, a link check takes milliseconds. Every call names which it means.
 */
function settledWithin(
  settled: Promise<unknown>,
  ceilingMs: number
): Promise<void> {
  return new Promise((resolve) => {
    const ceiling = setTimeout(resolve, ceilingMs);
    void settled.then(() => {
      clearTimeout(ceiling);
      resolve();
    });
  });
}

/**
 * Waits until every url that reached this layer before now has been classified
 * and, if it is a link, has claimed its tap.
 *
 * `cutoff` means "the last claim made before this tap's own answer arrived",
 * and a claim used to be synchronous with the arrival, so reading
 * `latestAutoTap` at the answer was enough. Classification is a native round
 * trip, so a url the user tapped BEFORE this answer can still be waiting to be
 * classified when the answer lands. Read at that moment, `latestAutoTap` would
 * miss it, and this older tap would deliver an answer the newer tap has already
 * superseded: on Android, the cancellation that newer resolve caused, an
 * E_NETWORK_ERROR for a network that never failed (warplink-8jih).
 *
 * The queue tail is read once, at the answer. Anything appended after that
 * arrived after the answer, and a later navigation cannot silence an answer
 * already given.
 *
 * Bounded by the supersede ceiling as a backstop. The real bound is
 * `CLASSIFY_CEILING_MS` on each classification in the queue, so this drains in
 * time proportional to the queue's depth and the backstop is not reached in any
 * case that has been reasoned about.
 */
function arrivalsSettled(): Promise<void> {
  return settledWithin(arrivalQueue, SUPERSEDE_WAIT_CEILING_MS);
}

async function isSuperseded(tap: number, cutoff: number): Promise<boolean> {
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
  // Every tap in the range settles, because resolveOnce turns every failure
  // into an event, EXCEPT one whose own native promise never answers at all:
  // settledWithin bounds that case. Once either the wait or the
  // ceiling wins, supersededNow re-reads the (possibly still incomplete)
  // state: a tap still pending past the ceiling reads as not-a-link, never
  // as superseding.
  await settledWithin(Promise.all(waits), SUPERSEDE_WAIT_CEILING_MS);
  return supersededNow(tap, cutoff) === true;
}

// Narrows a resolved event to what the automatic path should deliver, or null
// when there is nothing to deliver. `cutoff` is the last claim made before the
// answer arrived; see isSuperseded.
async function autoEventFor(
  tap: number | null,
  cutoff: number,
  resolved: DeepLinkEvent | null
): Promise<DeepLinkEvent | null> {
  // A repeat arrival inside the dedupe window, or a foreign url resolved for
  // an explicit subscriber alone. Neither claimed a tap, and neither is this
  // path's to deliver.
  if (tap === null) {
    return null;
  }
  // Claimed only to supersede an older tap, never to deliver: see claimAutoTap.
  if (silentTaps.has(tap)) {
    return null;
  }
  // A CLAIMED tap that still answers E_INVALID_URL: the classification and the
  // resolve disagreed, or the native module was too old to classify at all
  // (classifyUrl). The automatic path drops it rather than reporting a
  // spurious error to the host, mirroring the foreign-URL guards in the native
  // SDKs. Explicit onDeepLink() subscribers still receive it unchanged.
  // Checked first, so such a tap never waits.
  if (resolved?.error?.code === ErrorCodes.E_INVALID_URL) {
    return null;
  }
  // A tap a newer link replaced, whatever its own link.
  if (await isSuperseded(tap, cutoff)) {
    return null;
  }
  return resolved;
}

function autoDispatchUrl(
  _url: string,
  resolved: DeepLinkEvent | null,
  tap: number | null,
  generation: number
): void {
  // Only the configure() the tap arrived under may receive its answer (WL-S07),
  // the rule the cold and deferred paths already follow. A new configure()
  // registers this same handler again, so without the check an answer that
  // crossed one was handed to the new onLink. iOS stays silent there too: its
  // configure() cancels the tap in flight (`supersedeInFlightTap`). Bead:
  // warplink-4uzm.
  //
  // Checked once, as the answer arrives, and not again after the waits below.
  // Both natives decide a tap at its answer, so an answer that arrived under
  // this configure() belongs to its onLink even if a later configure() lands
  // while the tap waits on a newer url.
  const sink = currentSink(generation);
  if (!sink) {
    return;
  }
  // Only a claim made before this answer can supersede it, so every url that
  // arrived before it has to have been classified first: see arrivalsSettled.
  void arrivalsSettled()
    .then(() => autoEventFor(tap, latestAutoTap, resolved))
    .then((event) => {
      deliverResolved(sink, event);
    });
}

/** The launch link's event, and the onLink it belongs to. */
type LaunchDelivery = {
  event: DeepLinkEvent | null;
  sink: DeepLinkListener | null;
};

// Resolves the launch url under the tap configure() claimed for it, and returns
// the event the automatic path should deliver with the sink it belongs to. The
// caller invokes the host sink so a throwing handler is never re-entered.
//
// The sink is the one current the moment resolveClaimed's answer arrives,
// taken before the waits below. Both natives decide a tap at its answer
// (autoDispatchUrl, WL-S07), so a second configure() landing while this one
// still waits on arrivalsSettled/isSuperseded to learn whether a newer url
// superseded it must not take the link away. Taken after those waits instead,
// it did, and nothing recovers that link: the launch url is handed out once
// (iOS takePendingURL, Android InitialUrlBuffer.settle). Bead: warplink-5q3f.
//
// Awaited in full, even while a newer tap is still resolving, because on React
// Native the launch link is ordered, not raced (WL-S04): it is decided before
// the deferred check starts and before configure() resolves, and a throw from
// onLink leaves through configure(). Handed off to the background instead, it
// reached the host after the deferred link, after configure() had resolved, and
// a throw became an unhandled rejection. The wait covers only taps claimed
// before the launch link answered, so it ends with the slowest of those.
async function resolveForAutoDispatch(
  url: string,
  tap: number,
  generation: number
): Promise<LaunchDelivery> {
  // Read here, where the launch url became known, and not inside the queued
  // work, which runs behind however many warm arrivals and native round trips
  // are ahead of it: see shouldAutoDispatch.
  const at = Date.now();
  if (!(await enqueueArrival(() => admitLaunchUrl(url, at, tap)))) {
    return { event: null, sink: null };
  }
  const resolved = await resolveClaimed(url, tap);
  const sink = currentSink(generation);
  await arrivalsSettled();
  const event = await autoEventFor(tap, latestAutoTap, resolved);
  return { event, sink };
}

/**
 * The launch url's own classify-and-claim step, queued behind every warm
 * arrival so the two cannot both stamp the window for one url. Answers whether
 * the launch url is to be resolved at all.
 *
 * Its tap number is taken by configure(), before this runs and deliberately:
 * the launch url arrived before anything this configure() will hear, so its
 * number has to be lower than any warm tap claimed while the native side is
 * still configuring. A launch url that turns out foreign therefore leaves that
 * number unused. An unused number supersedes nothing and nothing waits on it,
 * which is the same in every way that matters as never having claimed one.
 */
async function admitLaunchUrl(
  url: string,
  at: number,
  tap: number
): Promise<boolean> {
  if (!(await classifyUrl(url)) || !shouldAutoDispatch(url, at)) {
    // The tap configure() claimed goes unused, foreign or duplicate alike. It
    // never resolves, so it never delivers, so it must never silence an older
    // tap. Recorded as not-a-link rather than simply left absent, which reads
    // the same to `supersededNow` but says nothing to a reader.
    tapIsLink.set(tap, false);
    return false;
  }
  // This arrival just (re)stamped the dedupe window, so its own tap is the one
  // allowed to release it on failure: see releaseStampOnFailure. What the tap
  // turns out to BE is still recorded from its native answer, in
  // `resolveClaimed`, exactly like every other claim.
  lastAutoTap = tap;
  return true;
}

function buildNativeConfig(options: WarpLinkConfig): Record<string, unknown> {
  const config: Record<string, unknown> = {
    apiKey: options.apiKey,
  };
  if (options.apiEndpoint !== undefined) {
    config['apiEndpoint'] = options.apiEndpoint;
  }
  if (options.debugLogging !== undefined) {
    config['debugLogging'] = options.debugLogging;
  }
  // Forwarded verbatim, deliberately. Normalizing here would make a third
  // dialect that can drift from the two native ones, and the native SDKs have
  // to normalize anyway for the domains declared in Info.plist / the Android
  // manifest, which never pass through JavaScript.
  if (options.linkDomains !== undefined) {
    config['linkDomains'] = options.linkDomains;
  }
  // matchWindowHours is intentionally NOT forwarded: the match window is
  // server-side (per link in the dashboard) and the native SDKs no longer
  // accept the option. The deprecated config field is kept as a no-op so
  // existing integrations keep compiling.
  return config;
}

async function dispatchColdStartLink(
  generation: number,
  tap: number
): Promise<void> {
  let delivery: LaunchDelivery = { event: null, sink: null };
  try {
    const url = await NativeWarpLink.getInitialURL();
    if (url != null) {
      delivery = await resolveForAutoDispatch(url, tap, generation);
    }
  } catch (error) {
    delivery = { event: { error: mapNativeError(error) }, sink: currentSink(generation) };
  }
  // The host callback runs outside the try so an exception it throws
  // propagates instead of being caught and handed back to that same
  // callback as a fabricated WarpLink error.
  const { event, sink } = delivery;
  if (event && sink) {
    sink(event);
  }
}

async function dispatchDeferredLink(generation: number): Promise<void> {
  let event: DeepLinkEvent | null = null;
  try {
    // At-most-once: the native checkDeferredDeepLink returns the cached match
    // on every call, so dispatching its result on every configure() would
    // re-fire the deferred link each launch. Only auto-dispatch while the
    // check has not yet definitively completed, matching the native iOS/
    // Android auto-dispatch guard. The manual checkDeferredDeepLink() still
    // returns the cached match for advanced callers.
    const alreadyComplete = await NativeWarpLink.isAttributionComplete();
    if (!alreadyComplete) {
      const result = await NativeWarpLink.checkDeferredDeepLink();
      const deepLink = deserializeDeepLink(result);
      if (deepLink) {
        event = { deepLink };
      }
    }
  } catch (error) {
    event = { error: mapNativeError(error) };
  }
  // Host callback outside the try: see dispatchColdStartLink.
  const sink = currentSink(generation);
  if (event && sink) {
    sink(event);
  }
}

async function finishConfigure(
  config: Record<string, unknown>,
  wantDeepLinks: boolean,
  wantDeferred: boolean,
  generation: number,
  coldTap: number | null
): Promise<void> {
  try {
    await NativeWarpLink.configure(config);
  } catch (error) {
    const err = mapNativeError(error);
    // Route the native config failure to onLink when auto-wiring is on;
    // otherwise reject so an awaiting caller sees it. Never a bare
    // unhandled rejection.
    const sink = currentSink(generation);
    if (sink) {
      sink({ error: err });
      return;
    }
    // Superseded mid-flight: a later configure() owns the SDK now, so this
    // failure is not the caller's to act on and must not reach the new sink.
    if (generation !== autoGeneration) {
      return;
    }
    throw err;
  }

  try {
    if (wantDeepLinks && coldTap !== null && currentSink(generation)) {
      await dispatchColdStartLink(generation, coldTap);
    }
  } finally {
    // The deferred check runs even when the cold-start host callback threw
    // (routine in React Native when the navigation container is not mounted
    // yet). Skipping it would mean no attribution request for this launch.
    // A throw from the deferred dispatch's own host callback still
    // propagates; when both throw it is the one configure() rejects with.
    if (wantDeferred && isCurrentGeneration(generation)) {
      // With a sink, await so a host callback throw still rejects configure().
      // Without one there is nothing to deliver, so fire and forget. Awaiting
      // would block configure() on a full attribution round trip.
      if (currentSink(generation)) {
        await dispatchDeferredLink(generation);
      } else {
        void dispatchDeferredLink(generation);
      }
    }
  }
}

export const WarpLink = {
  /**
   * Initialize the SDK. With a bare `configure({ apiKey, onLink })`,
   * cold-start, warm-start, and deferred deep links are all wired
   * automatically and funneled into `onLink`. Disable any piece with
   * `automaticDeepLinks: false` / `automaticDeferredDeepLinks: false`,
   * or omit `onLink` to wire the deep link callbacks yourself.
   *
   * Omitting `onLink` does not switch off install attribution: the deferred
   * check still fires, because that request is what attributes the install.
   * Use `automaticDeferredDeepLinks: false` to switch it off.
   *
   * The API key format is validated synchronously — an invalid key
   * reports a `WarpLinkError` (`E_INVALID_API_KEY_FORMAT`) through `onLink`
   * and leaves the SDK unconfigured, before any
   * async work starts. Native/server configuration happens
   * asynchronously; the returned promise resolves once configuration
   * (and any auto cold-start + deferred dispatch into `onLink`) completes.
   * When a newer tap arrives while the launch link is still resolving, it
   * also waits for that tap's answer, which decides whether the launch link
   * is still the one to deliver.
   * With no `onLink` there is nothing to dispatch, so the deferred check
   * runs in the background and the promise does not wait on it.
   *
   * Native configuration errors are delivered to `onLink` as an
   * `{ error }` event when auto-wiring is on, or reject the returned
   * promise when `onLink` is not provided.
   *
   * An exception thrown by your own `onLink` is never handed back to it as
   * a fabricated error; it propagates out of the returned promise. The
   * automatic deferred check still runs when a cold-start dispatch throws.
   *
   * A malformed key is reported through `onLink` and logged; it does not throw.
   * @returns Promise that resolves when configuration completes.
   *
   * @example
   * ```ts
   * // Opt-out model — everything works with one call:
   * WarpLink.configure({
   *   apiKey: 'wl_live_...',
   *   onLink: ({ deepLink, error }) => {
   *     if (deepLink) navigate(deepLink.deepLinkUrl ?? deepLink.destination);
   *     else if (error) console.error(error.code, error.message);
   *   },
   * });
   * ```
   */
  configure(options: WarpLinkConfig): Promise<void> {
    if (!options.apiKey || !API_KEY_PATTERN.test(options.apiKey)) {
      const error = new WarpLinkError(
        ErrorCodes.E_INVALID_API_KEY_FORMAT,
        'Invalid API key format. Expected: wl_live_xxx or wl_test_xxx (32 alphanumeric characters after prefix)'
      );

      // Report and return, matching iOS and Android. Throwing here was the
      // odd one out: a bad key is a setup mistake, and crashing the host app
      // over it is worse than leaving the SDK unconfigured and saying so.
      // Always logged, so a host with no onLink still sees it.
      console.warn(`[WarpLink] ${error.message}`);
      options.onLink?.({ error });
      return Promise.resolve();
    }

    // Reset any prior auto-wiring so reconfiguration is clean and idempotent.
    teardownAutoWiring();

    const config = buildNativeConfig(options);
    const hasOnLink = options.onLink != null;
    const wantDeepLinks = hasOnLink && options.automaticDeepLinks !== false;
    const wantDeferred = options.automaticDeferredDeepLinks !== false;

    // Claim a generation BEFORE any await: everything this call starts is
    // tagged with it, and a later configure() invalidates the lot.
    autoGeneration += 1;
    const generation = autoGeneration;
    if (hasOnLink && options.onLink) {
      autoOnLink = options.onLink;
    }

    // Register the warm-start listener synchronously so events that arrive
    // during/after native configuration are captured.
    if (wantDeepLinks) {
      autoWarmUnsub = subscribeUrlHandler(autoDispatchUrl);
    }

    // The launch url arrived before anything this configure() will hear, so
    // its tap is claimed now, ahead of any warm tap made while the native side
    // configures. Claimed after that await, as it used to be, it was numbered
    // behind such a tap and could silence the tap the user made last.
    //
    // Claimed with no url yet, let alone a classification of one.
    // `admitLaunchUrl` records this tap as unused when the launch url turns
    // out to be foreign, or a duplicate of a warm arrival.
    const coldTap = wantDeepLinks ? claimAutoTap() : null;

    return finishConfigure(config, wantDeepLinks, wantDeferred, generation, coldTap);
  },

  /**
   * A manual resolve reaches the same native module as the automatic path, so
   * on Android it cancels whatever automatic tap is in flight
   * (`LinkResolver.resolveDeepLink`). Claiming a silent tap first
   * (`claimAutoTap(true)`, the mechanism warplink-z07t added for a forced
   * repeat) makes this call count as a newer tap for supersession without
   * ever handing its own answer to the automatic sink: the cancellation it
   * causes is swallowed as a superseded tap instead of reaching `onLink` as a
   * spurious `E_NETWORK_ERROR` (warplink-17r7). This call's own promise still
   * settles from its own native answer, unaffected by whether it superseded
   * anything.
   *
   * A FOREIGN url claims nothing. Neither native ever lets one near a claim
   * (Android `UriParser.isWarpLinkUri` before `tapGeneration`; iOS
   * `isWarpLinkURL` before `supersedeInFlightTap`), and it cancels nothing on
   * either platform, so a silent tap for one would silence an automatic tap
   * that is still the host's. The native resolve runs either way and still
   * rejects a foreign url with its own `E_INVALID_URL` (warplink-0csz).
   */
  async handleDeepLink(url: string): Promise<WarpLinkDeepLink | null> {
    const resolved = (await classifyUrl(url))
      ? await resolveClaimed(url, claimAutoTap(true))
      : await resolveOnce(url);
    if (resolved?.error) {
      throw resolved.error;
    }
    return resolved?.deepLink ?? null;
  },

  /**
   * Checks for a deferred deep link from an install attribution match.
   *
   * With the opt-out model this fires automatically from `configure()`
   * (unless `automaticDeferredDeepLinks: false`). Call it manually only
   * for advanced flows or when you disabled the automatic check.
   *
   * Returns the matched deep link with `isDeferred: true`; once attribution
   * has completed the native SDK returns the same cached match on later
   * launches, and `null` when there was no match. The automatic dispatch from
   * `configure()` delivers a match to `onLink` at most once across launches;
   * this manual call always returns the cached result for advanced flows.
   *
   * `matchGuaranteed` is true only for a deterministic match. Gate anything
   * sensitive (auto sign-in, showing personal data) on it. `matchConfidence`
   * is a 0.0–1.0 score, useful for reporting but not for a trust decision.
   *
   * @returns Deferred deep link or `null`.
   * @throws {WarpLinkError} `E_NOT_CONFIGURED` — SDK not initialized.
   * @throws {WarpLinkError} `E_NETWORK_ERROR` — Attribution API unreachable.
   * @throws {WarpLinkError} `E_SERVER_ERROR` — 5xx from attribution API.
   * @throws {WarpLinkError} `E_DECODING_ERROR` — Malformed API response.
   *
   * @example
   * ```ts
   * const link = await WarpLink.checkDeferredDeepLink();
   * if (link?.isDeferred) {
   *   navigation.navigate(link.deepLinkUrl ?? link.destination);
   * }
   * ```
   */
  async checkDeferredDeepLink(): Promise<WarpLinkDeepLink | null> {
    try {
      const result = await NativeWarpLink.checkDeferredDeepLink();
      return deserializeDeepLink(result);
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  /**
   * Returns install attribution for the current install.
   *
   * Distinguishes a genuine "no attribution" (native returns `null` →
   * this returns `null`) from a decode failure (native returns a
   * non-null but malformed payload → throws `E_DECODING_ERROR`).
   *
   * @returns Attribution data, or `null` when there is no match.
   * @throws {WarpLinkError} `E_NOT_CONFIGURED` — SDK not initialized.
   * @throws {WarpLinkError} `E_DECODING_ERROR` — Malformed native payload.
   * @throws {WarpLinkError} `E_NETWORK_ERROR` / `E_SERVER_ERROR` — API failure.
   */
  async getAttributionResult(): Promise<AttributionResult | null> {
    let raw: unknown;
    try {
      raw = await NativeWarpLink.getAttributionResult();
    } catch (error) {
      throw mapNativeError(error);
    }
    if (raw == null) {
      // Genuine no-match.
      return null;
    }
    const parsed = deserializeAttributionResult(raw);
    if (parsed == null) {
      // A payload was returned but could not be decoded.
      throw new WarpLinkError(
        ErrorCodes.E_DECODING_ERROR,
        'Malformed attribution result from native module'
      );
    }
    return parsed;
  },

  /**
   * The version of the native WarpLink SDK this bridge is running against.
   *
   * Ask the SDK, not the package. React Native pins its native SDK by hand and
   * the pin has drifted before: `@warplink/react-native@1.0.2` shipped an
   * Android SDK that reported `0.1.1` over the wire. This returns what the
   * native SDK actually reports, so a host can see that mismatch instead of
   * being told what the package name claims.
   *
   * @example
   * ```ts
   * console.log(await WarpLink.sdkVersion()); // "1.1.0"
   * ```
   */
  async sdkVersion(): Promise<string> {
    try {
      return await NativeWarpLink.getSdkVersion();
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  /**
   * Whether the deferred attribution check has definitively completed for this
   * install.
   *
   * Scoped to ONE install: it goes back to `false` after the app is deleted and
   * installed again, and after a restore from backup, because a reinstall
   * counts as an install and has to be attributed again.
   *
   * Useful for diagnostics and for a host that drives the deferred check
   * itself. The automatic dispatch already gates on it, so a normal
   * integration does not need to read it.
   */
  async isAttributionComplete(): Promise<boolean> {
    try {
      return await NativeWarpLink.isAttributionComplete();
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  async isConfigured(): Promise<boolean> {
    try {
      return await NativeWarpLink.isConfigured();
    } catch (error) {
      throw mapNativeError(error);
    }
  },

  /**
   * Register a listener for warm-start deep links.
   *
   * Advanced/opt-out API. When `configure()` is called with an `onLink`
   * callback and `automaticDeepLinks` is not disabled, warm-start events
   * are already funneled into `onLink` for you.
   *
   * @returns Unsubscribe function.
   */
  onDeepLink(listener: DeepLinkListener): () => void {
    // Explicit subscribers are not the automatic path and are not deduped or
    // superseded: they asked for every event and they get every event.
    return subscribeUrlHandler((_url, resolved) => {
      deliverResolved(listener, resolved);
    });
  },

  async getInitialDeepLink(): Promise<WarpLinkDeepLink | null> {
    try {
      const url = await NativeWarpLink.getInitialURL();
      if (url == null) {
        return null;
      }
      // A manual resolve of whatever url this returns, so it goes through
      // handleDeepLink's own silent-claim supersession (warplink-17r7) rather
      // than a second copy of it.
      return await this.handleDeepLink(url);
    } catch (error) {
      throw mapNativeError(error);
    }
  },
};
