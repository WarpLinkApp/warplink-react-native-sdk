import type { DeepLinkEvent } from '../types';

/**
 * A handler receives the raw url plus the result of resolving it ONCE for the
 * event, so N registered handlers never trigger N redundant native/server
 * resolutions of the same event. `resolved` is null when the url resolved to no
 * deep link (nothing to deliver). `generation` is the configure() that was
 * current when the url arrived.
 */
export type UrlHandler = (
  url: string,
  resolved: DeepLinkEvent | null,
  tap: number | null,
  generation: number
) => void;

const urlHandlers = new Set<UrlHandler>();

export function addUrlHandler(handler: UrlHandler): void {
  urlHandlers.add(handler);
}

export function removeUrlHandler(handler: UrlHandler): void {
  urlHandlers.delete(handler);
}

export function hasUrlHandlers(): boolean {
  return urlHandlers.size > 0;
}

/** True when a host wired a handler beyond `automatic`, the automatic path's own. */
export function hasHandlerBeyond(automatic: UrlHandler): boolean {
  for (const handler of urlHandlers) {
    if (handler !== automatic) {
      return true;
    }
  }
  return false;
}

export function fanOut(
  url: string,
  resolved: DeepLinkEvent | null,
  tap: number | null,
  generation: number
): void {
  for (const handler of urlHandlers) {
    handler(url, resolved, tap, generation);
  }
}
