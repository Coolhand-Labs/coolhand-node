# Fastify Integration

> **✅ Status: Tested** - Verified with the `examples/fastify-openai-unbundled` example app. See the [working example](../../examples/fastify-openai-unbundled/) for a complete reference.

## Module System Background

`coolhand-node` is an **ES module** package. How you import it depends on your Fastify project's module system:

- **ESM projects** (`"type": "module"` in package.json): Use `import` or `await import()` directly
- **CJS/TypeScript projects** (`"module": "commonjs"` in tsconfig): TypeScript compiles `await import()` into `require()`, which fails for ESM packages. Use the `new Function` workaround shown below.

## 🎯 Recommended: TypeScript + CJS (Most Common Fastify Setup)

Most Fastify + TypeScript projects compile to CommonJS. This is the tested, working approach:

```typescript
// main.ts
import config from './config';
import build from './app';

const server = build();

export async function start(port = 3000) {
  // Initialize Coolhand BEFORE server.listen()
  if (process.env.COOLHAND_API_KEY) {
    // new Function emits a native import() that survives CJS compilation.
    // TypeScript compiles `await import()` to `require()`, which fails
    // because coolhand-node is an ES module.
    const _import = new Function('m', 'return import(m)');
    const { initializeGlobalMonitoring } = await _import('coolhand-node');
    await initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      debug: process.env.COOLHAND_DEBUG === 'true',
      silent: false
    });
    server.log.info('Coolhand LLM monitoring initialized');
  }

  await server.listen({ port, host: '0.0.0.0' });
}

start();
```

```json
// tsconfig.json — note "module": "commonjs"
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "es2022",
    "esModuleInterop": true,
    "outDir": "./dist"
  }
}
```

> **Why `new Function`?** When tsconfig has `"module": "commonjs"`, TypeScript converts `await import('coolhand-node')` into `require('coolhand-node')` at compile time. Since `coolhand-node` is ESM-only, `require()` throws `ERR_REQUIRE_ESM`. The `new Function('m', 'return import(m)')` pattern emits a real native `import()` in the compiled output that Node.js executes as ESM.

## ESM Fastify Projects

If your Fastify project is already ESM (`"type": "module"` in package.json, or `"module": "ES2020"+"` in tsconfig), you can import directly:

```typescript
// main.ts (ESM)
import { initializeGlobalMonitoring } from 'coolhand-node';
import Fastify from 'fastify';

const fastify = Fastify({ logger: true });

async function startServer() {
  if (process.env.COOLHAND_API_KEY) {
    await initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      debug: process.env.COOLHAND_DEBUG === 'true',
      silent: false
    });
    fastify.log.info('Coolhand LLM monitoring initialized');
  }

  // Register routes...
  await fastify.listen({ port: 3000, host: '0.0.0.0' });
}

startServer();
```

## Alternative: Plugin-Based Initialization

```typescript
// plugins/coolhand.ts
import { FastifyPluginAsync } from 'fastify';

const coolhandPlugin: FastifyPluginAsync = async (fastify) => {
  if (process.env.COOLHAND_API_KEY) {
    try {
      const _import = new Function('m', 'return import(m)');
      const { initializeGlobalMonitoring } = await _import('coolhand-node');
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      fastify.log.info('Coolhand global monitoring initialized');
    } catch (error) {
      fastify.log.error('Failed to initialize Coolhand:', error);
    }
  }
};

export default coolhandPlugin;
```

## Working Example App

See [`examples/fastify-openai-unbundled/`](../../examples/fastify-openai-unbundled/) for a complete, tested example with:

- Fastify + TypeScript compiling to CommonJS
- OpenAI SDK v4.82+ (client created at module scope)
- `coolhand-node` initialized via `new Function` import in `start()`
- Full HTTP/HTTPS/Fetch monitoring confirmed working

To run:
```bash
cd examples/fastify-openai-unbundled
npm install
npm run build
OPENAI_API_KEY=sk-... COOLHAND_API_KEY=your-key node dist/main.js
```

## Key Points

- **Initialize before `server.listen()`** — Coolhand patches `http`/`https`/`fetch` at initialization. Calls made before initialization won't be captured.
- **AI clients can be created at module scope** — The OpenAI client (or any AI SDK) can be instantiated before Coolhand initializes. Coolhand patches the underlying `http`/`https` modules, not the SDK objects.
- **Zero performance impact** — Monitoring adds negligible overhead to request processing.

## Environment Setup

```bash
# .env
COOLHAND_API_KEY=your_coolhand_key
COOLHAND_DEBUG=false
OPENAI_API_KEY=your_openai_key
```

## Expected Behavior

When working correctly, you should see:
```
🌐 Global Coolhand monitoring initialized
🎯 API Endpoint: https://coolhandlabs.com/api/v2/llm_request_logs
📋 Loaded 3 AI API patterns
🔍 Monitoring mode: Full (HTTP/HTTPS/Fetch)
```

AI API calls (OpenAI, Anthropic, Google AI, etc.) are automatically intercepted, sanitized, and logged to Coolhand.
