# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-05-11

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