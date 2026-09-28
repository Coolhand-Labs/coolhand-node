import type { CappedBuffer } from './capped-buffer.js';
import { parseAndSanitizeBody } from './request-capture.js';

type ParsedBody = Record<string, unknown> | string | null;

export interface BufferedBodyCapture {
  /** Queue the capture to run after the current tick, so the host's send isn't delayed by it. */
  schedule(): void;
  /** Run the capture now if it hasn't run yet. Safe to call repeatedly (e.g. before logging). */
  flush(): void;
}

/**
 * Defers the parse + sanitize of a buffered http/https request body until after the request has
 * been sent. `assign` only ever receives sanitized output (or `null`): parseAndSanitizeBody fails
 * closed, and any other failure (e.g. reading the buffer) leaves the body unassigned. Errors are
 * swallowed because `schedule()` runs in a timer callback, where a throw would crash the host.
 */
export function createDeferredBodyCapture(
  buffer: CappedBuffer,
  sanitize: (body: ParsedBody) => ParsedBody,
  assign: (body: ParsedBody) => void,
  onError: (err: unknown) => void
): BufferedBodyCapture {
  let done = false;

  const flush = (): void => {
    if (done) { return; }
    done = true;
    try {
      assign(parseAndSanitizeBody(buffer.concat().toString('utf-8'), sanitize, onError));
    } catch (err) {
      onError(err);
    }
  };

  return {
    schedule: () => { setImmediate(flush); },
    flush
  };
}
