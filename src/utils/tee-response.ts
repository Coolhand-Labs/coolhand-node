import type { IncomingMessage } from 'http';
import type { PassThrough } from 'stream';
import { MAX_DECOMPRESSED_BYTES } from './decompress.js';

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
 *
 * The host-facing tee is capped at `maxBytes` independently of the interceptor's own capture
 * (which has its own, separate `CappedBuffer` cap) — a host that doesn't drain the tee promptly
 * must not be able to grow it unbounded, mirroring the #112 fix on the interceptor's own side.
 * Exceeding the cap destroys `hostStream` only; `res` and the interceptor's own listeners on it
 * are unaffected and continue to completion.
 */
export function createResponseTee(
  res: IncomingMessage,
  PassThroughCtor: new () => PassThrough,
  maxBytes: number = MAX_DECOMPRESSED_BYTES,
  onCapExceeded?: () => void
): ResponseTee {
  const hostStream = new PassThroughCtor() as ResponseTee;
  let hostBytesWritten = 0;

  // Prevents an uncaught 'error' throw if `res` errors before the host has attached its own
  // 'error' listener (e.g. during an awaited gap) — degrades to a silent stall instead of
  // crashing the process. A host that *has* attached its own listener by the time the error is
  // forwarded (below) still receives it — multiple listeners on the same event both fire. The
  // byte-cap destroy below is one more source of this same 'error' — a host without its own
  // listener silently never sees 'end' once the cap trips, same as any other tee-ending error.
  hostStream.on('error', () => { /* see comment above */ });

  copyIncomingMessageMetadata(res, hostStream);

  res.on('data', (chunk: any) => {
    // The host may have destroyed its stream (e.g. to abandon a download early) since the last
    // chunk — writing to an already-destroyed Writable throws/emits a spurious error instead of
    // silently no-op'ing.
    if (hostStream.destroyed) { return; }

    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    hostBytesWritten += buf.length;
    if (hostBytesWritten > maxBytes) {
      onCapExceeded?.();
      hostStream.destroy(new Error(`Host response stream exceeded ${maxBytes} bytes; destroying to bound memory growth`));
      return;
    }

    // Respect backpressure — but only once the host has demonstrably started reading. `res` is
    // the interceptor's own single source of truth (its own capture listener is on this same
    // `res`, not on the tee), so pausing it when nobody is draining the tee would silently stall
    // the interceptor's own logging too — a callback that never touches the response body (or
    // isn't provided at all) must not be able to deadlock the request.
    if (!hostStream.write(buf) && hostIsReading(hostStream)) {
      res.pause();
      hostStream.once('drain', () => res.resume());
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
  hostStream.on('close', () => {
    // A cap-triggered destroy only abandons the host's copy — `res` and the interceptor's own
    // (independently capped) capture listeners on it must keep running to completion.
    if (hostBytesWritten > maxBytes) {
      return;
    }
    if (!res.destroyed) {
      res.destroy();
    }
  });

  return hostStream;
}
