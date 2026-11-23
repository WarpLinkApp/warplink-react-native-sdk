/**
 * The configure() call that built the live session, so a repeat of it keeps the
 * session instead of rebuilding it.
 *
 * The native SDKs ignore a configure with the same key and the same options and
 * keep the check that is running. This layer must do the same: it would
 * otherwise tear down its own wiring and configure native a second time. A
 * repeat that arrives after the run finished still gives an unfinished check
 * one more chance, and native decides whether that sends a request.
 */
import type { DeepLinkListener } from '../types';
import { replaceSink } from './auto-session';

export interface LiveConfigure {
  readonly signature: string;
  readonly generation: number;
  readonly settled: Promise<void>;
  /** The run that built the session has finished. */
  done: boolean;
  /** The deferred check the run started without waiting for it, while it is running. */
  deferred: Promise<void> | null;
  /** The deferred check retry that is running, shared by repeats that arrive meanwhile. */
  retry: Promise<void> | null;
}

/** Runs one more deferred check for a generation, if native says it is worth asking. */
export type DeferredRetry = (generation: number) => Promise<void>;

let live: LiveConfigure | null = null;

/** The newest generation native refused, even when it did so before it was recorded. */
let refusedGeneration = 0;

/**
 * Errors a repeat caller's own `onLink` threw while it delivered a result on
 * behalf of the run that built the session. They belong to that repeat caller.
 */
const replacementThrows = new Set<unknown>();

/**
 * What a configure() asks native and this layer to do. Two calls with the same
 * signature build the same session. `onLink` is left out on purpose: a new one
 * replaces the old sink and does not rebuild anything.
 */
export function configureSignature(
  nativeConfig: Record<string, unknown>,
  wantDeepLinks: boolean,
  wantDeferred: boolean
): string {
  return JSON.stringify([nativeConfig, wantDeepLinks, wantDeferred]);
}

/** The run that built the live session when `signature` is its signature. */
export function liveConfigureFor(signature: string): LiveConfigure | null {
  return live?.signature === signature ? live : null;
}

export function recordLiveConfigure(
  signature: string,
  generation: number,
  settled: Promise<void>
): void {
  // Native can refuse in the same tick the run starts, before it is recorded.
  if (generation === refusedGeneration) {
    return;
  }
  const record: LiveConfigure = { signature, generation, settled, done: false, deferred: null, retry: null };
  live = record;
  const finish = (): void => {
    record.done = true;
  };
  settled.then(finish, finish);
}

/**
 * Keeps the deferred check a run started without awaiting it, so a repeat that
 * arrives meanwhile joins it. Asking native again would run a second check for
 * the same install, and both would deliver.
 */
export function recordDeferredRun(generation: number, run: Promise<void>): void {
  if (live?.generation !== generation) {
    return;
  }
  const record = live;
  record.deferred = run;
  const clear = (): void => {
    if (record.deferred === run) {
      record.deferred = null;
    }
  };
  run.then(clear, clear);
}

/** A configure that native refused built no session: the next call retries. */
export function forgetLiveConfigure(generation: number): void {
  refusedGeneration = generation;
  if (live?.generation === generation) {
    live = null;
  }
}

/**
 * The promise the caller of the run that built the session gets. A repeat
 * caller's `onLink` takes over the sink, so a throw from it surfaces in this
 * run. It is that repeat caller's rejection, not this caller's.
 */
export function ownRun(run: Promise<void>): Promise<void> {
  return run.catch((error: unknown) => {
    if (!replacementThrows.delete(error)) {
      throw error;
    }
  });
}

/**
 * A repeat of the live configure() builds nothing. The new `onLink` takes over
 * the sink.
 *
 * While the run that built the session is going, the call settles with it. That
 * run's failure is the caller's only when native refused the configuration, or
 * when the caller's own `onLink` threw: a throw from the first caller's
 * `onLink` is not.
 *
 * When that run left a deferred check going, the call settles with that check.
 * After the run finished and the check ended, the call asks `retry` for one more
 * check and settles with it. Only a throw from the caller's own `onLink` rejects it.
 */
export function joinLiveConfigure(
  session: LiveConfigure,
  onLink: DeepLinkListener | undefined,
  retry: DeferredRetry | null
): Promise<void> {
  const mine: unknown[] = [];
  replaceSink(
    onLink
      ? (event) => {
          try {
            onLink(event);
          } catch (error) {
            mine.push(error);
            replacementThrows.add(error);
            throw error;
          }
        }
      : null
  );
  if (session.deferred) {
    return session.deferred.catch(ownThrowOnly(mine));
  }
  if (session.done) {
    return retryCheck(session, retry, mine);
  }
  return session.settled.catch((error: unknown) => {
    if (mine.includes(error) || live?.signature !== session.signature) {
      throw error;
    }
  });
}

function retryCheck(
  session: LiveConfigure,
  retry: DeferredRetry | null,
  mine: readonly unknown[]
): Promise<void> {
  if (!retry) {
    return Promise.resolve();
  }
  session.retry ??= retry(session.generation).finally(() => {
    session.retry = null;
  });
  return session.retry.catch(ownThrowOnly(mine));
}

/** A rejection handler that passes on only what the repeat caller's own `onLink` threw. */
function ownThrowOnly(mine: readonly unknown[]): (error: unknown) => void {
  return (error) => {
    replacementThrows.delete(error);
    if (mine.includes(error)) {
      throw error;
    }
  };
}
