export const IGNORED_GET_PATH_PATTERNS: readonly RegExp[] = Object.freeze([
  /^\/api\/directory\/servers(\?.*)?$/,             // MCP server directory listing
  /^\/v1\/environments\/[^/]+\/work\/poll(\?.*)?$/  // managed-agents environment polling
]);

export const IGNORED_ANY_METHOD_PATH_PATTERNS: readonly RegExp[] = Object.freeze([
  /^\/api\/event_logging\//  // Claude Code telemetry batches
]);

export function isNonInferenceURL(url: string, method: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname !== 'api.anthropic.com') { return false; }
    if (IGNORED_ANY_METHOD_PATH_PATTERNS.some(p => p.test(u.pathname))) { return true; }
    if (method.toUpperCase() !== 'GET') { return false; }
    return IGNORED_GET_PATH_PATTERNS.some(p => p.test(u.pathname + u.search));
  } catch {
    return false;
  }
}
