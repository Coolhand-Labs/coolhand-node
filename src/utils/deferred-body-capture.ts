import type { CappedBuffer } from './capped-buffer.js';
import { parseBody } from './parse-body.js';

type ParsedBody = Record<string, unknown> | string | null;

export interface DeferredBodyCapture {
  /** Queue the capture to run after the current tick, so the host's send isn't delayed by it. */
  schedule(): void;
  /** Run the capture now if it hasn't run yet. Safe to call repeatedly (e.g. before logging). */
  flush(): void;
}

/**
 * Defers the parse + sanitize of a buffered request body until after the request has been sent.
 * `assign` only ever receives sanitized output: if parsing or sanitizing throws, nothing is
 * assigned, so the call is logged with no request body rather than an unsanitized one. Errors are
 * swallowed because `schedule()` runs in a timer callback, where a throw would crash the host.
 */
export function createDeferredBodyCapture(
  buffer: CappedBuffer,
  sanitize: (parsed: ParsedBody) => ParsedBody,
  assign: (body: ParsedBody) => void,
  onError?: (err: unknown) => void
): DeferredBodyCapture {
  let done = false;

  const flush = (): void => {
    if (done) { return; }
    done = true;
    try {
      assign(sanitize(parseBody(buffer.concat().toString('utf-8'))));
    } catch (err) {
      onError?.(err);
    }
  };

  return {
    schedule: () => { setImmediate(flush); },
    flush
  };
}
