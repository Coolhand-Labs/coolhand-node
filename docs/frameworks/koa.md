# Koa.js Integration

> **⚠️ Status: Theoretical** - These examples are untested. Please test and [contribute improvements](https://github.com/anthropics/coolhand-node/issues)!

## 🎯 Recommended: Startup Initialization

```javascript
// app.js
const Koa = require('koa');

async function startServer() {
  try {
    // Initialize global monitoring BEFORE setting up app
    if (process.env.COOLHAND_API_KEY) {
      console.log('🌐 Initializing Coolhand global monitoring...');
      const { initializeGlobalMonitoring } = require('coolhand-node/auto-monitor');
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      console.log('✅ Global monitoring enabled for all AI API calls!');
    }

    // Import AI modules AFTER global monitoring initialization
    const { ChatOpenAI } = require('@langchain/openai');
    const app = new Koa();

    app.use(async (ctx, next) => {
      if (ctx.path === '/chat' && ctx.method === 'POST') {
        const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

        // This AI call should be automatically logged
        const response = await model.invoke(ctx.request.body.message);
        ctx.body = { response: response.content };
      } else {
        await next();
      }
    });

    app.listen(3000);
    console.log('✅ Koa server running with global AI monitoring!');
  } catch (error) {
    console.error('❌ Failed to start Koa server:', error);
    process.exit(1);
  }
}

startServer();
```

## With Koa Router

```javascript
// app.js
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');

async function startServer() {
  try {
    // Initialize global monitoring first
    if (process.env.COOLHAND_API_KEY) {
      console.log('🌐 Initializing Coolhand global monitoring...');
      const { initializeGlobalMonitoring } = require('coolhand-node/auto-monitor');
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      console.log('✅ Global monitoring enabled!');
    }

    const { ChatOpenAI } = require('@langchain/openai');
    const app = new Koa();
    const router = new Router();

    // Enable body parsing
    app.use(bodyParser());

    // AI route
    router.post('/chat', async (ctx) => {
      const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await model.invoke(ctx.request.body.message);
      ctx.body = { response: response.content };
    });

    app.use(router.routes());
    app.use(router.allowedMethods());

    app.listen(3000);
    console.log('✅ Koa server with router running!');
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
```

## TypeScript Example

```typescript
// app.ts
import Koa from 'koa';
import Router from '@koa/router';
import bodyParser from 'koa-bodyparser';
import { ChatOpenAI } from '@langchain/openai';

interface ChatRequest {
  message: string;
}

async function startServer() {
  try {
    // Initialize global monitoring
    if (process.env.COOLHAND_API_KEY) {
      console.log('🌐 Initializing Coolhand global monitoring...');
      const { initializeGlobalMonitoring } = await import('coolhand-node/auto-monitor');
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      console.log('✅ Global monitoring enabled!');
    }

    const app = new Koa();
    const router = new Router();

    app.use(bodyParser());

    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
      modelName: 'gpt-3.5-turbo'
    });

    router.post('/chat', async (ctx) => {
      const { message } = ctx.request.body as ChatRequest;
      const response = await model.invoke(message);
      ctx.body = { response: response.content };
    });

    app.use(router.routes());
    app.use(router.allowedMethods());

    app.listen(3000);
    console.log('✅ TypeScript Koa server running!');
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
```

## Alternative: Middleware-based Initialization (Untested)

```javascript
// middleware/coolhand.js
const { initializeGlobalMonitoring } = require('coolhand-node/auto-monitor');

let isInitialized = false;

module.exports = async (ctx, next) => {
  if (!isInitialized && process.env.COOLHAND_API_KEY) {
    try {
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      isInitialized = true;
      console.log('✅ Coolhand initialized via middleware');
    } catch (error) {
      console.error('❌ Failed to initialize Coolhand:', error);
    }
  }
  await next();
};

// app.js
const Koa = require('koa');
const coolhandMiddleware = require('./middleware/coolhand');

const app = new Koa();

// Initialize Coolhand first
app.use(coolhandMiddleware);

// Rest of your middleware and routes
```

## 📝 Please Test and Contribute!

If you're using Koa.js with Coolhand, please test the approach above and share your experience!

**Koa-specific considerations:**
- Middleware execution order
- Async/await patterns
- Context object interaction
- Router integration

## Environment Setup

```bash
# .env
COOLHAND_API_KEY=your_coolhand_key
NODE_ENV=development
```

## Expected Behavior

When working correctly, you should see:
- Koa startup logs showing global monitoring initialization
- AI API calls automatically logged to Coolhand
- Normal Koa middleware flow preserved