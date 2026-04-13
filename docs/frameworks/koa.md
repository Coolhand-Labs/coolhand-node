# Koa.js Integration

> **⚠️ Status: Theoretical** - Based on tested Fastify patterns. Please test and [contribute improvements](https://github.com/Coolhand-Labs/coolhand-node/issues)!

## Module System Background

`coolhand-node` is an **ES module** package. Koa apps are typically CommonJS, so you cannot use `require('coolhand-node')`. Use dynamic `import()` instead.

## 🎯 Recommended: Async Startup Initialization

```javascript
// app.js (CommonJS)
const Koa = require('koa');

async function startServer() {
  try {
    // Initialize global monitoring BEFORE setting up app
    if (process.env.COOLHAND_API_KEY) {
      const { initializeGlobalMonitoring } = await import('coolhand-node');
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      console.log('✅ Coolhand monitoring enabled');
    }

    const app = new Koa();

    app.use(async (ctx) => {
      if (ctx.path === '/chat' && ctx.method === 'POST') {
        // AI calls here are automatically monitored
        const response = await model.invoke(ctx.request.body.message);
        ctx.body = { response: response.content };
      }
    });

    app.listen(3000);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
```

## With Koa Router

```javascript
// app.js (CommonJS)
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');

async function startServer() {
  // Initialize global monitoring first
  if (process.env.COOLHAND_API_KEY) {
    const { initializeGlobalMonitoring } = await import('coolhand-node');
    await initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      silent: process.env.NODE_ENV === 'production'
    });
  }

  const app = new Koa();
  const router = new Router();

  app.use(bodyParser());

  router.post('/chat', async (ctx) => {
    // AI calls here are automatically monitored
    const response = await model.invoke(ctx.request.body.message);
    ctx.body = { response: response.content };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());

  app.listen(3000);
}

startServer();
```

## TypeScript Compiling to CommonJS

If your `tsconfig.json` has `"module": "commonjs"`, TypeScript compiles `await import()` into `require()`, which fails for ESM packages. Use the `new Function` workaround:

```typescript
// app.ts
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';

async function startServer() {
  if (process.env.COOLHAND_API_KEY) {
    // new Function emits a native import() that survives CJS compilation
    const _import = new Function('m', 'return import(m)');
    const { initializeGlobalMonitoring } = await _import('coolhand-node');
    await initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      silent: process.env.NODE_ENV === 'production'
    });
  }

  const app = new Koa();
  const router = new Router();

  app.use(bodyParser());

  router.post('/chat', async (ctx) => {
    const response = await model.invoke(ctx.request.body.message);
    ctx.body = { response: response.content };
  });

  app.use(router.routes());
  app.use(router.allowedMethods());

  app.listen(3000);
}

startServer();
```

> **Tip:** If your tsconfig uses `"module": "ES2020"`, `"ESNext"`, or `"NodeNext"`, TypeScript preserves the native `import()` and you can use `await import('coolhand-node')` directly without the `new Function` workaround.

## ESM Koa Projects

If your Koa project uses ESM (`"type": "module"` in package.json):

```javascript
// app.js (ESM)
import Koa from 'koa';
import { initializeGlobalMonitoring } from 'coolhand-node';

async function startServer() {
  if (process.env.COOLHAND_API_KEY) {
    await initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      silent: process.env.NODE_ENV === 'production'
    });
  }

  const app = new Koa();
  // ... routes
  app.listen(3000);
}

startServer();
```

## Key Points

- **Initialize before setting up routes** — Coolhand patches `http`/`https`/`fetch` at initialization time.
- **`require('coolhand-node')` will not work** — This package is ESM-only. Always use `import()` or `import` syntax.
- **Koa middleware order doesn't matter** — Coolhand patches at the Node.js module level, not the middleware level.

## Environment Setup

```bash
# .env
COOLHAND_API_KEY=your_coolhand_key
COOLHAND_DEBUG=false
```

## Expected Behavior

When working correctly, you should see:
- Startup logs showing global monitoring initialization
- AI API calls automatically logged to Coolhand
- Normal Koa middleware flow preserved
