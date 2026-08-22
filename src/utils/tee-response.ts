import type { IncomingMessage } from 'http';
import type { PassThrough } from 'stream';

const COPIED_FIELDS = [
  'statusCode', 'statusMessage', 'headers', 'rawHeaders',
  'httpVersion', 'httpVersionMajor', 'httpVersionMinor',
  'method', 'url', 'socket', 'trailers', 'rawTrailers', 'complete', 'aborted',
] as const satisfies readonly (keyof IncomingMessage)[];

/** Duck-typed stand-in for `IncomingMessage` returned by {@link createResponseTee}. */
export type ResponseTee = PassThrough & Pick<IncomingMessage, (typeof COPIED_FIELDS)[number]> & {
  setTimeout?: (msecs: number, callback?: () => void) => ResponseTee;
};

function copyIncomingMessageMetadata(res: IncomingMessage, target: ResponseTee): void {
  for (const field of COPIED_FIELDS) {
    (target as any)[field] = res[field];
  }
  // PassThrough has no setTimeout of its own (that's an IncomingMessage-specific method) —
  // shim it so host code calling `res.setTimeout(...)` still works. Wrapped rather than bound:
  // IncomingMessage#setTimeout returns `this` for chaining, and binding to `res` would leak the
  // real response back out of a chained call (`res.setTimeout(n).on('data', ...)`), bypassing
  // the tee entirely and reopening the race this module exists to close.
  if (typeof res.setTimeout === 'function') {
    target.setTimeout = (msecs: number, callback?: () => void) => {
      res.setTimeout(msecs, callback);
      return target;
    };
  }
}

function hostIsReading(hostStream: ResponseTee): boolean {
  return hostStream.readableFlowing !== null || hostStream.listenerCount('readable') > 0;
}

// Bounds how much a tee can buffer before any consumer has attached a listener (e.g. a host
// callback that does `await something()` before reading) — see the cap in the `data` handler
// below for why this can't just be "pause `res` on backpressure" like the read-in-progress case.
export const MAX_TEE_BUFFERED_BYTES = 50 * 1024 * 1024; // 50MB, mirrors decompress.ts's MAX_DECOMPRESSED_BYTES

/**
 * Tees an intercepted http/https response into an independent stream for the host callback.
 *
 * A raw Node Readable can only have one "true" consumer — whoever attaches a 'data' listener
 * first switches it into flowing mode and wins the race. Handing the host the raw `res` (while
 * the interceptor also attaches its own capture listeners) would silently starve a host callback
 * that consumes the response asynchronously (e.g. after an `await`) or via a deferred `.pipe()`.
 * The returned stream is untouched until the host reads it, so it buffers correctly regardless
 * of when that happens — the race is eliminated by construction.
 *
 * The interceptor's own capture listeners (`res.on('data'/'end', ...)`) are attached separately
 * by the caller and are unaffected by this — both sets of listeners receive every chunk.
 *
 * Callers should only invoke this when there is actually a host callback to hand the result to
 * (see `hostIsReading` below for why an unread tee must never apply backpressure) — constructing
 * one that nobody will ever read is wasted work at best.
 *
 * `instanceof http.IncomingMessage` is `false` for the returned tee — it's a real `PassThrough`
 * with IncomingMessage-shaped metadata copied on, not a real instance of it.
 */
export function createResponseTee(
  res: IncomingMessage,
  PassThroughCtor: new () => PassThrough,
  maxBufferedBytes: number = MAX_TEE_BUFFERED_BYTES
): ResponseTee {
  const hostStream = new PassThroughCtor() as ResponseTee;
  let bufferedBeforeRead = 0;
  // Distinguishes "we destroyed the tee ourselves to bound memory" from "the host destroyed the
  // tee" (see the `close` handler below) — only the latter should propagate to `res`. Cap-driven
  // destruction must never abort the real response: the interceptor's own capture below reads
  // `res` directly and must still see a normal 'end', which destroying `res` would prevent.
  let destroyedByCap = false;

  // Prevents an uncaught 'error' throw if `res` errors before the host has attached its own
  // 'error' listener (e.g. during an awaited gap) — degrades to a silent stall instead of
  // crashing the process. A host that *has* attached its own listener by the time the error is
  // forwarded (below) still receives it — multiple listeners on the same event both fire.
  hostStream.on('error', () => { /* see comment above */ });

  copyIncomingMessageMetadata(res, hostStream);

  res.on('data', (chunk: any) => {
    // The host may have destroyed its stream (e.g. to abandon a download early) since the last
    // chunk — writing to an already-destroyed Writable throws/emits a spurious error instead of
    // silently no-op'ing.
    if (hostStream.destroyed) { return; }

    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    // Respect backpressure — but only once the host has demonstrably started reading. `res` is
    // the interceptor's own single source of truth (its own capture listener is on this same
    // `res`, not on the tee), so pausing it when nobody is draining the tee would silently stall
    // the interceptor's own logging too — a callback that never touches the response body (or
    // isn't provided at all) must not be able to deadlock the request.
    if (hostStream.write(buf)) { return; }

    if (hostIsReading(hostStream)) {
      res.pause();
      hostStream.once('drain', () => res.resume());
      return;
    }

    // Nobody has attached a 'data'/'readable' listener yet (e.g. still inside an `await` before
    // the host reads) — intentionally not pausing `res` here, for the reason above. But letting
    // the tee's internal buffer grow unbounded during this window is exactly the regression this
    // cap closes: bound it independently of `res`, which must never be touched by this ceiling.
    bufferedBeforeRead += buf.length;
    if (bufferedBeforeRead >= maxBufferedBytes) {
      destroyedByCap = true;
      hostStream.destroy(new Error(
        `Coolhand: response tee exceeded ${maxBufferedBytes} buffered bytes before being read; ` +
        "destroying the tee to bound memory growth (the interceptor's own capture is unaffected)."
      ));
    }
  });

  res.on('end', () => {
    // Refresh fields that are only accurate once the response has fully arrived (`complete`
    // reads `false` until 'end'; `rawTrailers` is reassigned, not mutated, by Node's http parser).
    copyIncomingMessageMetadata(res, hostStream);
    hostStream.end();
  });

  res.on('error', (err: Error) => {
    hostStream.destroy(err);
  });

  // 'aborted'/'timeout' fire on `res` itself, not through 'data'/'end'/'error' — without
  // forwarding them, a host relying on either (e.g. `res.on('aborted', cleanup)` to detect a
  // truncated response) would silently stop working once handed the tee instead of the real `res`.
  res.on('aborted', () => {
    hostStream.aborted = true;
    hostStream.emit('aborted');
  });

  res.on('timeout', () => {
    hostStream.emit('timeout');
  });

  // If the host abandons/destroys its stream before the response finished arriving, don't leave
  // the real response (and its socket) dangling — this restores the abort behavior hosts get by
  // calling `.destroy()` on a real `res`, which the tee would otherwise silently swallow.
  // `hostStream` also auto-destroys (emitting 'close') after a *normal* `.end()`, so this fires
  // on every response, not just aborted ones — that's fine: `IncomingMessage.prototype._destroy`
  // only actually tears down the socket when the response didn't finish normally (`aborted`),
  // so calling `.destroy()` here on an already-fully-consumed `res` is a safe no-op.
  // Excludes the cap-driven destroy above: that one fires on a still-in-flight `res` (more data
  // yet to arrive), so propagating it here would abort `res` mid-response — cutting off the
  // interceptor's own capture (`res.on('data'/'end', ...)`, attached separately by the caller)
  // before it ever sees 'end', silently dropping the log entry. Only a host-initiated destroy
  // (or one following the response's own normal/aborted completion) should reach `res`.
  hostStream.on('close', () => {
    if (!destroyedByCap && !res.destroyed) {
      res.destroy();
    }
  });

  return hostStream;
}
