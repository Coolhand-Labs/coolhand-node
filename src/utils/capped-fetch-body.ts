import { CappedBuffer } from './capped-buffer.js';
import { MAX_DECOMPRESSED_BYTES } from './decompress.js';

/**
 * Reads a fetch Response body up to a byte cap, mirroring CappedBuffer's
 * truncate-rather-than-grow-unbounded semantics used on the http/https capture
 * path (see issue #112) — unlike that path, fetch() responses are already
 * decompressed by the runtime, so no separate decompression step is needed here.
 *
 * Falls back to `response.text()` (truncating the result) when `.body` isn't a readable stream (e.g. a
 * non-standard Response-like object) — real Node 18+ fetch/undici Response
 * objects always expose `.body` when there's content.
 */
export function readCappedResponseText(
  response: Response,
  maxBytes: number = MAX_DECOMPRESSED_BYTES,
  onTruncate?: () => void
): Promise<string> {
  return readCappedBodyText(response, maxBytes, onTruncate);
}

/**
 * Same capped read as `readCappedResponseText`, for the `fetch(new Request(...))` calling
 * convention's request body — `Request` exposes the same `.body`/`.text()` shape as `Response`.
 * Without this cap, a large body passed via `new Request(url, { body })` would be buffered into
 * memory in full on the request-capture side, unlike every other capture path in this codebase.
 */
export function readCappedRequestText(
  request: Request,
  maxBytes: number = MAX_DECOMPRESSED_BYTES,
  onTruncate?: () => void
): Promise<string> {
  return readCappedBodyText(request, maxBytes, onTruncate);
}

function readCappedBodyText(
  bodyHolder: { body: ReadableStream<Uint8Array> | null; text(): Promise<string> },
  maxBytes: number,
  onTruncate?: () => void
): Promise<string> {
  const body = bodyHolder.body;
  if (!body || typeof body.getReader !== 'function') {
    // Not an `async` wrapper — that would add extra microtask ticks versus calling
    // response.text() inline, which callers upstream rely on for ordering (see the fetch
    // interception's "drain and log in the background" comment). `.text()` has already buffered
    // the whole body by the time it resolves (a polyfilled fetch gives us no stream to bound), so
    // this can only cap what gets *logged*, not memory.
    return bodyHolder.text().then((text) => {
      if (text.length <= maxBytes) { return text; }
      onTruncate?.();
      return text.slice(0, maxBytes);
    });
  }
  return readCappedStream(body, maxBytes, onTruncate);
}

async function readCappedStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  onTruncate?: () => void
): Promise<string> {
  const buffer = new CappedBuffer(maxBytes, onTruncate);
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
    }
  } finally {
    // Deliberately not calling reader.cancel() once the cap is hit: this stream is one branch of
    // a tee created by response.clone() (the sibling branch is `response` itself, returned to the
    // caller, who may never read it). Canceling one branch of a tee while the sibling is unread
    // hangs in Node's ReadableStream implementation — verified directly against Node's real
    // streams (not a mock) — so draining to completion, even past the cap, is the only safe
    // option here. Memory is still bounded by CappedBuffer regardless.
    reader.releaseLock();
  }
  return buffer.concat().toString('utf-8');
}
