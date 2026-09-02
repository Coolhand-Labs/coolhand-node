/**
 * Substring-match exclusion shared by RequestMonitoringService (the `Coolhand` class path)
 * and global-monitor.ts (the auto-monitor path), so both honor the same `excludeApiPatterns`
 * semantics instead of maintaining two independent implementations.
 */
export function matchesExcludePattern(url: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) { return false; }
  // An empty-string pattern would match every URL via `url.includes('')`, silently disabling
  // monitoring entirely — guard here (not just at config-parsing call sites) so every caller,
  // present and future, is protected regardless of where the array came from.
  return patterns.some(p => p !== '' && url.includes(p));
}
