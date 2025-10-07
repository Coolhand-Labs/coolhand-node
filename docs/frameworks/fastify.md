# Fastify Integration

> **⚠️ Status: Theoretical** - These examples are untested. Please test and [contribute improvements](https://github.com/anthropics/coolhand-node/issues)!

## 🎯 Recommended: Startup Initialization

Based on Next.js learnings, initialize before server startup:

```javascript
// app.js
const fastify = require('fastify')({ logger: true });

async function startServer() {
  try {
    // Initialize global monitoring BEFORE registering routes
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
    const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Register AI routes
    fastify.post('/chat', async (request, reply) => {
      // This AI call should be automatically logged
      const response = await model.invoke(request.body.message);
      return { response: response.content };
    });

    // Start server
    await fastify.listen({ port: 3000 });
    console.log('✅ Fastify server running with global AI monitoring!');
  } catch (error) {
    console.error('❌ Failed to start Fastify server:', error);
    process.exit(1);
  }
}

startServer();
```

## Alternative: Plugin-Based Initialization (Untested)

```javascript
// plugins/coolhand.js
async function coolhandPlugin(fastify, options) {
  if (process.env.COOLHAND_API_KEY) {
    try {
      const { initializeGlobalMonitoring } = require('coolhand-node/auto-monitor');
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      fastify.log.info('✅ Coolhand global monitoring initialized');
    } catch (error) {
      fastify.log.error('❌ Failed to initialize Coolhand:', error);
    }
  }
}

module.exports = coolhandPlugin;

// app.js
const fastify = require('fastify')({ logger: true });

async function startServer() {
  // Register Coolhand plugin first
  await fastify.register(require('./plugins/coolhand'));

  // Register AI routes
  const { ChatOpenAI } = require('@langchain/openai');
  const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

  fastify.post('/chat', async (request, reply) => {
    const response = await model.invoke(request.body.message);
    return { response: response.content };
  });

  await fastify.listen({ port: 3000 });
}

startServer();
```

## TypeScript Example

```typescript
// app.ts
import Fastify from 'fastify';
import { ChatOpenAI } from '@langchain/openai';

const fastify = Fastify({ logger: true });

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

    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
      modelName: 'gpt-3.5-turbo'
    });

    // Define schema
    const chatSchema = {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' }
        }
      }
    };

    fastify.post('/chat', { schema: chatSchema }, async (request, reply) => {
      const { message } = request.body as { message: string };
      const response = await model.invoke(message);
      return { response: response.content };
    });

    await fastify.listen({ port: 3000, host: '0.0.0.0' });
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
}

startServer();
```

## 📝 Please Test and Contribute!

If you're using Fastify with Coolhand:
1. **Try the startup initialization approach above**
2. **Test plugin-based initialization as alternative**
3. **[Create an issue](https://github.com/anthropics/coolhand-node/issues)** with your results

**Fastify-specific considerations:**
- Plugin loading order and lifecycle
- Performance impact (should be zero)
- TypeScript integration
- Schema validation interaction

## Environment Setup

```bash
# .env
COOLHAND_API_KEY=your_coolhand_key
NODE_ENV=development
```

## Expected Behavior

When working correctly, you should see:
- Fastify startup logs showing global monitoring initialization
- AI API calls automatically logged to Coolhand
- No impact on Fastify's performance characteristics