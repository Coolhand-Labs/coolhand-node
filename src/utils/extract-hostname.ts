import { CoolhandRequestOptions } from '../types.js';

/**
 * Parses out just the hostname from a URL string, returning 'unknown' if it
 * doesn't parse. Used by debugRequest's 🌐 logging (global-monitor.ts and
 * RequestMonitoringService.ts) to avoid ever printing a URL string verbatim —
 * the latter may carry a secret in the query string (e.g. Gemini's `?key=...`)
 * — see issue #164.
 */
export function extractHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * Extracts a safe-to-log hostname from the request options/URL/string shapes
 * debugRequest is called with across the http(s).request/get and fetch()
 * interception paths. Deliberately never returns anything beyond the
 * hostname (no path, no query string) — see extractHostname above.
 */
export function extractRequestHostname(options: CoolhandRequestOptions | string | URL | any): string {
  return typeof options === 'string' ? extractHostname(options) :
    options instanceof URL ? options.hostname :
    options.hostname || options.host ||
      (typeof options.url === 'string' ? extractHostname(options.url) : undefined) ||
      'unknown';
}
