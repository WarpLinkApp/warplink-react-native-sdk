import { SUPERSEDE_WAIT_CEILING_MS, settledWithin } from './waits';

/**
 * Every automatic arrival's classify-and-claim step runs on this one chain, in
 * the order the urls arrived.
 *
 * An arrival cannot decide anything synchronously: whether a url is a WarpLink
 * link is a question for the native module, and the answer is a promise. Left to
 * race, two taps of one link 10 ms apart would both be classified before either
 * had stamped the dedupe window, and both would resolve, which is the duplicate
 * that window exists to suppress. Queued, every arrival decides against the
 * state the previous one left.
 *
 * ONLY that step is queued. The resolve itself is started and left to run,
 * because two resolves overlapping is precisely the case supersession handles.
 */
let arrivalQueue: Promise<unknown> = Promise.resolve();

export function enqueueArrival<T>(work: () => Promise<T>): Promise<T> {
  const run = arrivalQueue.then(work, work);
  // The chain outlives any one arrival, so a rejection must not break it for
  // everything queued after. Nothing queued here rejects today (classifyUrl
  // swallows its own failure), which is why this is a guard rather than a
  // behaviour anything depends on.
  arrivalQueue = run.catch(() => undefined);
  return run;
}

/**
 * Waits until every url that reached this layer before now has been classified
 * and, if it is a link, has claimed its tap.
 *
 * "The last claim made before this tap's own answer arrived" needs this:
 * classification is a native round trip, so a url the user tapped BEFORE an
 * answer can still be waiting to be classified when the answer lands. Reading
 * the latest tap number at that moment would miss it, and the older tap would
 * deliver an answer the newer tap has already superseded: on Android, the
 * cancellation that newer resolve caused, an E_NETWORK_ERROR for a network that
 * never failed (warplink-8jih).
 *
 * The queue tail is read once, at the call. Anything appended after that
 * arrived after the answer, and a later navigation cannot silence an answer
 * already given.
 *
 * Bounded by the supersede ceiling as a backstop. The real bound is
 * `CLASSIFY_CEILING_MS` on each classification in the queue, so this drains in
 * time proportional to the queue's depth.
 */
export function arrivalsSettled(): Promise<void> {
  return settledWithin(arrivalQueue, SUPERSEDE_WAIT_CEILING_MS);
}
