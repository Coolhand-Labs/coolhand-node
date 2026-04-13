# Express.js Integration

> **⚠️ Status: Theoretical** - Based on tested Fastify patterns. Please test and [contribute improvements](https://github.com/Coolhand-Labs/coolhand-node/issues)!

## Module System Background

`coolhand-node` is an **ES module** package. Express apps are typically CommonJS, so you cannot use `require('coolhand-node')`. Use dynamic `import()` instead.

## 🎯 Recommended: Async Startup Initialization

```javascript
// app.js (CommonJS)
const express = require('express');

async function startServer() {
  try {
    // Initialize global monitoring BEFORE setting up routes
    if (process.env.COOLHAND_API_KEY) {
      const { initializeGlobalMonitoring } = await import('coolhand-node');
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      console.log('✅ Coolhand monitoring enabled');
    }

    const app = express();

    app.post('/chat', async (req, res) => {
      // AI calls here are automatically monitored
      const response = await model.invoke(req.body.message);
      res.json({ response: response.content });
    });

    app.listen(3000, () => {
      console.log('Server running on port 3000');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
```

## TypeScript Compiling to CommonJS

If your `tsconfig.json` has `"module": "commonjs"`, TypeScript compiles `await import()` into `require()`, which fails for ESM packages. Use the `new Function` workaround:

```typescript
// app.ts
import express from 'express';

async function startServer() {
  if (process.env.COOLHAND_API_KEY) {
    // new Function emits a native import() that survives CJS compilation
    const _import = new Function('m', 'return import(m)');
    const { initializeGlobalMonitoring } = await _import('coolhand-node');
    await initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      silent: process.env.NODE_ENV === 'production'
    });
    console.log('✅ Coolhand monitoring enabled');
  }

  const app = express();

  app.post('/chat', async (req, res) => {
    // AI calls here are automatically monitored
    const response = await model.invoke(req.body.message);
    res.json({ response: response.content });
  });

  app.listen(3000);
}

startServer();
```

> **Tip:** If your tsconfig uses `"module": "ES2020"`, `"ESNext"`, or `"NodeNext"`, TypeScript preserves the native `import()` and you can use `await import('coolhand-node')` directly without the `new Function` workaround.

## ESM Express Projects

If your Express project uses ESM (`"type": "module"` in package.json):

```javascript
// app.js (ESM)
import express from 'express';
import { initializeGlobalMonitoring } from 'coolhand-node';

async function startServer() {
  if (process.env.COOLHAND_API_KEY) {
    await initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      silent: process.env.NODE_ENV === 'production'
    });
  }

  const app = express();

  app.post('/chat', async (req, res) => {
    const response = await model.invoke(req.body.message);
    res.json({ response: response.content });
  });

  app.listen(3000);
}

startServer();
```

## Key Points

- **Initialize before defining routes** — Coolhand patches `http`/`https`/`fetch` at initialization time. Calls made before initialization won't be captured.
- **AI clients can be created at module scope** — Coolhand patches the underlying Node.js modules, not SDK objects. The OpenAI client can be instantiated before Coolhand initializes.
- **`require('coolhand-node')` will not work** — This package is ESM-only. Always use `import()` or `import` syntax.

## Environment Setup

```bash
# .env
COOLHAND_API_KEY=your_coolhand_key
COOLHAND_DEBUG=false
```

## Expected Behavior

When working correctly, you should see:
- Startup logs showing global monitoring initialization
- AI API calls automatically logged to Coolhand dashboard
- Zero changes needed to existing route handlers
