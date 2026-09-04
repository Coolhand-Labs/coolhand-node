# Fastify + OpenAI (Unbundled TypeScript/CJS)

This example reproduces real-world setups where `coolhand-node` monitoring **silently fails to intercept OpenAI calls**. It originally demonstrated the ESM Module Namespace patching issue from [#25](https://github.com/Coolhand-Labs/coolhand-node/issues/25) (now fixed). It currently demonstrates a second, unrelated silent-failure mode from [#210](https://github.com/Coolhand-Labs/coolhand-node/issues/210): a client SDK capturing `fetch` by value before monitoring initializes.

## The Setup

This is a Fastify server compiled with TypeScript to CommonJS — a typical backend setup (not bundled by webpack/Next.js). It:

- Constructs an OpenAI client on first use, not at module scope (`src/services/openai-client.ts`)
- Explicitly calls `initializeGlobalMonitoring()` inside the server's `start()` function (`src/main.ts`)
- Exposes a `POST /summarize` endpoint that calls `openai.chat.completions.create()`

This mirrors how many TypeScript backends integrate coolhand-node.

## The Bug(s)

**#25 (fixed):** `coolhand-node` is ESM-only. When it loaded `https` via `await import('https')`, it got an ESM Module Namespace with **non-configurable** properties, and the patching code silently skipped when it couldn't redefine `https.request`. Since this shipped fix, `http`/`https` patching in unbundled Node/CJS setups works correctly.

**#210 (why this example still needs care):** `openai` v5+ dropped `node-fetch` for native `fetch`, and its client constructor does `this.fetch = options.fetch ?? Shims.getDefaultFetch()` — a one-time **value capture** of `globalThis.fetch`, not a live lookup. If an `OpenAI` client is constructed (e.g. at module scope, during import) before `initializeGlobalMonitoring()` has run, it permanently holds the pre-patch, unmonitored `fetch`. Mutating `globalThis.fetch` afterward — which is what monitoring init does — doesn't reach an already-constructed client. This is why `src/services/openai-client.ts` now constructs the client lazily, on first actual use, instead of at module scope: see `docs/global-monitoring.md`'s Troubleshooting section (item 5) for the general pattern.

The result, if a client library like this is constructed too early: monitoring reports "initialized" and "Full (HTTP/HTTPS/Fetch)" mode, but **zero calls are intercepted** — no error, no warning.

## Prerequisites

- Node.js v24+ (see `.nvmrc`)
- An OpenAI API key
- A Coolhand API key

## Setup

```bash
cd examples/fastify-openai-unbundled

# Install dependencies (uses local coolhand-node via file:../../)
npm install

# Create .env from example
cp .env.example .env
# Edit .env and add your API keys

# Build
npm run build
```

## Run

```bash
# Start the compiled server
npm start

# In another terminal, send a request:
curl -X POST http://localhost:3001/summarize \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://arxiv.org/abs/1706.03762"}'
```

## Verifying Monitoring Works

Start the server with `silent: false` (already set in `src/main.ts`). You'll see:

```
🌐 Global Coolhand monitoring initialized
🎯 API Endpoint: https://coolhandlabs.com/api/v2/llm_request_logs
🔍 Monitoring mode: Full (HTTP/HTTPS/Fetch)
```

Then send a request. Because the OpenAI client is constructed lazily (on first use, after monitoring has already patched `globalThis.fetch`), you should see:

```
🎯 INTERCEPTING OpenAI FETCH call
📞 Starting API call #1 to https://api.openai.com/v1/chat/completions
📤 Request complete for call #1
📥 Response received for call #1, status: 200
✅ Successfully logged to API with ID for call #1
```

(`openai` v7.x's client uses native `fetch`, not `https`, so the log line reads `FETCH call` rather than `HTTPS call`.)

## Reproducing the #210 bug

To see the silent-failure mode this example guards against, revert `src/services/openai-client.ts` to construct the client eagerly at module scope:

```ts
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export { openai };
```

(and update `summarizer.ts`'s import/usage back to the plain `openai` export). Rebuild and restart — you will **not** see any `🎯 INTERCEPTING OpenAI` log line, even though `/summarize` still returns 200. The call happened; monitoring just never saw it.

## Key Files

| File | Purpose |
|------|---------|
| `tsconfig.json` | `"module": "commonjs"` — matches real-world TypeScript backends |
| `src/main.ts` | Initializes coolhand monitoring in `start()` via the base `coolhand-node` package (not the `/auto-monitor` subpath, which auto-initializes from env vars on import and would race ahead of this explicit config) |
| `src/services/openai-client.ts` | Constructs the OpenAI client lazily via `getOpenAIClient()`, after monitoring has patched `fetch` |
| `src/services/summarizer.ts` | Uses `openai.chat.completions.create()` with structured output |
| `src/app.ts` | Fastify server with `/summarize` endpoint |
