/**
 * Substring-match exclusion (NOT glob matching) shared by RequestMonitoringService (the `Coolhand` class path)
 * and global-monitor.ts (the auto-monitor path), so both honor the same `excludeApiPatterns`
 * semantics instead of maintaining two independent implementations.
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
  return patterns.some(p => typeof p === 'string' && p !== '' && url.includes(p));
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
