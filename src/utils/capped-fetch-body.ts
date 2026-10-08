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

/**
 * How long the host may go without asking for more of a wrapped body before the capture is
 * finalized with whatever has been read so far (see `teeResponseForCapture`).
 */
export const CAPTURE_IDLE_TIMEOUT_MS = 30_000;

/**
 * Finalizers for captures still waiting on the host. The idle timer is unref'd (it must not keep
 * a process alive), so a short script that never reads a body (`if (!res.ok)` then exit) would
 * otherwise exit before the 30s timer fires and the request would never be logged. `beforeExit`
 * fires once the event loop drains; finalizing there lets the log submission run.
 */
const pendingFinalizers = new Set<() => void>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled || typeof process === 'undefined' || typeof process.on !== 'function') { return; }
  exitHookInstalled = true;
  process.on('beforeExit', () => {
    for (const finalize of [...pendingFinalizers]) {
      finalize();
    }
  });
}

export interface CapturedResponse {
  /** What the host should receive in place of the original response. */
  response: Response;
  /** Resolves with the (capped) body text once the host finishes or cancels the body. */
  captured: Promise<string>;
}

/**
 * Captures a fetch Response body for logging without `response.clone()`.
 *
 * `clone()` is a native `tee()`: the unread sibling branch queues the *entire* body (the cap only
 * bounds what we capture), and cancelling one branch hangs until the sibling is also cancelled —
 * so a host that stops reading, or cancels, could neither be bounded nor stop the download.
 *
 * Instead the returned response wraps the original body in a pull-driven stream
 * (`highWaterMark: 0`): each chunk is read from the source only when the host asks for it, is
 * copied into a `CappedBuffer` on its way through, and the host cancelling cancels the source
 * for real (closing the socket). Retained memory is therefore bounded by the capture cap, and
 * capture completes when the host is done with the body. The trade-off is that capture only
 * progresses as fast as the host reads, so a host that stops reading (e.g. a status-only
 * `if (!res.ok)` check that never touches the body) would otherwise never be logged: once the host
 * has not asked for data for `idleTimeoutMs`, the capture is finalized with the partial body read
 * so far. The host's stream is untouched and keeps working; further reads just aren't captured.
 *
 * Falls back to the `clone()` path for anything that isn't a readable, unlocked stream (null
 * bodies, Response-like objects).
 */
export function teeResponseForCapture(
  response: Response,
  maxBytes: number = MAX_DECOMPRESSED_BYTES,
  onTruncate?: () => void,
  idleTimeoutMs: number = CAPTURE_IDLE_TIMEOUT_MS
): CapturedResponse {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function' || body.locked) {
    return { response, captured: readCappedResponseText(response.clone(), maxBytes, onTruncate) };
  }

  const buffer = new CappedBuffer(maxBytes, onTruncate);
  const reader = body.getReader();
  let resolveCaptured: (text: string) => void = () => undefined;
  let rejectCaptured: (reason: unknown) => void = () => undefined;
  const captured = new Promise<string>((resolve, reject) => {
    resolveCaptured = resolve;
    rejectCaptured = reject;
  });
  let finished = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  // Settles the capture exactly once, whichever of finish/fail/idle-timeout/beforeExit gets there first.
  const settle = (settleCapture: () => void) => {
    if (finished) { return; }
    finished = true;
    pendingFinalizers.delete(finish);
    clearTimeout(idleTimer);
    settleCapture();
  };
  const finish = () => settle(() => resolveCaptured(buffer.concat().toString('utf-8')));
  const fail = (err: unknown) => settle(() => rejectCaptured(err));
  // Armed while the host is not waiting on a read; a pull in flight means the host is active.
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    if (finished) { return; }
    idleTimer = setTimeout(finish, idleTimeoutMs);
    if (typeof idleTimer === 'object') { idleTimer.unref(); }
  };
  // A host cancel while a pull is parked in reader.read() resolves that read with `done` (or
  // rejects it); the stream is already closed by then, so the pull must not touch the controller
  // or reject the capture — the cancel handler resolves it with the partial body instead.
  let hostCancelled = false;

  // Not a byte stream, so `getReader({ mode: 'byob' })` isn't supported on the wrapped body
  // (default readers, async iteration, pipeTo and the body mixins are).
  const hostBody = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        clearTimeout(idleTimer);
        try {
          const { done, value } = await reader.read();
          if (hostCancelled) {
            return;
          }
          if (done) {
            controller.close();
            finish();
            return;
          }
          if (!finished) {
            buffer.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
          }
          controller.enqueue(value);
          armIdleTimer();
        } catch (err) {
          if (hostCancelled) {
            return;
          }
          controller.error(err);
          fail(err);
        }
      },
      async cancel(reason) {
        hostCancelled = true;
        try {
          await reader.cancel(reason);
        } finally {
          finish();
        }
      }
    },
    { highWaterMark: 0 }
  );
  armIdleTimer();
  pendingFinalizers.add(finish);
  installExitHook();

  let wrapped: Response;
  try {
    wrapped = new Response(hostBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch {
    // Status/body combination the Response constructor rejects — hand the source back untouched.
    clearTimeout(idleTimer);
    pendingFinalizers.delete(finish);
    reader.releaseLock();
    return { response, captured: readCappedResponseText(response.clone(), maxBytes, onTruncate) };
  }

  // These are prototype getters populated by the runtime, not constructor inputs.
  for (const prop of ['url', 'redirected', 'type'] as const) {
    Reflect.defineProperty(wrapped, prop, { value: response[prop], enumerable: true });
  }
  return { response: wrapped, captured };
}

function readCappedBodyText(
  bodyHolder: { body: ReadableStream<Uint8Array> | null; headers?: Headers; text(): Promise<string> },
  maxBytes: number,
  onTruncate?: () => void
): Promise<string> {
  const body = bodyHolder.body;
  if (!body || typeof body.getReader !== 'function') {
    // `.text()` buffers the whole body, so when the declared Content-Length already exceeds the
    // cap, skip the read entirely rather than allocate memory we'd only discard. (A chunked body
    // with no Content-Length can't be judged up front and is still buffered.) Only when a body
    // object exists: a real Response for HEAD/204/304 has `body === null` yet may still carry the
    // resource's Content-Length, and there's nothing to read (or truncate) in that case.
    const declared = Number(bodyHolder.headers?.get?.('content-length'));
    if (body && Number.isInteger(declared) && declared > maxBytes) {
      onTruncate?.();
      return Promise.resolve('');
    }
    // Not an `async` wrapper — that would add extra microtask ticks versus calling
    // response.text() inline, which callers upstream rely on for ordering (see the fetch
    // interception's "drain and log in the background" comment). `.text()` has already buffered
    // the whole body by the time it resolves (a polyfilled fetch gives us no stream to bound), so
    // this can only cap what gets *logged*, not memory (the Content-Length check above is the
    // only memory guard).
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
    // option here. Memory is still bounded by CappedBuffer regardless. (Real Responses no longer
    // reach this path — see teeResponseForCapture — only the request-body capture and fallbacks.)
    reader.releaseLock();
  }
  return buffer.concat().toString('utf-8');
}
