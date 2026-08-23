# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🔒 Security
- **Outbound request-body buffering on the `http.request`/`https.request` interception path is now capped at the same 50 MB limit as response buffering**, closing the write-side counterpart to the #112 fix. The `req.write`/`req.end` overrides in `global-monitor.ts`/`RequestMonitoringService.ts` accumulated every chunk of an outbound request body into a plain string via unbounded `+=`, with no cap — past V8's ~512 MB max string length, this threw `RangeError: Invalid string length` synchronously inside the host application's own call to `req.write()` (e.g. a large fine-tuning dataset upload via `http.request` to `POST /v1/files`), an error the host app did not cause and would not otherwise have hit. Both files now accumulate into the existing `CappedBuffer`/`MAX_DECOMPRESSED_BYTES`, matching the response-side pattern exactly. ([#166](https://github.com/Coolhand-Labs/coolhand-node/issues/166))
- **The host-facing response tee created by `createResponseTee` (the #115 fix above) is now capped at the same 50 MB limit as the interceptor's own capture.** A host callback that doesn't drain the tee promptly — one that `await`s something before touching `res`, or only reads headers/`statusCode` and ignores the body — previously let the tee's internal buffer grow to the full size of the response while it arrived, reproducing the unbounded-memory issue #112 closed, just on the host-tee side instead of Coolhand's own capture. Exceeding the cap now destroys the host's tee only; the real response and the interceptor's own (independently capped) capture continue unaffected. ([#171](https://github.com/Coolhand-Labs/coolhand-node/issues/171))
- **The `fetch()` interception path now caps response-body buffering at the same 50 MB limit as the `http.request`/`https.request` path**, closing a gap left by the #112 fix, which only wired `CappedBuffer`/`MAX_DECOMPRESSED_BYTES` into the `http`/`https` paths. Both `interceptFetch` implementations (`global-monitor.ts`, `RequestMonitoringService.ts`) previously did `response.clone().text()` with no size limit — a large or maliciously oversized response delivered via `fetch`, arguably the more common interception surface for modern LLM client libraries, was buffered into memory in full. A new `readCappedResponseText` helper (`src/utils/capped-fetch-body.ts`) reads the cloned response's body incrementally via its `ReadableStream` reader, reusing the existing `CappedBuffer`. ([#171](https://github.com/Coolhand-Labs/coolhand-node/issues/171))
- **`matchesAPIPatternFromURL`'s URL-parse-failure fallback no longer bypasses the #117 hostname-anchoring fix.** When `new URL(url)` throws, the method previously fell back to an unanchored `url.includes(domain)` substring check against the raw URL string — reopening the exact bypass class #117 fixed for the parseable-URL path (e.g. a malformed URL containing `notopenai.com` or `evil.com/openai.com/x` would still match the `openai.com` pattern, forwarding that request/response to Coolhand's backend). This fallback is reachable in practice: `RequestMonitoringService.ts`'s `fetch()` patch calls `url.toString()` on whatever's passed to `fetch()`, which yields `"[object Request]"` for a bare `Request` instance (no custom `toString()`), landing in this fallback on every `fetch(new Request(...))` call. The string-matching fallback has been removed entirely — an unparseable URL now returns `null` (every call site already treats `null` as "not one of our providers, pass through unmonitored"), rather than attempting a second, less-safe matching strategy. ([#171](https://github.com/Coolhand-Labs/coolhand-node/issues/171))

## [0.11.0] - 2026-08-22

### 💥 Breaking Changes
- **Minimum supported Node.js version raised to 18 (`engines.node: >=18.0.0`, previously `>=14.0.0`)** — required by the new `uploadClientFile`/`ClientFileService` multipart upload path below, which uses global `fetch`/`FormData`/`Blob` with no `https`-fallback equivalent for pre-18 Node (unlike existing JSON POST paths, which still degrade gracefully via `sendWithHTTPS`). If you're running Node 14–17, upgrade before adopting this version.

### ✨ New Features
- **`metadata` support on `logRequest`/`Coolhand#logRequest`** — pass an optional free-form `metadata` object (e.g. `{ project_path: '/Users/me/my-project' }`) alongside the raw request; it's threaded through to `POST /api/v2/llm_request_logs`'s new `metadata` field and echoed back on `CoolhandLogResponse`. See `docs/manual-submission.md`.
- **`Coolhand#uploadClientFile(payload)` + new `ClientFileService`** — upload a file (slide deck, report, or document) via the new `POST /api/v2/client_files` multipart endpoint. Requires the **private** API key (the public key used by `logRequest`/`createFeedback` 401s here). Uploads always land as `status: draft`. New exported types: `CoolhandClientFilePayload`, `CoolhandClientFileResponse`, `ClientFileService`, `ClientFileServiceConfig`. See `docs/client-file-upload.md`.
- **`SearchLogsParams.includeTotal`** — new opt-in option for `searchLogs` that sends `?include_total=true`, asking the backend to compute exact `total_count`/`total_pages` (via `X-Total-Count`/`X-Total-Pages` response headers) instead of the client-side lower-bound estimate `paginationFromHeaders` otherwise falls back to. Defaults to off/unset, since the backend runs a `COUNT(*)` to answer it — leave it unset for high-frequency polling against this hot endpoint. Backed by [Coolhand-Labs/coolhand#1096](https://github.com/Coolhand-Labs/coolhand/pull/1096), which has since shipped to production — see `docs/log-search.md`. ([#121](https://github.com/Coolhand-Labs/coolhand-node/issues/121))

### ⚠️ Upgrade Notes
- **`metadata` support and `uploadClientFile` depend on backend changes that may not yet be live in production.** As of this release, the published API docs at coolhandlabs.com don't yet document a `metadata` field on `llm_request_logs` or a `client_files` endpoint (though `metadata.project_path` is already documented as a live `searchLogs` filter — see below). Confirm your target Coolhand backend has deployed this support before relying on it — against a backend that hasn't, `uploadClientFile` will likely 404, and `metadata` sent to `logRequest` will likely be silently ignored.
- **[Coolhand-Labs/coolhand#1096](https://github.com/Coolhand-Labs/coolhand/pull/1096) — the backend change `getLogContent`/`searchLogs`/`includeTotal` (introduced in earlier `[Unreleased]` entries prior to this version) depended on — has shipped to production.** The "may lag production" caveats attached to those methods in prior versions' release notes no longer apply; `docs/log-search.md` has been updated to describe current (not pending) backend behavior.
- **Host callbacks passed to a patched `http.request`/`https.request` now receive a `PassThrough` tee, not the real `http.IncomingMessage`**, as part of the #115 fix below. `statusCode`, `statusMessage`, `headers`, `rawHeaders`, `httpVersion`, `httpVersionMajor`, `httpVersionMinor`, `method`, `url`, `socket`, `trailers`, `rawTrailers`, `complete`, `aborted`, and `setTimeout()` are all carried over, and `.destroy()` still propagates to abort the real underlying response — but `res instanceof http.IncomingMessage` is now `false`. If your code relies on that `instanceof` check (rather than duck-typing), update it. **Not covered**: a host consuming the response via `req.on('response', ...)` instead of the callback argument still receives the raw `res`, not the tee, and remains exposed to the original race — only the callback form is fixed.

### 🔒 Security
- **Path-pattern matching in `PatternMatchingService` no longer ignores hostname.** `matchesAPIPatternFromURL`'s path-fallback loop checked every pattern's `paths` against a URL's pathname with no hostname constraint at all — e.g. `https://internal.corp.example.com/v1/messages` matched as "Anthropic" purely because the path matched, forwarding that unrelated host's full request/response bodies to Coolhand's backend even though the operator never configured monitoring for it. This is distinct from the #117 domain-matching fix — it's a second, separate matching strategy that ran whenever no domain matched. Cross-domain path matching now requires a pattern to explicitly opt in via a new `allowPathMatchAcrossDomains: true` field on `CoolhandAPIPattern`; none of the shipped `api-patterns.json` patterns set it, so this is closed by default. Custom pattern files that intentionally rely on path-only matching (e.g. detecting a self-hosted proxy by its provider-shaped path) can still opt a specific pattern in. ([#162](https://github.com/Coolhand-Labs/coolhand-node/issues/162))
- **A malformed custom `COOLHAND_PATTERNS_FILE` (or `patternsFile` option) — valid JSON but the wrong shape, e.g. a typo, partial config, or hand-edited file — no longer crashes every outbound request in the host app.** `PatternMatchingService` now validates that a loaded patterns file is shaped as `{ patterns: [{ domains: string[], ... }] }` before using it, falling back to the built-in default patterns (with a warning naming the offending file) on any mismatch — matching the existing fallback behavior for invalid JSON syntax. As defense in depth, `matchesAPIPattern`/`matchesAPIPatternSync`/`matchesAPIPatternFromURL` now also catch any unexpected error internally and return `null` instead of throwing, so a future bug in this area degrades to "monitoring disabled" rather than breaking the host app's networking. ([#116](https://github.com/Coolhand-Labs/coolhand-node/issues/116))
- **The `http`/`https` module interception path (`http.request`/`https.request`/`http.get`/`https.get`) now sanitizes the captured request URL before logging it**, matching the `fetch` interception path. Previously, only `fetch` sanitized query-string secrets (e.g. Google AI/Vertex AI's `?key=<API key>` auth param) before storing/logging the URL — the `http`/`https` path stored and logged it verbatim, so any library calling an AI API via those modules directly (axios's Node adapter, `got`, raw `https.request`) leaked the key to `console.log` and to Coolhand's backend. Debug-mode (`silent: false`) logging of in-flight and deduplicated requests was also leaking the raw URL in a few spots; those now go through the same sanitizer. `sanitizeURL`'s redacted query-param list was also expanded to cover `password`, `signature`/`sig`, and the AWS SigV4 presign params (`X-Amz-Signature`, `X-Amz-Credential`). ([#113](https://github.com/Coolhand-Labs/coolhand-node/issues/113))
- **Domain matching in `PatternMatchingService` now anchors on a label boundary instead of doing a plain substring check.** `hostname.includes(domain)` treated `api.openai.com.attacker.net`, `my-openai.com.internal`, and `notopenai.com` as matches for the `openai.com` pattern, since each merely contains the substring. This meant (1) requests to hosts an operator never intended to monitor could have their bodies forwarded to Coolhand's backend, and (2) an attacker-controlled or misconfigured internal hostname could force traffic into the interception code path. Replaced with `hostname === domain || hostname.endsWith('.' + domain)` via a new private `hostnameMatchesDomain` helper, used by `matchesAPIPattern`, `matchesAPIPatternSync`, and `matchesAPIPatternFromURL`. ([#117](https://github.com/Coolhand-Labs/coolhand-node/issues/117))
- **Intercepted `http`/`https` responses no longer starve a host callback that consumes them asynchronously.** The interceptor previously attached its own `res.on('data', ...)` listener before invoking the host's response callback, which switches a Node response stream into flowing mode immediately — a host callback that did anything async before touching `res` (`await` before `res.on('data', ...)`, or a deferred `.pipe()`) would silently receive zero bytes and no `'end'` event, because the interceptor's own listener had already drained the stream. The host callback is now handed an independent tee (`PassThrough`) instead of the raw `res`, so it buffers correctly regardless of when the host attaches its listeners. New shared `createResponseTee` helper (`src/utils/tee-response.ts`) backs both the global monitor and `RequestMonitoringService` interception paths. ([#115](https://github.com/Coolhand-Labs/coolhand-node/issues/115))
- **Monitored response bodies are no longer decompressed or buffered without a cap, closing a decompression-bomb / process-crash vector.** `zlib.gunzip`/`inflate`/`inflateRaw`/`brotliDecompress` were called with no `maxOutputLength`, so a small compressed response (as little as ~600 KB) could expand ~1000x in memory; worse, `result.toString('utf-8')` ran inside the zlib completion callback, and a throw there (output too large to represent as a string) escaped as an uncaught exception the caller's `try/catch` couldn't catch, crashing the host process. `decompressBuffer` now caps decompressed output at 50 MB via `maxOutputLength` and guards the `toString` conversion so any throw degrades to a safe fallback instead of escaping. The raw pre-decompression response buffering in `global-monitor.ts`/`RequestMonitoringService.ts` is now capped at the same limit, independent of decompression. Whoever controls a monitored response (a hostile "OpenAI-compatible" gateway, a compromised OpenRouter/Cloudflare AI Gateway account, or a host that slips through the substring-matching bug in #117) could previously use this to crash or memory-exhaust the host process with a tiny payload. ([#112](https://github.com/Coolhand-Labs/coolhand-node/issues/112))
- **`RequestMonitoringService` (used by the primary `new Coolhand({ apiKey })` API) now loads Node's `http`/`https` modules via `createRequire` instead of a static `import * as https from 'https'`.** Previously, tsup's CJS output wrapped that static import in a non-configurable module object, so every `Object.defineProperty` patch attempt silently no-opped — `new Coolhand()` reported "ready" but never actually intercepted axios/got/AWS SDK/etc. traffic over `http`/`https` (only `fetch` was ever patched). Same root cause class as #25 (which fixed the sibling `global-monitor.ts` path), fixed the same way here. All four patch guards (`https.request`, `https.get`, `http.request`, `http.get`) now `console.warn` when patching can't be applied (non-configurable property, or `createRequire` unavailable in native ESM), instead of failing silently. Also fixes `https.get()`/`http.get()` passing the `.request` function into the shared interceptor instead of `.get`, which hung every intercepted `.get()` call to a matched pattern forever — this was the `RequestMonitoringService.ts` half of the still-open [#111](https://github.com/Coolhand-Labs/coolhand-node/issues/111); the `global-monitor.ts` half is not yet fixed. ([#161](https://github.com/Coolhand-Labs/coolhand-node/issues/161))
- **`sanitizeHeaders`'s default redaction set now covers `x-api-key`, `cookie`, `set-cookie`, and `proxy-authorization`**, not just `authorization`/`api-key`. Previously, any header outside those two names was only redacted if the *matched* provider pattern's own `headers` map happened to declare it — a request matched to the wrong pattern (or a custom `patternsFile` entry with no `headers` map) would leak its real credential headers unredacted; `x-api-key` (used by Anthropic, Google AI, and others) and session/gateway cookies were never redacted by any built-in pattern in `api-patterns.json`. ([#163](https://github.com/Coolhand-Labs/coolhand-node/issues/163))
- **Fixed the documented 3-argument `http.request`/`https.request`/`http.get`/`https.get` call form — `request(url, options, callback)` — misassigning arguments in all 8 patched wrappers across `global-monitor.ts` and `RequestMonitoringService.ts`.** These were declared as 2-parameter functions, so under the 3-arg form the real `options` object landed in the `callback` slot and the real callback was silently dropped. Against a matched host this sent the request with the wrong method/headers (silently downgrading to a bare GET) and then threw an uncaught `TypeError` when the response arrived; against an unmatched host, the real callback was simply never invoked, hanging the caller. New shared `normalizeRequestArgs()` helper (`src/utils/normalize-request-args.ts`) reconciles Node's two calling conventions before any patch logic runs. `CoolhandRequestOptions` also gained an `auth` field so Basic Auth credentials embedded in a request URL (`https://user:pass@host/...`) are preserved when merging url-derived and explicit options. ([#160](https://github.com/Coolhand-Labs/coolhand-node/issues/160))

### 📖 Documentation
- **`examples/anthropic-streaming.js`** — a runnable example demonstrating that Coolhand fully captures usage (input/output token counts) from a *streaming* Anthropic `/v1/messages` response, split across `message_start.usage.input_tokens` and `message_delta.usage.output_tokens`. No SDK behavior changed — this closes out a question about whether streaming usage capture actually worked. ([#145](https://github.com/Coolhand-Labs/coolhand-node/issues/145), [#147](https://github.com/Coolhand-Labs/coolhand-node/pull/147))
- **`uploadClientFile` now documents that it requires the private API key** (the public key used by `logRequest`/`createFeedback` 401s here) — this requirement was missing from the JSDoc, README, and `docs/client-file-upload.md`'s usage example.

### 🔧 Internal
- **`createRequire`'s fallback base in `global-monitor.ts` is now an absolute path (`process.cwd() + '/'`) instead of the hand-built `'file://' + process.cwd() + '/'`, which is malformed on Windows** — the drive letter lands in the URL's host slot (`file://C:\Users\...`) and backslashes aren't URL separators. No released behavior changes: real Node 18–24 accept the malformed string, so the published CJS and ESM bundles already patched `http`/`https`/`fetch` correctly on Windows. Stricter `createRequire` implementations reject it, though — Jest's shim only URL-parses strings starting with `file:///`, then requires `path.isAbsolute` — so under Jest on Windows the throw was swallowed and http/https patching silently skipped, failing 3 cases in `test/esm-patching.test.ts` (and letting a 4th pass vacuously). CI never saw it because all jobs run `ubuntu-latest`, where the concatenation happens to form a valid URL. An absolute path is accepted everywhere and needs no `url` import, preserving this file's no-static-Node-imports rule for edge runtimes. ([#149](https://github.com/Coolhand-Labs/coolhand-node/issues/149))

### 🔧 Build & CI
- **15 Dependabot PRs consolidated into two batches**: root devDependencies (`@types/node`, `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` → 8.67.0, `eslint`, `globals` → 17.11.0, `eslint-plugin-jest` → 29.16.1) and the `examples/fastify-openai-unbundled` example's dependencies (`tsx` → 4.23.12, `fastify` → 5.12.0, `dotenv`, `openai` 4.104.0→7.4.0 — a 3-major-version jump, verified the example still builds/typechecks against the new API). ([#146](https://github.com/Coolhand-Labs/coolhand-node/pull/146))

## [0.10.5] - 2026-08-01

### 🐛 Bug Fixes
- **Fixed intercepted `fetch()` blocking until the full response body arrives, breaking streaming** — the patched global `fetch()` and `RequestMonitoringService`'s `fetch()` interception both awaited `responseClone.text()` (a full drain of a cloned response body) before returning the response to the caller. For `stream: true` chat completions this destroyed time-to-first-token entirely, and against a server that holds the connection open indefinitely, the caller's `fetch()` never resolved at all. The clone-drain now runs detached from the returned response — same fire-and-forget pattern already used for the `res.on('data')`/`'end'` handling on the http/https side — so `fetch()` resolves as soon as headers arrive and the caller can stream the body itself. ([#114](https://github.com/Coolhand-Labs/coolhand-node/issues/114))

## [0.10.4] - 2026-08-01

### 🔒 Security
- **`sanitizeHeaders` now redacts the entire `Authorization` header value unconditionally**, not just the `Bearer <token>` scheme. Previously, `Basic ...` and other non-`Bearer` schemes — including a lowercase `bearer` scheme used by some client libraries — passed through the default redaction rule unmasked. This was already covered for OpenAI/Google AI/GitHub Models/Vertex AI/OpenRouter/Cloudflare AI Gateway, whose patterns declare their own `authorization` override, but not for **Anthropic**, whose pattern only overrides `x-api-key` — so an Anthropic-matched request carrying a non-`Bearer` `Authorization` header (e.g. `Basic` proxy auth from a corporate egress gateway) leaked that credential into logged headers. ([#118](https://github.com/Coolhand-Labs/coolhand-node/issues/118))

## [0.10.3] - 2026-08-01

### 🔒 Security
- **Fetch-path response headers are now sanitized before logging**, matching the http/https interception path. `interceptFetch` (`src/global-monitor.ts`, `src/services/RequestMonitoringService.ts`) previously stored `Object.fromEntries(response.headers.entries())` as-is; it now runs the result through `sanitizeHeaders()` first, the same as the http/https path already did. Low impact today since no current pattern declares sensitive *response* headers, but a monitored API returning `set-cookie` or a similar sensitive header on the fetch path would have been logged verbatim while the equivalent http/https call would have redacted it. ([#119](https://github.com/Coolhand-Labs/coolhand-node/issues/119))

## [0.10.2] - 2026-08-01

### 🔒 Security
- **Header redaction in `PatternMatchingService#sanitizeHeaders` is no longer case-sensitive.** Every redaction rule (the default `authorization`/`api-key` rules and pattern-specific rules from `src/api-patterns.json`) did an exact-case property lookup, so headers sent with their conventional casing — `Authorization`, `X-Api-Key`, `OpenAI-API-Key`, as used by axios, got, and most provider SDKs — bypassed redaction entirely. Node's `http.request`/`fetch` (plain-object headers) preserve caller casing on the request side, unlike `IncomingMessage.headers`, which Node lowercases on responses — this is why response-header redaction was unaffected. Any host application sending a capitalized auth header had that third-party API key stored in Coolhand's backend in cleartext, and — when running with `dryRun: true` and `silent: false` — printed via `console.log`. Incoming header keys are now lowercase-normalized once before any redaction rule runs, closing the bypass regardless of the caller's casing. ([#110](https://github.com/Coolhand-Labs/coolhand-node/issues/110))

## [0.10.1] - 2026-08-01

### ✨ New Features
- **`Coolhand#getLogContent(logId, opts)` and `Coolhand#searchLogs(params)`** — new read methods for logs, backed by `GET /api/v2/llm_request_logs/{id}` (fetch content) and `GET /api/v2/llm_request_logs` (search). Both authenticate with the **private** API key — the public key used by `logRequest`/`createFeedback` will 401 on these — matching `searchFeedback`/`getFeedback`'s existing read-path convention. `getLogContent` supports `section`/`maxChars` for large logs, or `searchQuery` for snippet search (mutually exclusive — enforced at compile time via a discriminated `GetLogContentOptions` union), plus `includeThinking`. `searchLogs` supports named filters (`templateId`, `workloadId`, `model`, `sourceApi`, `sourceApiResult`, `unmatchedOnly`, `daysBack`, `includePrompts`, `sort`, `page`, `per`) and returns `{ logs, pagination }`, with `pagination` read from `X-Total-Count`/`X-Page`/`X-Per-Page`/`X-Total-Pages` response headers where the backend supports them. New exported types: `GetLogContentOptions` (+ `GetLogContentSliceOptions`/`GetLogContentSearchOptions`), `LlmRequestLogContent` (+ `LlmRequestLogContentFull`/`LlmRequestLogContentSearchResult`/`Base`/`Fields`), `SearchLogsParams`, `SearchLogsResponse`, `LlmRequestLogSummary`, `Pagination` (renamed from `FeedbackPagination`, which remains a `@deprecated` type alias — not a breaking change). ([#108](https://github.com/Coolhand-Labs/coolhand-node/issues/108), [#109](https://github.com/Coolhand-Labs/coolhand-node/pull/109))
- Replaces what `coolhand-cli`'s `fetch-log`/`search-logs` commands currently do via `McpService.mcpCall('get_log_content' | 'search_logs', ...)` (JSON-RPC over `/mcp`) — the CLI migration itself is tracked separately, blocked on this release.

### ⚠️ Upgrade Notes
- **`getLogContent`/`searchLogs` depend on a backend change ([Coolhand-Labs/coolhand#1096](https://github.com/Coolhand-Labs/coolhand/pull/1096)) that had not yet shipped to production as of this release.** Against a backend that hasn't deployed it yet: `getLogContent` 404s (no `show` route exists), and `searchLogs`' named filters are silently ignored (unfiltered results are returned, not an error) with only bare-minimum fields on each result and an estimated (not authoritative) `pagination`. See `docs/log-search.md`'s "Deployment status" section for the exact list of what does and doesn't work until that backend PR ships.

### 🔒 Security
- **`getFeedback` and `getLogContent` now reject a blank, whitespace-only, or bare dot-segment (`.`/`..`) ID client-side**, throwing a plain `Error` instead of silently sending the request. `encodeURIComponent` doesn't escape `.`, so WHATWG `URL` parsing was collapsing these into the collection's `index` route — returning a response shaped like a list, not a single record, typed as if it were the latter — and for `..`, sending the private API key to a different endpoint entirely. New shared `BaseService#buildResourceUrl` helper backs both methods.

### 🔧 Build & CI
- **GitHub Actions bumped to their latest major versions** (`actions/checkout` v4→v7, `actions/setup-node` v4→v7, `actions/upload-artifact` v4→v7, `actions/download-artifact` v4→v8) and 13 Dependabot PRs consolidated into one: `eslint` ^9→^10, `typescript` ^5→^6, `@types/node` ^20→^26, `globals` ^16→^17, plus the `examples/fastify-openai-unbundled` example's `pino`/`pino-pretty`/`zod`. ([#107](https://github.com/Coolhand-Labs/coolhand-node/pull/107))
- **`tsconfig.json`/`jest.config.cjs` updated for the TypeScript 6.0 bump above** — `moduleResolution` changed to `"bundler"`, `ignoreDeprecations: "6.0"` and explicit `types: ["node", "jest"]` added, and `lib` extended with `ES2022.Error` (for `Error`'s `cause` option, already used by `BaseService`'s error handling).

## [0.10.0] - 2026-07-30

### 💥 Breaking Changes
- **`LLMRequestLogFeedbackResponse.llm_request_log_id` and `LLMRequestLogFeedbackSummary.llm_request_log_id` are now `string | null`, not `number`** — the Coolhand API now returns this as a hashid, matching every other external-facing identifier on the record (it previously leaked the raw integer foreign key). If your code reads `llm_request_log_id` off a feedback response and treats it as a number (arithmetic, numeric comparison, storage in a numeric column), update it to treat the value as an opaque string identifier instead. Nothing in this SDK's own logic depended on its numeric type (only ever logged/passed through), so no runtime behavior changes here beyond the types. ([#92](https://github.com/Coolhand-Labs/coolhand-node/pull/92))
- **`LLMRequestLogFeedback.llm_request_log_id`** (the `createFeedback`/`updateFeedback` request field) is now typed `number | string` — existing callers passing a raw integer are unaffected; the server still accepts either format on write. ([#92](https://github.com/Coolhand-Labs/coolhand-node/pull/92))
- **`LLMRequestLogFeedbackResponse.workload_id` and `LLMRequestLogFeedbackSummary.workload_id` are now `string | null`, not `number`** — the same hashid change as `llm_request_log_id` above, applied to the workload identifier. Also only ever logged/passed through, so no runtime behavior changes beyond the types. ([#92](https://github.com/Coolhand-Labs/coolhand-node/pull/92))
- **Removed `llm_request_log_hashid` from `LLMRequestLogFeedbackResponse` and `LLMRequestLogFeedbackSummary`** — now redundant, since `llm_request_log_id` above is itself the hashid. ([#92](https://github.com/Coolhand-Labs/coolhand-node/pull/92))
- **Removed `LoggingService.fetchLastSync(collector)` and the `LastSyncResponse` type** — both were dead code since the backend endpoint they called (`GET /api/v2/llm_request_logs/last_sync`) was removed; every call was already 404ing and silently resolving to `null` (per the method's never-throw design). There is no replacement — last-sync logic now lives in `coolhand-cli`, which queries the general log/feedback index endpoints directly with explicit filters instead. If you called `fetchLastSync` or imported `LastSyncResponse`, remove the usage; this capability is not returning to this SDK. ([#88](https://github.com/Coolhand-Labs/coolhand-node/pull/88))

### ✨ New Features
- **`Coolhand#searchFeedback(params)` and `Coolhand#getFeedback(id)`** — new read methods for feedback records, backed by `GET /api/v2/llm_request_log_feedbacks` (search) and `/{id}` (get one). Both authenticate with the **private** API key — the public key used by `createFeedback` will 401 on these. `SearchFeedbackParams` accepts raw Ransack predicates (`sentiment_eq`, `explanation_cont`, `s`, etc.) plus `page`/`per`, close to the wire format. ([#90](https://github.com/Coolhand-Labs/coolhand-node/pull/90))
- **`HttpError`** — new exported error type thrown by `searchFeedback`/`getFeedback` on non-2xx responses, carrying a `.status` so callers can `instanceof`-check e.g. a `401` without parsing message text, matching the convention `McpService` already used. New supporting types: `SearchFeedbackResponse`, `LLMRequestLogFeedbackSummary`, `LLMRequestLogFeedbackDetail`, `LLMRequestLogFeedbackPartial`, `FeedbackPagination`. ([#90](https://github.com/Coolhand-Labs/coolhand-node/pull/90))

### 🔒 Security
- **js-yaml bumped to resolve GHSA-h67p-54hq-rp68** — nested `npm overrides` scoped per consumer (`@istanbuljs/load-nyc-config` → `^3.15.0`, `@eslint/eslintrc` → `^4.2.0`) resolve a quadratic-complexity DoS in `<<` merge-key handling. Dev-only tooling; not part of the runtime bundle. ([#87](https://github.com/Coolhand-Labs/coolhand-node/pull/87))
- **brace-expansion, fast-uri, find-my-way bumped** — resolves three high-severity Dependabot alerts: a ReDoS in `brace-expansion` (pulled in via `eslint`/`minimatch`), and host-confusion/DDoS issues in `fast-uri`/`find-my-way` (pulled in via `fastify` in the `examples/fastify-openai-unbundled` example). All updates landed within already-declared semver ranges; no direct dependency versions changed. ([#91](https://github.com/Coolhand-Labs/coolhand-node/pull/91))
- **Releases now publish via npm Trusted Publishing (OIDC) with provenance** — a new tag-triggered `publish.yml` workflow replaces manual `npm publish` from a maintainer's machine. No long-lived `NPM_TOKEN` is stored anywhere; the workflow authenticates via GitHub OIDC and npm attaches a signed provenance attestation to each published version, shown as the "Provenance" badge on npmjs.com. CI is also hardened: GitHub Actions are pinned to commit SHAs, each job declares least-privilege `permissions:`, and a new `npm audit --omit=dev` step gates on vulnerabilities in what actually ships. ([#93](https://github.com/Coolhand-Labs/coolhand-node/pull/93))

## [0.9.0] - 2026-07-10

### ✨ New Features
- **`McpService`** — new exported service (`McpService.mcpCall(toolName, args)`) that calls the Coolhand server's `/mcp` endpoint, which speaks JSON-RPC 2.0. Built for `coolhand-cli`'s optimization commands (`list-workloads`, and search/get/close/update-optimization) to invoke server-side MCP tools instead of using raw `fetch`. Authenticates with the private API key (`X-API-Key`) and throws on failure — including a status-carrying error for non-2xx responses (e.g. so callers can detect a `401` without parsing response text) — since these callers need to surface errors to the user rather than silently degrade.
- **`LoggingService.fetchLastSync(collector)`** — new method that asks the server for the timestamp of the most recent log it already holds for a given `collector`, so a caller (e.g. `coolhand-cli`'s `capture-sessions`) only re-scans data newer than that cutoff. This is a server-authoritative cutoff that survives local state-file loss or a reinstall. Unlike `McpService.mcpCall`, it never throws — any failure (network error, 404, malformed response) resolves to `null` so the caller can fall back to local state.
- Adds `McpToolCallResponse` and `LastSyncResponse` exported types supporting the above.

## [0.8.1] - 2026-06-24

### 🔒 Security
- **@babel/core bumped to ^7.29.6** — Adds `npm overrides` to force the transitive `@babel/core` dependency (pulled in by `ts-jest`) to `7.29.7`, resolving Dependabot alert #40 (low severity). Scope: devDependencies only; the published bundle has no production dependencies.
- **js-yaml (alert #41) not resolved** — `@istanbuljs/load-nyc-config` (jest coverage toolchain) has no release supporting js-yaml 4.x, so the vulnerable 3.14.2 transitive copy cannot be upgraded without removing jest coverage support. Alert remains open pending an upstream release.

## [0.8.0] - 2026-06-24

### ✨ New Features
- **OpenRouter support** — `openrouter.ai` is now a built-in monitored provider. Covers `/api/v1/chat/completions`, `/api/v1/completions`, and `/api/v1/embeddings`. Redacts `authorization` and `x-api-key` headers. Works in both Node.js (file-loaded patterns) and Edge runtimes (Cloudflare Workers, Vercel Edge).
- **Non-inference Anthropic request filter** — Noisy Anthropic operational endpoints are silently dropped before reaching Coolhand's ingestion. Applied at all six interception sites (https.request/get, http.request/get, fetch):
  - `GET /api/directory/servers` — MCP server directory listing from claude.ai browser sessions
  - `GET /v1/environments/:id/work/poll` — managed-agents environment work polling
  - `POST /api/event_logging/…` (any sub-path) — Claude Code internal telemetry batches; dropped regardless of HTTP method

### 🔒 Security
- **esbuild bumped to ≥0.28.1** — Adds `npm overrides` to resolve GHSA-g7r4-m6w7-qqqr (path traversal via esbuild dev server on Windows). Not exploitable in this project's usage but addressed proactively.

### 🐛 Bug Fixes
- **Node 22 test flakiness** — Replaced a hardcoded 50 ms timer in the gzip decompression test suite with a deterministic mock hook, fixing intermittent CI failures on Node 22 where libuv schedules zlib callbacks differently.

### 📖 Documentation
- Added `CLAUDE.md` with setup, CI gate, scripts reference, README/docs philosophy, cross-SDK alignment, and SEO/AEO guidance.
- Added "About Coolhand Labs" section to README.

## [0.7.0] - 2026-06-08

### ✨ New Features
- **Vertex AI support** — `aiplatform.googleapis.com` is now included in the default monitored endpoints. Covers native Gemini surfaces (`:generateContent`, `:streamGenerateContent`, `:embedContent`, `:predict`) and the OpenAI-compatible endpoint (`/endpoints/openapi/`). Redacts both `authorization` and `x-goog-api-key` (Express Mode / API-key auth).
- **Cloudflare AI Gateway support** — `gateway.ai.cloudflare.com` is now monitored by default. Redacts `authorization`, `cf-aig-authorization` (Authenticated Gateway), `x-api-key`, `openai-api-key`, and `x-goog-api-key` so proxied-provider credentials are not logged regardless of upstream provider.
- **`logRequest()` public method** — `coolhand.logRequest(callData, { collector? })` manually submits a captured LLM request/response to the Coolhand API. Intended for offline tools (e.g. `coolhand-cli capture-sessions`) that save session turns locally and submit them outside of automatic monitoring. Returns `CoolhandLogResponse | null`.
- **`CoolhandLogResponse` type** — exported from `coolhand-node`; describes the API response from a log submission (`id`, `source_api`, `llm_provider_unique_id`, `warnings`, etc.).
- **`creator_type` field in feedback** — `createFeedback()` now accepts `creator_type: 'human' | 'agent' | 'unknown'` to indicate who or what submitted the feedback. Defaults to `"unknown"` server-side when omitted.

### ⚠️ Upgrade Notes
- **`debug: true` no longer suppresses API calls** — `debug: true` is verbose-logging only; it does not prevent data submission. Use `dryRun: true` to suppress all submissions. If you had `debug: true` in production as an accidental "don't submit" flag, **you will start seeing submissions after upgrading**. A runtime deprecation warning fires at construction time when `debug: true` is passed without `dryRun: true` to help catch this.

### 🐛 Bug Fixes
- **npm badge link** — README badge now correctly links to the `coolhand-node` package on npm.

### 🔧 Internal
- Removed stale v0.2.0 release artifacts (`RELEASE_NOTES_v0.2.0.md`, `RELEASING.md`).

## [0.6.0] - 2026-05-18

### ✨ New Features
- **GitHub Models support** — `models.github.ai` and `models.inference.ai.azure.com` are now included in the default monitored endpoints out of the box.
- **`excludeApiPatterns` option** — Pass an array of glob patterns to `new Coolhand({ excludeApiPatterns })` or `initializeGlobalMonitoring({ excludeApiPatterns })` to skip specific endpoints (e.g. operational health-check URLs) from being logged.
- **`sentiment` field in feedback** — `createFeedback()` now accepts `sentiment: 'like' | 'dislike' | 'neutral'`. The legacy boolean `like` field is deprecated and auto-converted.
- **CommonJS (`require()`) support** — `coolhand-node` now ships dual CJS + ESM builds. `require('coolhand-node')` and `require('coolhand-node/auto-monitor')` work in any Node.js project without configuration.

### 🐛 Bug Fixes
- **`fetch(Request)` interception** — `fetch(new Request(url, { method: 'POST', ... }))` is now intercepted correctly. Headers from `init` properly override `Request` headers; request body is read from `init.body` when provided; deduplication is restricted to idempotent methods (GET, HEAD).
- **Startup pattern count log** — The `📋 Loaded N API patterns` constructor log no longer shows a stale `0` count in ESM environments where patterns load asynchronously.
- **Duplicate auto-monitor banner** — `coolhand-node/auto-monitor` now prints its initialization banner only once, even when the module is evaluated in multiple contexts (e.g. CJS + ESM interop).
- **Gzip / deflate decompression** — Response body decompression in the global monitor now handles deflate streams that omit the zlib wrapper (RFC 1951 raw deflate), fixing silent data loss for some providers.

### 🔧 Build & CI
- CJS + ESM smoke tests are now gated in `prepublishOnly` — a publish will fail if either format is broken.
- CI runs the full CJS + ESM smoke test matrix on every PR across Node 18, 20, and 22.

## [0.5.0] - 2026-05-12

### 💥 Breaking Changes
- **`debug: true` no longer suppresses API calls.** `debug: true` now enables verbose logging only — data is still submitted. Use `dryRun: true` to prevent data submission.
- **`COOLHAND_DEBUG=true` no longer suppresses API calls.** Use `COOLHAND_DRY_RUN=true` instead.

### ✨ New Features
- **`dryRun` option** — `new Coolhand({ dryRun: true })`, `initializeGlobalMonitoring({ dryRun: true })`, and env var `COOLHAND_DRY_RUN=true` suppress all API submissions (the behavior previously triggered by `debug: true`).
- **`debug` as verbosity** — `debug: true` now prints the endpoint URL and payload size before each outbound call without suppressing any submissions.

### ⚠️ Deprecation Warning
- Passing `debug: true` without `dryRun: true` emits a one-time `console.warn` deprecation notice. If you relied on `debug: true` to prevent data submission, replace it with `dryRun: true`.

## [0.4.0] - 2026-05-11

### 💥 Breaking Changes
- **`environment` option removed** — The `environment: 'local' | 'production'` field has been removed from `CoolhandOptions` and `GlobalMonitorConfig`. Replace `environment: 'local'` with `baseUrl: 'http://localhost:3000'`, and remove `environment: 'production'` (the default URL is unchanged).

### ✨ New Features
- **`baseUrl` option** — Both `new Coolhand({ baseUrl })` and `initializeGlobalMonitoring({ baseUrl })` now accept an optional `baseUrl` to redirect log and feedback POSTs to a self-hosted endpoint. When omitted, behavior is unchanged (default: `https://coolhandlabs.com`).
- **`COOLHAND_BASE_URL` environment variable** — Auto-monitor reads this variable and forwards it to `initializeGlobalMonitoring`, enabling zero-code-change self-hosted setups.

### 🔒 Validation
- `baseUrl` must use `https://` or `http://localhost` / `http://127.0.0.1` / `http://*.localhost` (for local dev). Any other scheme or non-loopback `http://` host throws immediately with a clear error message.
- Trailing slashes on `baseUrl` are normalized automatically before the v2 path is appended.

## [0.2.0] - 2026-03-01

### 🐛 Bug Fixes
- **Gemini array response normalization** - Fixed silent data loss when `streamGenerateContent` returned a JSON array; `parseBody()` now normalizes arrays to newline-delimited JSON before transmission

### ✨ New Features
- **Extended Gemini endpoint coverage** - `api-patterns.json` now matches `:streamGenerateContent`, `:countTokens`, and `:embedContent` in addition to the existing `:generateContent`; all four work for both direct `generativelanguage.googleapis.com` requests and proxy scenarios
- **URL sanitization** - `PatternMatchingService.sanitizeURL()` redacts sensitive query parameters (`key`, `api_key`, `apikey`, `token`, `access_token`, `secret`) before URLs are logged; prevents API keys passed as query params (common with Gemini's `?key=` pattern) from appearing in call records

### ✨ Improvements
- **Shared `parseBody()` utility** - Replaced three duplicate `parseJSON` implementations across `coolhand.ts`, `global-monitor.ts`, and `RequestMonitoringService.ts` with a single tested utility; exported publicly from the main entry point
- **PatternMatchingService `silent` mode** - Constructor now accepts an options object (`PatternMatchingServiceOptions`) with a `silent` flag to suppress console output during initialization; original string constructor remains supported

### 🔧 Technical Changes
- Added `scripts/sync-version.mjs` — generates `src/version.ts` from `package.json` at build time, keeping version identifiers permanently in sync
- Added `"sync-version"` npm script; `npm run build` now runs it automatically as a pre-step
- Added GitHub Actions CI workflow: test matrix (Node 18/20/22), lint, and build verification jobs
- Added `RELEASING.md` with step-by-step release workflow documentation
- Updated `README.md` Related Packages section with `coolhand-js` and `coolhand-python` references
- Bumped `js-yaml` from 4.1.0 to 4.1.1
- Bumped `glob` from 10.4.5 to 10.5.0

### 💥 Breaking Changes
- Removed public `parseJSON()` method from the `Coolhand` class — use the exported `parseBody()` function instead

## [0.1.1] - 2025-12-06

### ✨ Improvements
- **Enhanced Google AI support** - Added Vertex AI endpoint pattern matching with `:generateContent` path
- **Simplified API patterns** - Removed unused Cohere and Hugging Face patterns for better maintainability
- **Focused provider support** - Streamlined Google AI configuration to use `generativelanguage.googleapis.com`

### 🔧 Technical Changes
- Updated `api-patterns.json` to include `:generateContent` pattern for Google Vertex AI
- Removed `ai.googleapis.com` domain from Google AI patterns
- Cleaned up unused provider patterns (Cohere, Hugging Face)

## [0.1.0-rc1] - 2025-10-09

### ✨ Major Features
- **Complete TypeScript Migration** - Full TypeScript codebase with comprehensive type definitions
- **Global Monitoring System** - Zero-configuration monitoring with `require('coolhand-node/auto-monitor')`
- **Pattern-Based Multi-Provider Support** - Universal API detection for OpenAI, Anthropic, Google AI
- **Comprehensive Feedback API** - Collect user feedback on AI responses
- **Debug Mode System** - Development safety with debug mode
- **Modular Service Architecture** - LoggingService, FeedbackService, RequestMonitoringService

### 🎯 Core Capabilities
- Universal HTTP patching for automatic API detection
- Environment variable-based setup (`COOLHAND_API_KEY`)
- Edge Runtime support for Next.js and serverless environments
- JSON-based API pattern matching system
- Smart header sanitization with credential redaction
- Request correlation and client tracking

### 🧪 Testing & Development
- Jest test framework with 85%+ coverage targets
- Comprehensive service and integration testing
- CI/CD integration with GitHub Actions
- Production-ready testing infrastructure

### 📦 Package Structure
- ES Module support with proper TypeScript compilation
- Exported types: `Coolhand`, `CoolhandOptions`, `CoolhandCallData`, etc.
- Multiple entry points: main package and auto-monitor
- Node.js 14+ compatibility