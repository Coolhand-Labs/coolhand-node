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

export function computeSelfEndpoint(apiEndpoint: string): SelfEndpoint | null {
  try {
    const url = new URL(apiEndpoint);
    return { hostname: url.hostname.toLowerCase(), port: effectivePort(url) };
  } catch {
    return null;
  }
}

export function isSelfEndpointURL(url: string, self: SelfEndpoint | null): boolean {
  if (!self) { return false; }
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase() === self.hostname && effectivePort(parsed) === self.port;
  } catch {
    return false;
  }
}
