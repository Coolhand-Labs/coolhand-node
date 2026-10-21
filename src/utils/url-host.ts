// Strips a single trailing dot from a hostname before comparing — `new URL(...).hostname` does
// NOT normalize a trailing-dot FQDN (e.g. `coolhandlabs.com.`, a semantically identical DNS name
// some proxies/resolvers canonicalize to) against its dotless form, so without this an intercepted
// request whose host happens to arrive dotted would silently bypass the self-endpoint check.
export function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.endsWith('.') ? lower.slice(0, -1) : lower;
}

/**
 * Wraps an IPv6 literal in brackets so `scheme://${host}:port/path` stays a parseable URL
 * (`http://::1:3000/x` is not; `http://[::1]:3000/x` is). Node's http(s) options carry IPv6
 * hostnames unbracketed, and hostnames that are already bracketed are left alone. Keyed on two or more colons so a `host:port`
 * string (one colon) isn't mistaken for an IPv6 literal.
 */
export function formatHostForUrl(hostname: string): string {
  return hostname.split(':').length > 2 && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
}
