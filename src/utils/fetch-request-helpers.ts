import { readCappedRequestText } from './capped-fetch-body.js';
import { MAX_DECOMPRESSED_BYTES } from './decompress.js';

/**
 * Shared helpers for reading a fetch() call's effective URL/method/headers/body across both
 * calling conventions the Fetch API supports: `fetch(url, init)` and `fetch(new Request(...))`.
 * `Request.prototype.toString()` is not overridden by the spec (unlike `URL`, which is), so a
 * bare `url.toString()` yields `"[object Request]"` for the latter — silently failing every
 * pattern-match check downstream instead of throwing, which is what makes this easy to miss.
 */
export function isRequestLike(value: unknown): value is Request {
  if (!value || typeof value !== 'object') { return false; }
  const request = value as Partial<Request>;
  return typeof request.url === 'string' && typeof request.method === 'string';
}

// `any` is deliberate here, not a shortcut: callers pass whatever RequestInit.headers/Request.headers
// resolves to at runtime, which per the fetch spec's HeadersInit is a genuinely open union — a real
// `Headers` instance, a `[string, string][]` pairs array, or a plain object — plus arbitrary duck-typed
// header-like values from non-spec-compliant callers. Every shape is distinguished by runtime checks
// below rather than by the type system, so a narrower static type would just relocate the `any` to a
// cast at every call site without adding safety.
export function headersToRecord(headers: any): Record<string, any> {
  if (!headers) { return {}; }

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  // Checked before the generic `.entries` branch below: a `[string, string][]` pairs array (a
  // valid RequestInit.headers/HeadersInit shape) has its own Array.prototype.entries(), which
  // yields [index, pair] tuples, not the pairs themselves — Object.fromEntries(headers.entries())
  // would mangle it into `{ "0": [key, value], ... }` instead of the record the array represents.
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  if (typeof headers.entries === 'function') {
    return Object.fromEntries(headers.entries());
  }

  return { ...headers };
}

export function getFetchURL(url: string | URL | Request): string {
  if (typeof url === 'string') { return url; }
  if (isRequestLike(url)) { return url.url; }
  return url.toString();
}

export function getFetchMethod(url: string | URL | Request, options: RequestInit): string {
  return options.method || (isRequestLike(url) ? url.method : 'GET');
}

export function getFetchHeaders(url: string | URL | Request, options: RequestInit): Record<string, any> {
  // init.headers replaces request headers entirely per the fetch spec —
  // merging would log headers the caller intentionally dropped.
  if (options.headers !== undefined) {
    return headersToRecord(options.headers);
  }
  return isRequestLike(url) ? headersToRecord(url.headers) : {};
}

// Decodes a `RequestInit.body` for logging, by type, capped at `maxBytes`. A bare `toString()` is
// wrong for everything but strings/URLSearchParams: typed arrays become "123,34,..." and
// Blob/FormData/ReadableStream become "[object ...]" — and it copies Buffer bodies uncapped.
// Bodies that can't be read synchronously (Blob, FormData, streams) are not captured.
function initBodyToText(body: unknown, maxBytes: number): string | null {
  if (typeof body === 'string') {
    return body.length > maxBytes ? body.slice(0, maxBytes) : body;
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return body.toString().slice(0, maxBytes);
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, Math.min(body.byteLength, maxBytes)).toString('utf-8');
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body, 0, Math.min(body.byteLength, maxBytes)).toString('utf-8');
  }
  return null;
}

export async function getFetchRequestBody(url: string | URL | Request, options: RequestInit): Promise<string | null> {
  if (options.body !== undefined) {
    return initBodyToText(options.body, MAX_DECOMPRESSED_BYTES);
  }

  if (isRequestLike(url) && typeof url.clone === 'function') {
    try {
      return await readCappedRequestText(url.clone());
    } catch {
      return null;
    }
  }

  return null;
}
