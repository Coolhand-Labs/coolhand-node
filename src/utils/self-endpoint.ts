import { matchesExcludePattern } from './exclude-patterns.js';

/**
 * Guards against the SDK re-intercepting its own outbound log-upload calls. Without this, a
 * `baseUrl` that happens to collide with a matched API pattern (e.g. a local-dev
 * `http://localhost:PORT` backend plus a custom `patternsFile` entry matching `localhost` for a
 * local LLM proxy) causes the SDK's own log upload to be captured and re-logged recursively —
 * unbounded self-amplifying traffic. Matching is by hostname + effective port, not substring, so
 * a `localhost:3000` baseUrl doesn't blanket-exclude a legitimate `localhost:11434` proxy.
 */
export interface SelfEndpoint {
  hostname: string;
  port: string;
}

function effectivePort(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80');
}

// Strips a single trailing dot from a hostname before comparing — `new URL(...).hostname` does
// NOT normalize a trailing-dot FQDN (e.g. `coolhandlabs.com.`, a semantically identical DNS name
// some proxies/resolvers canonicalize to) against its dotless form, so without this an intercepted
// request whose host happens to arrive dotted would silently bypass the self-endpoint check.
function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.endsWith('.') ? lower.slice(0, -1) : lower;
}

export function computeSelfEndpoint(apiEndpoint: string): SelfEndpoint | null {
  try {
    const url = new URL(apiEndpoint);
    return { hostname: normalizeHostname(url.hostname), port: effectivePort(url) };
  } catch {
    return null;
  }
}

export function isSelfEndpointURL(url: string, self: SelfEndpoint | null): boolean {
  if (!self) { return false; }
  try {
    const parsed = new URL(url);
    return normalizeHostname(parsed.hostname) === self.hostname && effectivePort(parsed) === self.port;
  } catch {
    return false;
  }
}

/**
 * Combines the self-endpoint and excludeApiPatterns checks against an already-built URL — shared
 * by both interception paths (the `Coolhand` class's `RequestMonitoringService` and the
 * auto-monitor's `global-monitor.ts`), which otherwise each need to consult the same two
 * conditions before deciding to intercept a request.
 */
export function isSelfOrExcluded(url: string, self: SelfEndpoint | null, excludePatterns: readonly string[]): boolean {
  return isSelfEndpointURL(url, self) || matchesExcludePattern(url, excludePatterns);
}
