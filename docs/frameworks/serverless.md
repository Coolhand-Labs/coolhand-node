# Serverless Integration

> **⚠️ Status: Theoretical** - These examples are untested. Please test and [contribute improvements](https://github.com/Coolhand-Labs/coolhand-node/issues)!

## Module System Background

`coolhand-node` is an **ES module** package. You cannot use `require('coolhand-node')`. Use dynamic `import()` instead. In TypeScript projects compiling to CommonJS, use the `new Function` workaround (see [TypeScript Lambda](#typescript-lambda) below).

## AWS Lambda

### Basic Lambda Handler (ESM)

```javascript
// handler.mjs (ESM — use .mjs extension or "type": "module" in package.json)
let monitoringInitialized = false;

// Initialize once (outside handler for container reuse)
async function ensureMonitoring() {
  if (!monitoringInitialized && process.env.COOLHAND_API_KEY) {
    const { initializeGlobalMonitoring } = await import('coolhand-node');
    await initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      silent: true
    });
    monitoringInitialized = true;
  }
}

export const handler = async (event) => {
  await ensureMonitoring();

  // AI calls here are automatically monitored
  const response = await model.invoke(event.body.message);

  return {
    statusCode: 200,
    body: JSON.stringify({ response: response.content })
  };
};
```

### TypeScript Lambda

```typescript
// handler.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import OpenAI from 'openai';

let monitoringInitialized = false;

async function ensureMonitoring() {
  if (!monitoringInitialized && process.env.COOLHAND_API_KEY) {
    // new Function emits a native import() that survives CJS compilation
    const _import = new Function('m', 'return import(m)');
    const { initializeGlobalMonitoring } = await _import('coolhand-node');
    await initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      silent: true
    });
    monitoringInitialized = true;
  }
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  await ensureMonitoring();

  try {
    const body = JSON.parse(event.body || '{}');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: body.message }]
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: response.choices[0].message.content })
    };
  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
```

> **Tip:** If your Lambda uses ESM (Node.js 18+ with `"type": "module"` or `.mjs` handler), you can use `await import('coolhand-node')` directly without the `new Function` workaround.

## Vercel Functions

> **⚠️ Note**: Vercel Serverless Functions run Node.js. Vercel Edge Functions have limited Node.js API support.

```javascript
// api/chat.js (Vercel uses ESM by default in recent versions)
import { initializeGlobalMonitoring } from 'coolhand-node';

let monitoringInitialized = false;

async function ensureMonitoring() {
  if (!monitoringInitialized && process.env.COOLHAND_API_KEY) {
    await initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      silent: true
    });
    monitoringInitialized = true;
  }
}

export default async function handler(req, res) {
  await ensureMonitoring();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // AI calls here are automatically monitored
    const response = await model.invoke(req.body.message);
    res.json({ response: response.content });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Failed to generate response' });
  }
}
```

## Netlify Functions

```javascript
// netlify/functions/chat.mjs (use .mjs for ESM)
let monitoringInitialized = false;

async function ensureMonitoring() {
  if (!monitoringInitialized && process.env.COOLHAND_API_KEY) {
    const { initializeGlobalMonitoring } = await import('coolhand-node');
    await initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      silent: true
    });
    monitoringInitialized = true;
  }
}

export const handler = async (event) => {
  await ensureMonitoring();

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { message } = JSON.parse(event.body);
    const response = await model.invoke(message);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: response.content })
    };
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate response' })
    };
  }
};
```

## Cloudflare Workers

> **⚠️ Limited Support**: Cloudflare Workers run in an Edge-like runtime with limited Node.js API support. HTTP/HTTPS patching is not available — only `fetch()` monitoring works.

```javascript
// worker.js
import { initializeGlobalMonitoring } from 'coolhand-node';

let monitoringInitialized = false;

export default {
  async fetch(request, env) {
    if (!monitoringInitialized) {
      try {
        await initializeGlobalMonitoring({
          apiKey: env.COOLHAND_API_KEY,
          silent: true
        });
        monitoringInitialized = true;
      } catch (error) {
        // Edge runtime — limited monitoring support
        console.warn('Limited Coolhand support in Cloudflare Workers');
      }
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const { message } = await request.json();

      // fetch-based AI calls are monitored
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: message }]
        })
      });

      const data = await response.json();
      return Response.json({ response: data.choices[0].message.content });
    } catch (error) {
      return new Response('Internal error', { status: 500 });
    }
  }
};
```

## Best Practices for Serverless

### 1. Cold Start Optimization
Initialize outside the handler so monitoring persists across warm invocations:

```javascript
let monitoringInitialized = false;

async function ensureMonitoring() {
  if (!monitoringInitialized && process.env.COOLHAND_API_KEY) {
    const { initializeGlobalMonitoring } = await import('coolhand-node');
    await initializeGlobalMonitoring({ apiKey: process.env.COOLHAND_API_KEY, silent: true });
    monitoringInitialized = true;
  }
}

export const handler = async (event) => {
  await ensureMonitoring();
  // ...
};
```

### 2. Environment Variables
```bash
# AWS Lambda / Netlify / Vercel
COOLHAND_API_KEY=your_key
OPENAI_API_KEY=your_openai_key

# Cloudflare Workers (wrangler.toml)
[vars]
COOLHAND_API_KEY = "your_key"
OPENAI_API_KEY = "your_openai_key"
```

### 3. Error Handling
Always wrap initialization in try/catch — monitoring failure should never take down your function:

```javascript
try {
  const { initializeGlobalMonitoring } = await import('coolhand-node');
  await initializeGlobalMonitoring(config);
} catch (error) {
  console.warn('Coolhand initialization failed:', error.message);
  // Continue without monitoring
}
```

## Runtime Compatibility

| Platform | Node.js APIs | HTTP Patching | Fetch Monitoring | Status |
|----------|--------------|---------------|------------------|--------|
| **AWS Lambda** | ✅ Full | ✅ Yes | ✅ Yes | Theoretical |
| **Vercel Functions** | ⚠️ Limited | ⚠️ Maybe | ✅ Yes | Theoretical |
| **Netlify Functions** | ✅ Full | ✅ Yes | ✅ Yes | Theoretical |
| **Cloudflare Workers** | ❌ Limited | ❌ No | ⚠️ Fetch only | Limited |
| **Supabase Edge** | ❌ Deno | ❌ No | ⚠️ Manual | Limited |

## Please Test and Contribute!

Serverless environments vary significantly. If you're using any serverless platform:

1. **Test the initialization approach for your platform**
2. **Verify AI API calls are being logged**
3. **[Create an issue](https://github.com/Coolhand-Labs/coolhand-node/issues)** with your results
4. **Share platform-specific gotchas and solutions**
