# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🔒 Security
- **Domain matching in `PatternMatchingService` now anchors on a label boundary instead of doing a plain substring check.** `hostname.includes(domain)` treated `api.openai.com.attacker.net`, `my-openai.com.internal`, and `notopenai.com` as matches for the `openai.com` pattern, since each merely contains the substring. This meant (1) requests to hosts an operator never intended to monitor could have their bodies forwarded to Coolhand's backend, and (2) an attacker-controlled or misconfigured internal hostname could force traffic into the interception code path. Replaced with `hostname === domain || hostname.endsWith('.' + domain)` via a new private `hostnameMatchesDomain` helper, used by `matchesAPIPattern`, `matchesAPIPatternSync`, and `matchesAPIPatternFromURL`. ([#117](https://github.com/Coolhand-Labs/coolhand-node/issues/117))

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