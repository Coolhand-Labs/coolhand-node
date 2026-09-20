import type { CappedBuffer } from './capped-buffer.js';
import { parseBody } from './parse-body.js';
import { formatErrorMessage } from './format-error.js';

type ParsedBody = Record<string, unknown> | string | null;

/**
 * Converts a chunk handed to `req.write()` / `req.end()` into a Buffer for capture, or `null` if
 * it isn't something we can capture (e.g. the callback in `req.end(callback)`, or any other
 * argument Node itself would reject). Never throws — capture must not be able to fail the host's
 * own write.
 */
export function toChunkBuffer(chunk: unknown, encoding: unknown): Buffer | null {
  if (Buffer.isBuffer(chunk)) { return chunk; }
  if (typeof chunk === 'string') {
    const enc = typeof encoding === 'string' && Buffer.isEncoding(encoding) ? encoding : 'utf8';
    return Buffer.from(chunk, enc);
  }
  if (ArrayBuffer.isView(chunk)) {
    return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return null;
}

/**
 * Best-effort capture of one request chunk. Any failure is reported via `onError` and swallowed:
 * this runs *before* the host's own `originalWrite`/`originalEnd`, so a throw here would stop the
 * request from being sent.
 */
export function captureRequestChunk(
  buffer: CappedBuffer,
  chunk: unknown,
  encoding: unknown,
  onError: (err: unknown) => void
): void {
  try {
    const buf = toChunkBuffer(chunk, encoding);
    if (buf) { buffer.push(buf); }
  } catch (err) {
    onError(err);
  }
}

/**
 * Parses and sanitizes a captured body. Fails closed: if parsing or sanitizing throws, the body is
 * dropped (`null`) rather than logged raw.
 */
export function parseAndSanitizeBody(
  text: string | null | undefined,
  sanitize: ((body: ParsedBody) => ParsedBody) | undefined,
  onError: (err: unknown) => void
): ParsedBody {
  try {
    const parsed = parseBody(text);
    return sanitize ? sanitize(parsed) : parsed;
  } catch (err) {
    onError(err);
    return null;
  }
}

/**
 * Resolves when `promise` settles or after `ms`, whichever comes first — never rejects. Used to
 * wait for background request-body capture before logging without letting a body stream that never
 * ends (e.g. `fetch(new Request(url, { body: endlessStream }))`) keep the call from ever being
 * logged or its dedup entry from being released. `onTimeout` lets callers say that the body was dropped.
 */
export function settleWithin(promise: Promise<unknown>, ms: number, onTimeout?: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      resolve();
    }, ms);
    // Must not keep the process alive just to bound a log entry.
    timer.unref?.();
    promise.then(
      () => { clearTimeout(timer); resolve(); },
      () => { clearTimeout(timer); resolve(); }
    );
  });
}

export const REQUEST_BODY_CAPTURE_WAIT_MS = 5_000;

export interface DeferredBodyCapture {
  /** Resolves once the body is captured, or after REQUEST_BODY_CAPTURE_WAIT_MS — never rejects. */
  waitForCapture(): Promise<void>;
  /** Call once the record has been submitted: a capture finishing later must not mutate it. */
  markSubmitted(): void;
}

/**
 * Captures a fetch request body in the background into `record.request_body` — the shared piece of
 * both fetch interceptors. Never rejects, so a failure can't reach the host or become an
 * unhandledRejection. The wait is bounded (see settleWithin), and once the record is submitted a
 * late capture is discarded rather than mutating what was already sent.
 */
export function captureRequestBodyInBackground(
  read: Promise<string | null>,
  record: { id: number; request_body: unknown },
  sanitize: (body: ParsedBody) => ParsedBody,
  log: (message: string) => void
): DeferredBodyCapture {
  let submitted = false;
  const captured = read
    .catch((err: unknown) => {
      log(`⚠️ Request body capture failed for call #${record.id}: ${formatErrorMessage(err)}`);
      return null;
    })
    .then((body) => {
      if (submitted) { return; }
      record.request_body = parseAndSanitizeBody(
        body,
        sanitize,
        (err) => log(`⚠️ Request body sanitize failed for call #${record.id}: ${formatErrorMessage(err)}`)
      );
    });

  return {
    waitForCapture: () => settleWithin(captured, REQUEST_BODY_CAPTURE_WAIT_MS, () => {
      log(`⚠️ Request body capture for call #${record.id} took over ${REQUEST_BODY_CAPTURE_WAIT_MS}ms; logging without it`);
    }),
    markSubmitted: () => { submitted = true; },
  };
}
