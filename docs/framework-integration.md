# Framework Integration Guide

Coolhand's global monitoring works with **any Node.js framework** because it patches core HTTP modules (`https`, `http`, `fetch`) at the Node.js level. This guide shows how to integrate with popular frameworks.

## 🎯 Compatibility Overview

| Framework | Compatibility | Integration Method | Notes |
|-----------|---------------|-------------------|-------|
| **Express.js** | ✅ Excellent | Middleware | Works with any Express app |
| **Next.js/T3** | ✅ Excellent | next.config.js | Perfect for SSR/API routes |
| **NestJS** | ✅ Excellent | Module/Bootstrap | Integrates with DI system |
| **Fastify** | ✅ Excellent | Plugin/Hook | High-performance compatible |
| **Koa.js** | ✅ Excellent | Middleware | Works with async/await |
| **Hapi.js** | ✅ Excellent | Plugin | Plugin system integration |
| **AWS Lambda** | ✅ Excellent | Handler wrapper | Serverless compatible |
| **Vercel Functions** | ✅ Excellent | Function wrapper | Edge runtime compatible |
| **Cloudflare Workers** | ⚠️ Limited | Manual setup | Limited Node.js API support |
| **Deno** | ❌ Not supported | N/A | Different runtime environment |

## 🚀 Express.js Integration

Express.js is the most popular Node.js framework and works perfectly with global monitoring.

### Method 1: Auto-Monitor (Simplest)

```javascript
// app.js - Import at the very top
require('coolhand-node/auto-monitor');

const express = require('express');
const { ChatOpenAI } = require('@langchain/openai');

const app = express();
const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/chat', async (req, res) => {
  // This AI call is automatically logged!
  const response = await model.invoke(req.body.message);
  res.json({ response: response.content });
});

app.listen(3000);
```

### Method 2: Manual Initialization

```javascript
// app.js
const express = require('express');
const { initializeGlobalMonitoring } = require('coolhand-node');

// Initialize monitoring before any AI libraries
initializeGlobalMonitoring({
  apiKey: process.env.COOLHAND_API_KEY,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
  silent: process.env.NODE_ENV === 'production'
});

// Now import AI libraries
const { ChatOpenAI } = require('@langchain/openai');
const app = express();

// Your routes here - all AI calls automatically monitored
```

### Method 3: Express Middleware

```javascript
// middleware/coolhand.js
const { initializeGlobalMonitoring, isGlobalMonitoringActive } = require('coolhand-node');

function coolhandMiddleware(req, res, next) {
  if (!isGlobalMonitoringActive() && process.env.COOLHAND_API_KEY) {
    initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
      silent: process.env.NODE_ENV === 'production'
    });
  }
  next();
}

module.exports = coolhandMiddleware;

// app.js
const express = require('express');
const coolhandMiddleware = require('./middleware/coolhand');

const app = express();
app.use(coolhandMiddleware); // Apply to all routes

// Your AI routes here
```

## ⚡ Next.js / T3 Stack Integration

Next.js and the T3 stack (Next.js + TypeScript + tRPC) work excellently with Coolhand's global monitoring. The key consideration is that **Next.js middleware runs in Edge runtime** (limited Node.js APIs), while **API routes run in Node.js runtime** (full HTTP patching capability).

### 🎯 Recommended Approach: next.config.js Initialization

The best approach for Next.js is to initialize global monitoring in `next.config.js`, which runs in Node.js runtime and provides full HTTP/HTTPS monitoring capabilities.

```javascript
// next.config.js
import "./src/env.js"; // Load environment variables

// Initialize global monitoring for Next.js web server (Node.js runtime)
(async () => {
  try {
    if (process.env.COOLHAND_API_KEY) {
      console.log('🌐 Initializing Coolhand global monitoring...');
      const { initializeGlobalMonitoring } = await import('coolhand-node/auto-monitor');
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      console.log('✅ Global monitoring enabled for all AI API calls!');
    }
  } catch (error) {
    console.error('❌ Failed to initialize global monitoring:', error);
  }
})();

/** @type {import("next").NextConfig} */
const config = {
  // Your Next.js config
};

export default config;
```

### 📁 Shared Module for Scripts (Optional)

For standalone scripts or when you need more control, create a shared initialization module:

```typescript
// src/lib/global-monitoring.ts
let isInitialized = false;

export async function initializeGlobalMonitoring() {
  if (isInitialized) {
    console.log('🔄 Global monitoring already initialized, skipping...');
    return;
  }

  try {
    if (process.env.COOLHAND_API_KEY) {
      console.log('🌐 Initializing Coolhand global monitoring...');
      const { initializeGlobalMonitoring } = await import('coolhand-node/auto-monitor');
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      isInitialized = true;
      console.log('✅ Global monitoring enabled for all AI API calls!');
    }
  } catch (error) {
    console.error('❌ Failed to initialize global monitoring:', error);
  }
}
```

Then use it in scripts:

```typescript
// scripts/ai-script.ts
import dotenv from 'dotenv';
import { initializeGlobalMonitoring } from '../src/lib/global-monitoring';

dotenv.config();

async function main() {
  // Initialize global monitoring for scripts
  await initializeGlobalMonitoring();

  // Your AI code here - automatically monitored
  const { ChatOpenAI } = await import('@langchain/openai');
  const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await model.invoke("Hello!");
}

main();
```

### 🎪 Example: T3 Stack with tRPC

Here's a complete example showing Coolhand integration with a T3 stack application:

```typescript
// src/server/api/routers/ai.ts
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { ChatOpenAI } from '@langchain/openai';

export const aiRouter = createTRPCRouter({
  chat: publicProcedure
    .input(z.object({ message: z.string() }))
    .mutation(async ({ input }) => {
      // This AI call is automatically monitored by global monitoring!
      const model = new ChatOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        modelName: 'gpt-3.5-turbo'
      });

      const response = await model.invoke(input.message);
      return { response: response.content };
    }),
});
```

### 🏗️ Service-Level Monitoring (Alternative)

For more granular control, you can use the Coolhand constructor pattern in specific services:

```typescript
// src/lib/ai-service.ts
import { Coolhand } from 'coolhand-node';
import { ChatOpenAI } from '@langchain/openai';

export class AIService {
  private coolhand: Coolhand;
  private model: ChatOpenAI;

  constructor(
    openAIApiKey: string,
    coolhandApiKey: string,
    silent: boolean = false
  ) {
    // Initialize Coolhand for this service
    this.coolhand = new Coolhand({
      apiKey: coolhandApiKey,
      silent: silent
    });

    // Initialize OpenAI model
    this.model = new ChatOpenAI({
      apiKey: openAIApiKey,
      modelName: 'gpt-3.5-turbo',
      temperature: 0.7,
    });
  }

  async generateResponse(prompt: string) {
    try {
      const response = await this.model.invoke(prompt);

      // Optional: Send feedback to Coolhand
      await this.coolhand.createFeedback({
        like: true,
        explanation: "Service generated response successfully",
        original_output: response.content,
        client_unique_id: `ai-service-${Date.now()}`
      });

      return response.content;
    } catch (error) {
      console.error('Error generating response:', error);
      throw error;
    }
  }
}

// Usage in API route
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const aiService = new AIService(
    process.env.OPENAI_API_KEY!,
    process.env.COOLHAND_API_KEY!,
    process.env.NODE_ENV === 'production'
  );

  const response = await aiService.generateResponse(req.body.prompt);
  res.json({ response });
}
```

### 🚨 Edge Runtime Considerations

**Important**: Next.js middleware runs in Edge runtime which has limited Node.js API access. If you need monitoring in middleware, it will be limited to `fetch()` calls only:

```typescript
// src/middleware.ts (Edge Runtime - Limited)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Edge runtime - can only monitor fetch() calls
  // HTTP/HTTPS modules are not available

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*'
};
```

**Recommendation**: Use `next.config.js` initialization for full monitoring capabilities.

### ✅ What Gets Monitored

With global monitoring enabled in `next.config.js`, all of these are automatically logged:

- **tRPC procedures** using AI APIs (OpenAI, Anthropic, etc.)
- **API routes** (`/api/*`) making AI calls
- **Server-side rendering** AI calls
- **Background jobs** and scripts
- **Any Node.js HTTP/HTTPS requests** to AI services

### 🔧 Environment Setup

```bash
# .env.local
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
COOLHAND_API_KEY=your_coolhand_key
```

## 🏗️ NestJS Integration

NestJS with its dependency injection system provides excellent integration options.

### Method 1: Bootstrap Integration

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { initializeGlobalMonitoring } from 'coolhand-node';
import { AppModule } from './app.module';

async function bootstrap() {
  // Initialize global monitoring before creating app
  initializeGlobalMonitoring({
    apiKey: process.env.COOLHAND_API_KEY!,
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
    silent: process.env.NODE_ENV === 'production'
  });

  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

bootstrap();
```

### Method 2: Global Module

```typescript
// coolhand/coolhand.module.ts
import { Global, Module, OnModuleInit } from '@nestjs/common';
import { initializeGlobalMonitoring } from 'coolhand-node';

@Global()
@Module({})
export class CoolhandModule implements OnModuleInit {
  onModuleInit() {
    if (process.env.COOLHAND_API_KEY) {
      initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
        silent: process.env.NODE_ENV === 'production'
      });
    }
  }
}

// app.module.ts
import { Module } from '@nestjs/common';
import { CoolhandModule } from './coolhand/coolhand.module';

@Module({
  imports: [CoolhandModule, /* other modules */],
})
export class AppModule {}
```

### Method 3: Service Integration

```typescript
// ai/ai.service.ts
import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';

@Injectable()
export class AiService {
  private model: ChatOpenAI;

  constructor() {
    // No Coolhand setup needed - global monitoring handles everything!
    this.model = new ChatOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      modelName: 'gpt-3.5-turbo',
    });
  }

  async generateResponse(prompt: string): Promise<string> {
    // This call is automatically logged by global monitoring
    const response = await this.model.invoke(prompt);
    return response.content as string;
  }
}
```

## ⚡ Fastify Integration

Fastify's high-performance architecture works seamlessly with global monitoring.

### Method 1: Plugin Integration

```javascript
// plugins/coolhand.js
const fp = require('fastify-plugin');
const { initializeGlobalMonitoring } = require('coolhand-node');

async function coolhandPlugin(fastify, options) {
  if (process.env.COOLHAND_API_KEY) {
    initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
      silent: process.env.NODE_ENV === 'production'
    });
    fastify.log.info('Coolhand global monitoring initialized');
  }
}

module.exports = fp(coolhandPlugin);

// app.js
const fastify = require('fastify')({ logger: true });

// Register Coolhand plugin first
fastify.register(require('./plugins/coolhand'));

// Register AI routes
fastify.post('/chat', async (request, reply) => {
  const { ChatOpenAI } = require('@langchain/openai');
  const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Automatically monitored!
  const response = await model.invoke(request.body.message);
  return { response: response.content };
});
```

### Method 2: Hook Integration

```javascript
// app.js
const fastify = require('fastify')({ logger: true });
const { initializeGlobalMonitoring } = require('coolhand-node');

// Use onReady hook to initialize monitoring
fastify.addHook('onReady', async function () {
  if (process.env.COOLHAND_API_KEY) {
    initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
      silent: process.env.NODE_ENV === 'production'
    });
  }
});

// Your routes here
```

## 🌐 Koa.js Integration

Koa's async/await architecture works perfectly with global monitoring.

```javascript
// app.js
const Koa = require('koa');
const { initializeGlobalMonitoring } = require('coolhand-node');

// Initialize monitoring first
initializeGlobalMonitoring({
  apiKey: process.env.COOLHAND_API_KEY,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
  silent: process.env.NODE_ENV === 'production'
});

const { ChatOpenAI } = require('@langchain/openai');
const app = new Koa();

app.use(async (ctx, next) => {
  if (ctx.path === '/chat' && ctx.method === 'POST') {
    const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Automatically monitored!
    const response = await model.invoke(ctx.request.body.message);
    ctx.body = { response: response.content };
  } else {
    await next();
  }
});

app.listen(3000);
```

## 🏰 Hapi.js Integration

Hapi's plugin system provides excellent integration options.

```javascript
// plugins/coolhand.js
const { initializeGlobalMonitoring } = require('coolhand-node');

const coolhandPlugin = {
  name: 'coolhand',
  version: '1.0.0',
  register: async function (server, options) {
    if (process.env.COOLHAND_API_KEY) {
      initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
        silent: process.env.NODE_ENV === 'production'
      });
      server.log(['info'], 'Coolhand global monitoring initialized');
    }
  }
};

module.exports = coolhandPlugin;

// server.js
const Hapi = require('@hapi/hapi');

const init = async () => {
  const server = Hapi.server({
    port: 3000,
    host: 'localhost'
  });

  // Register Coolhand plugin
  await server.register(require('./plugins/coolhand'));

  // Add AI routes
  server.route({
    method: 'POST',
    path: '/chat',
    handler: async (request, h) => {
      const { ChatOpenAI } = require('@langchain/openai');
      const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // Automatically monitored!
      const response = await model.invoke(request.payload.message);
      return { response: response.content };
    }
  });

  await server.start();
};

init();
```

## ☁️ Serverless Integration

### AWS Lambda

```javascript
// handler.js
const { initializeGlobalMonitoring } = require('coolhand-node');

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

### Vercel Functions

```javascript
// api/chat.js
import { initializeGlobalMonitoring } from 'coolhand-node';

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
  const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Automatically monitored!
  const response = await model.invoke(req.body.message);

  res.json({ response: response.content });
}
```

### Netlify Functions

```javascript
// netlify/functions/chat.js
const { initializeGlobalMonitoring } = require('coolhand-node');

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
  const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Automatically monitored!
  const response = await model.invoke(JSON.parse(event.body).message);

  return {
    statusCode: 200,
    body: JSON.stringify({ response: response.content })
  };
};
```

## 🔧 Framework-Agnostic Integration

For any Node.js application, regardless of framework:

### Method 1: Environment Variable Auto-Initialization

```bash
# .env
COOLHAND_API_KEY=your_api_key_here
COOLHAND_ENVIRONMENT=production
COOLHAND_SILENT=true
```

```javascript
// At the very top of your main file
require('coolhand-node/auto-monitor');

// Rest of your application
```

### Method 2: Manual Initialization

```javascript
// At the very top of your main file
const { initializeGlobalMonitoring } = require('coolhand-node');

initializeGlobalMonitoring({
  apiKey: process.env.COOLHAND_API_KEY,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
  silent: process.env.NODE_ENV === 'production'
});

// Rest of your application
```

## 🎯 Best Practices

### 1. Initialize Early
```javascript
// ✅ Good - Initialize before importing AI libraries
const { initializeGlobalMonitoring } = require('coolhand-node');
initializeGlobalMonitoring({...});
const { ChatOpenAI } = require('@langchain/openai');

// ❌ Bad - Initialize after importing AI libraries
const { ChatOpenAI } = require('@langchain/openai');
const { initializeGlobalMonitoring } = require('coolhand-node');
initializeGlobalMonitoring({...});
```

### 2. Environment-Based Configuration
```javascript
const config = {
  apiKey: process.env.COOLHAND_API_KEY,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'local',
  silent: process.env.NODE_ENV === 'production'
};
```

### 3. Error Handling
```javascript
try {
  initializeGlobalMonitoring(config);
} catch (error) {
  console.error('Failed to initialize Coolhand monitoring:', error);
  // Continue without monitoring rather than crashing
}
```

### 4. Singleton Pattern for Multiple Initializations
```javascript
let isInitialized = false;

function ensureCoolhandInitialized() {
  if (!isInitialized && process.env.COOLHAND_API_KEY) {
    initializeGlobalMonitoring({...});
    isInitialized = true;
  }
}
```

## 🚨 Framework-Specific Considerations

### Express.js
- **Timing**: Initialize in app.js before route definitions
- **Middleware**: Can use middleware for lazy initialization
- **Best Practice**: Use auto-monitor for simplicity

### NestJS
- **Timing**: Initialize in main.ts bootstrap or OnModuleInit
- **Architecture**: Fits well with global modules
- **Best Practice**: Use global module for DI integration

### Fastify
- **Timing**: Initialize in plugin or onReady hook
- **Performance**: Zero impact on Fastify's speed
- **Best Practice**: Use plugin system for consistency

### Serverless
- **Cold Starts**: Initialize outside handler for reuse
- **Memory**: Minimal overhead perfect for serverless
- **Best Practice**: Use global flag to prevent re-initialization

## ✅ Verification

To verify global monitoring is working in any framework:

```javascript
const { getGlobalStats, isGlobalMonitoringActive } = require('coolhand-node');

// Check if monitoring is active
console.log('Monitoring active:', isGlobalMonitoringActive());

// After making AI calls, check stats
console.log('Stats:', getGlobalStats());
```

## 🎉 Summary

Global monitoring works with **100% of Node.js frameworks** because it operates at the Node.js HTTP module level. The integration pattern is consistent:

1. **Initialize early** (before AI library imports)
2. **Use framework-appropriate initialization point** (middleware, plugins, bootstrap)
3. **Configure based on environment**
4. **Verify with stats/monitoring checks**

No matter what framework you use, your AI API calls will be automatically logged with zero code changes to your business logic! 🚀