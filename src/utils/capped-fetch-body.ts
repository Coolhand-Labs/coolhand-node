import { CappedBuffer } from './capped-buffer.js';
import { MAX_DECOMPRESSED_BYTES } from './decompress.js';

/**
 * Reads a fetch Response body up to a byte cap, mirroring CappedBuffer's
 * truncate-rather-than-grow-unbounded semantics used on the http/https capture
 * path (see issue #112) — unlike that path, fetch() responses are already
 * decompressed by the runtime, so no separate decompression step is needed here.
 *
 * Falls back to `response.text()` when `.body` isn't a readable stream (e.g. a
 * non-standard Response-like object) — real Node 18+ fetch/undici Response
 * objects always expose `.body` when there's content.
 */
export function readCappedResponseText(
  response: Response,
  maxBytes: number = MAX_DECOMPRESSED_BYTES,
  onTruncate?: () => void
): Promise<string> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    // Returned directly, not awaited — an intervening `async` wrapper here would add an extra
    // microtask tick versus calling response.text() inline, which callers upstream rely on for
    // ordering (see the fetch interception's "drain and log in the background" comment).
    return response.text();
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
