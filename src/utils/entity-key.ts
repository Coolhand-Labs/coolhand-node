// Client-side mirror of the server's workload/template key and description rules. A violation
// server-side drops the whole log, so these are checked before anything is sent. Kept free of side
// effects so any service can import it.

export const MAX_KEY_LENGTH = 255;
export const MAX_DESCRIPTION_LENGTH = 1000;

// Control characters, invisible format characters (zero-width, bidi marks, BOM, ...) and line/paragraph
// separators. The server rejects the whole log for any of these.
const INVISIBLE_RE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
// A surrogate half with no partner — a "broken string encoding" that JSON would turn into U+FFFD.
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Returns a description of why `key` is not an acceptable workload/template key, or `null` if it
 * is. Mirrors the server's rules; a violation there drops the whole log.
 */
export function keyProblem(key: string): string | null {
  if (key.length === 0 || key.trim() === '') { return 'must not be blank'; }
  if (Array.from(key).length > MAX_KEY_LENGTH) { return `must be at most ${MAX_KEY_LENGTH} characters`; }
  if (LONE_SURROGATE_RE.test(key)) { return 'must be valid Unicode (contains a lone surrogate)'; }
  if (INVISIBLE_RE.test(key)) { return 'must not contain control or invisible characters'; }
  if (key !== key.trim()) { return 'must not have leading or trailing whitespace'; }
  if (key.startsWith('/') || key.endsWith('/')) { return 'must not start or end with "/"'; }
  if (key.includes('//')) { return 'must not contain "//"'; }
  return null;
}

/** Returns why `description` is unacceptable, or `null`. Length is counted in code points. */
export function descriptionProblem(description: string): string | null {
  return Array.from(description).length > MAX_DESCRIPTION_LENGTH
    ? `must be at most ${MAX_DESCRIPTION_LENGTH} characters`
    : null;
}
