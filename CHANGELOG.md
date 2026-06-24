# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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