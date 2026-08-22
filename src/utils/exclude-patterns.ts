/**
 * Substring-match exclusion shared by RequestMonitoringService (the `Coolhand` class path)
 * and global-monitor.ts (the auto-monitor path), so both honor the same `excludeApiPatterns`
 * semantics instead of maintaining two independent implementations.
 */
export function matchesExcludePattern(url: string, patterns: readonly string[]): boolean {
  if (patterns.length === 0) { return false; }
  return patterns.some(p => url.includes(p));
}
