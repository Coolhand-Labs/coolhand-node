# Serverless Integration

> **⚠️ Status: Theoretical** - These examples are untested. Please test and [contribute improvements](https://github.com/anthropics/coolhand-node/issues)!

## AWS Lambda

### Basic Lambda Handler

```javascript
// handler.js
const { initializeGlobalMonitoring } = require('coolhand-node/auto-monitor');

// Initialize once (outside handler for container reuse)
if (process.env.COOLHAND_API_KEY) {
  initializeGlobalMonitoring({
    apiKey: process.env.COOLHAND_API_KEY,
    environment: 'production',
    silent: true
  });
}

const { ChatOpenAI } = require('@langchain/openai');

exports.handler = async (event) => {
  const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Automatically monitored!
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
import { initializeGlobalMonitoring } from 'coolhand-node/auto-monitor';
import { ChatOpenAI } from '@langchain/openai';

// Initialize once per container
if (process.env.COOLHAND_API_KEY && !global._coolhandInitialized) {
  initializeGlobalMonitoring({
    apiKey: process.env.COOLHAND_API_KEY,
    environment: 'production',
    silent: true
  });
  global._coolhandInitialized = true;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const body = JSON.parse(event.body || '{}');

    const model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
      modelName: 'gpt-3.5-turbo'
    });

    const response = await model.invoke(body.message);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ response: response.content })
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

## Vercel Functions

> **⚠️ Note**: May have Edge runtime limitations

```javascript
// api/chat.js
import { initializeGlobalMonitoring } from 'coolhand-node/auto-monitor';

// Initialize monitoring (runs once per cold start)
if (process.env.COOLHAND_API_KEY && !global._coolhandInitialized) {
  initializeGlobalMonitoring({
    apiKey: process.env.COOLHAND_API_KEY,
    environment: 'production',
    silent: true
  });
  global._coolhandInitialized = true;
}

import { ChatOpenAI } from '@langchain/openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Automatically monitored!
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
// netlify/functions/chat.js
const { initializeGlobalMonitoring } = require('coolhand-node/auto-monitor');

// Initialize once per function instance
if (process.env.COOLHAND_API_KEY && !global._coolhandInitialized) {
  initializeGlobalMonitoring({
    apiKey: process.env.COOLHAND_API_KEY,
    environment: 'production',
    silent: true
  });
  global._coolhandInitialized = true;
}

const { ChatOpenAI } = require('@langchain/openai');

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { message } = JSON.parse(event.body);

    const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Automatically monitored!
    const response = await model.invoke(message);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
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

> **⚠️ Limited Support**: Cloudflare Workers have limited Node.js API support

```javascript
// worker.js
import { initializeGlobalMonitoring } from 'coolhand-node/auto-monitor';

// Limited initialization for Edge runtime
if (globalThis.COOLHAND_API_KEY) {
  try {
    initializeGlobalMonitoring({
      apiKey: globalThis.COOLHAND_API_KEY,
      environment: 'production',
      silent: true
    });
  } catch (error) {
    // Edge runtime may not support full monitoring
    console.warn('Limited Coolhand support in Cloudflare Workers');
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const { message } = await request.json();

      // Use fetch-based AI APIs (OpenAI works via fetch)
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: message }]
        })
      });

      const data = await response.json();

      return Response.json({
        response: data.choices[0].message.content
      });
    } catch (error) {
      return new Response('Internal error', { status: 500 });
    }
  }
};
```

## Supabase Edge Functions

```typescript
// supabase/functions/chat/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

// Note: Deno runtime - limited Node.js compatibility
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { message } = await req.json();

    // Use fetch-based approach for AI APIs
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: message }]
      })
    });

    const data = await response.json();

    return new Response(JSON.stringify({
      response: data.choices[0].message.content
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
```

## 📝 Best Practices for Serverless

### 1. Cold Start Optimization
```javascript
// Initialize outside handler for container reuse
let isInitialized = false;

if (process.env.COOLHAND_API_KEY && !isInitialized) {
  initializeGlobalMonitoring({ /* config */ });
  isInitialized = true;
}

exports.handler = async (event) => {
  // Handler logic here
};
```

### 2. Environment Variables
```bash
# AWS Lambda / Netlify / Vercel
COOLHAND_API_KEY=your_key
OPENAI_API_KEY=your_openai_key
NODE_ENV=production

# Cloudflare Workers (wrangler.toml)
[vars]
COOLHAND_API_KEY = "your_key"
OPENAI_API_KEY = "your_openai_key"
```

### 3. Error Handling
```javascript
try {
  initializeGlobalMonitoring(config);
} catch (error) {
  console.warn('Coolhand initialization failed:', error);
  // Continue without monitoring rather than failing
}
```

## Runtime Compatibility

| Platform | Node.js APIs | HTTP Patching | Fetch Monitoring | Status |
|----------|--------------|---------------|------------------|--------|
| **AWS Lambda** | ✅ Full | ✅ Yes | ✅ Yes | Theoretical |
| **Vercel Functions** | ⚠️ Limited | ⚠️ Maybe | ✅ Yes | Theoretical |
| **Netlify Functions** | ✅ Full | ✅ Yes | ✅ Yes | Theoretical |
| **Cloudflare Workers** | ❌ Limited | ❌ No | ⚠️ Manual | Limited |
| **Supabase Edge** | ❌ Deno | ❌ No | ⚠️ Manual | Limited |

## 📝 Please Test and Contribute!

Serverless environments vary significantly. If you're using any serverless platform:

1. **Test the initialization approach for your platform**
2. **Verify AI API calls are being logged**
3. **[Create an issue](https://github.com/anthropics/coolhand-node/issues)** with your results
4. **Share platform-specific gotchas and solutions**

**Common considerations:**
- Cold start performance impact
- Runtime environment limitations
- Environment variable configuration
- Container reuse patterns