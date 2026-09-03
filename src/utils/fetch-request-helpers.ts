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

export async function getFetchRequestBody(url: string | URL | Request, options: RequestInit): Promise<string | null> {
  if (options.body !== undefined) {
    return options.body !== null ? options.body.toString() : null;
  }

  if (isRequestLike(url) && typeof url.clone === 'function') {
    try {
      return await url.clone().text();
    } catch {
      return null;
    }
  }

  return null;
}
