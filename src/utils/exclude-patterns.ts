import { normalizeHostname } from './url-host.js';

/**
 * Canonical forms of `url` to match in addition to the raw string: hostnames are case-insensitive
 * and may carry a trailing dot, so `https://Internal.Corp./x` is the same host as
 * `internal.corp` but would not substring-match it raw (issue #290). The WHATWG `href` lowercases
 * scheme and host and normalizes IPv6; the second candidate also drops a trailing host dot.
 * Unparseable URLs yield no candidates (this runs inside the patched request paths and must not throw).
 */
function canonicalUrlCandidates(url: string): string[] {
  try {
    const parsed = new URL(url);
    const canonical = parsed.href;
    if (!parsed.hostname.endsWith('.')) { return [canonical]; }
    parsed.hostname = normalizeHostname(parsed.hostname);
    return [canonical, parsed.href];
  } catch {
    return [];
  }
}

/**
 * Substring-match exclusion (NOT glob matching) shared by RequestMonitoringService (the `Coolhand` class path)
 * and global-monitor.ts (the auto-monitor path), so both honor the same `excludeApiPatterns`
 * semantics instead of maintaining two independent implementations.
 *
 * Entries match the URL as given, and also its canonical form (host lowercased, one trailing
 * host dot dropped), so host-case and trailing-dot variants can't bypass an entry. Strictly
 * additive: nothing that matched the raw URL stops matching. Paths and queries stay case-sensitive.
 */
export function matchesExcludePattern(url: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) { return false; }
  // An empty-string pattern would match every URL via `url.includes('')`, silently disabling
  // monitoring entirely — guard here (not just at config-parsing call sites) so every caller,
  // present and future, is protected regardless of where the array came from.
  //
  // typeof guard: `url.includes(regex)` throws TypeError, and this runs inside the patched
  // request/fetch paths, so a RegExp entry from an untyped JS caller would break the host app's
  // LLM calls. Non-string entries are ignored instead.
  const valid = patterns.filter((p): p is string => typeof p === 'string' && p !== '');
  if (valid.some(p => url.includes(p))) { return true; }
  if (valid.length === 0) { return false; }
  const candidates = canonicalUrlCandidates(url);
  return valid.some(p => candidates.some(c => c.includes(p)));
}

const EXCLUDE_PATTERNS_DOCS_URL = 'https://github.com/Coolhand-Labs/coolhand-node/blob/main/docs/exclude-patterns.md';

/**
 * `excludeApiPatterns` entries are plain substrings of the full URL, so `*` is matched literally
 * and a glob-style entry such as `/internal-*` silently never matches. Warn (once per offending
 * entry on every call, so repeated setter assignments warn again) instead of leaving that a silent
 * no-op. Never throws and never alters matching. Not gated on `silent`: it flags a misconfiguration.
 * Only `*` is flagged: `?` is a legitimate literal in a query-string pattern (`/v1/foo?stream=true`).
 */
export function warnOnGlobLikePatterns(patterns: readonly string[] | undefined): void {
  for (const p of patterns ?? []) {
    // Non-strings (RegExp, number) can only come from untyped JS callers. matchesExcludePattern
    // ignores them, so say so rather than leaving them a silent no-op; this advisory check must
    // not throw where construction previously didn't.
    if (typeof p !== 'string') {
      console.warn(
        `[coolhand-node] excludeApiPatterns entry of type ${typeof p} is ignored: entries must be ` +
        `strings, matched as literal substrings of the full URL (not regular expressions or globs). See ${EXCLUDE_PATTERNS_DOCS_URL}`
      );
    } else if (p.includes('*')) {
      console.warn(
        `[coolhand-node] excludeApiPatterns entry "${p}" contains "*", but entries are ` +
        'matched as literal substrings of the full URL, not globs — it will only match URLs that ' +
        `contain "*" verbatim. See ${EXCLUDE_PATTERNS_DOCS_URL}`
      );
    }
  }
}
