# Fastify + OpenAI (Unbundled TypeScript/CJS)

This example reproduces a real-world setup where `coolhand-node` monitoring **silently fails to intercept OpenAI calls**. It demonstrates the ESM Module Namespace patching issue described in [#25](https://github.com/Coolhand-Labs/coolhand-node/issues/25).

## The Setup

This is a Fastify server compiled with TypeScript to CommonJS — a typical backend setup (not bundled by webpack/Next.js). It:

- Creates an OpenAI client at module scope (`src/services/openai-client.ts`)
- Initializes `coolhand-node/auto-monitor` inside the server's `start()` function (`src/main.ts`)
- Exposes a `POST /summarize` endpoint that calls `openai.chat.completions.create()`

This mirrors how many TypeScript backends integrate coolhand-node.

## The Bug

`coolhand-node` is ESM-only. When it loads `https` via `await import('https')`, it gets an ESM Module Namespace with **non-configurable** properties. The patching code silently skips when it can't redefine `https.request`. Meanwhile, OpenAI SDK v4.x uses `node-fetch` (not `globalThis.fetch`), so the fetch patch doesn't help either.

The result: monitoring reports "initialized" and "Full (HTTP/HTTPS/Fetch)" mode, but **zero calls are intercepted**.

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

## Verifying the Bug

Start the server with `silent: false` (already set in `src/main.ts`). You'll see:

```
🌐 Global Coolhand monitoring initialized
🎯 API Endpoint: https://coolhandlabs.com/api/v2/llm_request_logs
🔍 Monitoring mode: Full (HTTP/HTTPS/Fetch)
```

Then send a request. You will **NOT** see any `🎯 INTERCEPTING OpenAI` log lines. The OpenAI call completes successfully but is never intercepted.

## Verifying the Fix

After applying the fix from [#25](https://github.com/Coolhand-Labs/coolhand-node/issues/25) (using `createRequire` instead of `await import` for `http`/`https`):

1. Rebuild coolhand-node: `cd ../.. && npm run build`
2. Reinstall in this example: `cd examples/fastify-openai-unbundled && npm install`
3. Rebuild: `npm run build`
4. Start: `npm start`

Now when you send a request, you should see:

```
🎯 INTERCEPTING OpenAI HTTPS call
📞 Starting API call #1 to https://api.openai.com/v1/chat/completions
📤 Request complete for call #1
📥 Response received for call #1, status: 200
✅ Successfully logged to API with ID for call #1
```

## Key Files

| File | Purpose |
|------|---------|
| `tsconfig.json` | `"module": "commonjs"` — matches real-world TypeScript backends |
| `src/main.ts` | Initializes coolhand monitoring in `start()`, same pattern as affected apps |
| `src/services/openai-client.ts` | OpenAI client at module scope — created before monitoring patches |
| `src/services/summarizer.ts` | Uses `openai.chat.completions.create()` with structured output |
| `src/app.ts` | Fastify server with `/summarize` endpoint |
