# Excluding Endpoints (`excludeApiPatterns`)

`excludeApiPatterns` tells Coolhand which requests to leave alone: matching requests are never
intercepted or logged to Coolhand. The request itself still goes to its destination unchanged.

```javascript
const coolhand = new Coolhand({
  apiKey: 'your-api-key',
  excludeApiPatterns: ['/internal/', '/healthz']
});
```

## Matching rules

- Each entry is a **plain substring**, not a glob or regex. A request is excluded if its **full URL**
  (scheme, host, path, and query string) contains any entry. For `http`/`https` calls made with an
  options object (`{ hostname, port, path }`), the URL is rebuilt as `scheme://hostname[:port]path`
  from those options as given (an `href`, and on the auto-monitor path a `url`, property on the options
  object is used verbatim instead): an explicit `port` appears in the URL (e.g. `https://host:443/x`) and
  an IPv6 `hostname` is bracketed (`http://[::1]:3000/x`). The same rebuild applies to `https.request(url, options)`,
  where the URL is first split into options. A lone URL string, `URL` object, or `fetch` call uses
  the URL it was given, so the exact form can differ between call styles; path-based entries
  are the most reliable.
- Matching is **case-sensitive** against the URL as given, so path and query entries must match
  exactly. Hostnames are case-insensitive, so the URL is also checked in canonical form (the URL as
  parsed by the WHATWG `URL` class: scheme and host lowercased, IPv6 normalized, IDN hosts punycoded,
  default ports and `.`/`..` path segments resolved, `/` added after a bare host; plus a variant with one trailing
  host dot dropped): `internal.corp` excludes
  `https://Internal.Corp/v1` and `https://internal.corp./`. Write host entries in lowercase; this
  never removes a match the raw URL would have had.
- `*` and `?` have no special meaning (so `?` can be used to match a query string, e.g.
  `/v1/foo?stream=true`). `'/internal-*'` only matches URLs that literally contain `/internal-*`,
  so it will never match `https://example.com/internal-foo`. The SDK logs a warning when an entry
  contains `*`.
- Empty-string and non-string entries (e.g. a `RegExp` from untyped JavaScript) are ignored; non-strings log a warning.
- An entry only changes what gets logged: requests the SDK wouldn't have logged anyway (non-LLM URLs) are unaffected whether or not they match. (On every path, `http`, `https` and `fetch`, the exclusion check runs after provider matching.)
- Pass `excludeApiPatterns: []` to turn off the built-in defaults. `COOLHAND_EXCLUDE_API_PATTERNS` entries are split on commas, so an entry cannot itself contain a comma, and an empty value falls back to the defaults.
- Coolhand's own logging endpoint is always excluded, regardless of this setting.

## Defaults

When `excludeApiPatterns` is not set, `DEFAULT_EXCLUDE_API_PATTERNS` applies (Vertex AI batch jobs
and Azure OpenAI control-plane paths). Setting your own array **replaces** the defaults; spread them
in to keep them:

```javascript
import Coolhand, { DEFAULT_EXCLUDE_API_PATTERNS } from 'coolhand-node';

new Coolhand({
  apiKey: 'your-api-key',
  excludeApiPatterns: [...DEFAULT_EXCLUDE_API_PATTERNS, '/internal/']
});
```

With auto-monitoring, set `COOLHAND_EXCLUDE_API_PATTERNS` to a comma-separated list of substrings.

Only one set of patterns is active per process. If auto-monitoring (or another `Coolhand` instance)
already owns http/https/fetch interception, a later `new Coolhand({ excludeApiPatterns })` does not
change which requests are excluded; the existing interceptor's patterns keep applying.

## Avoiding over-matching

Because the whole URL is searched, a broad entry can exclude more than intended. A bare host such as
`internal.corp.com` also matches `https://api.example.com/x?referrer=internal.corp.com` and a
lookalike host like `https://internal.corp.com.attacker.io/`. Excluded traffic is silently absent from
your Coolhand logs, so prefer specific, path-shaped entries (`/internal/`, `/v1/healthz`) and include
a leading `//` if you need to pin a host (e.g. `//internal.corp.com/`). Pinning is best-effort: it
rules out a bare-host match inside a query value (`?referrer=internal.corp.com`) and lookalike hosts,
but it can still match a URL that embeds `//internal.corp.com/` in its query string, and it won't match
a request whose rebuilt URL carries an explicit port (`https://internal.corp.com:443/x`) or has no
path after the host (`https://internal.corp.com`). Add extra entries such as `//internal.corp.com:443/`
if your client produces those shapes.
