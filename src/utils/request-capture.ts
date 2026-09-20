import type { CappedBuffer } from './capped-buffer.js';
import { parseBody } from './parse-body.js';

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
