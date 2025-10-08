# Next.js / T3 Stack Integration

Next.js and the T3 stack (Next.js + TypeScript + tRPC) work excellently with Coolhand's global monitoring. The key consideration is that **Next.js middleware runs in Edge runtime** (limited Node.js APIs), while **API routes run in Node.js runtime** (full HTTP patching capability).

## 🎯 Recommended Approach: next.config.js Initialization

The best approach for Next.js is to initialize global monitoring in `next.config.js`, which runs in Node.js runtime and provides full HTTP/HTTPS monitoring capabilities.

```javascript
// next.config.js
import "./src/env.js"; // Load environment variables

// Initialize global monitoring as middleware - this will monitor ALL HTTP requests
if (process.env.COOLHAND_API_KEY) {
  // Import auto-monitor to enable automatic global monitoring
  import('coolhand-node/auto-monitor');
}

/** @type {import("next").NextConfig} */
const config = {
  // Your Next.js config
};

export default config;
```

**Important**: Add `"type": "module"` to your `package.json` to eliminate ES module warnings:

```json
{
  "name": "your-app",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    // your scripts
  }
}
```

## 📁 Standalone Scripts

For standalone scripts that run outside of Next.js, simply import the auto-monitor at the top:

```typescript
// scripts/ai-script.ts
import dotenv from 'dotenv';
import 'coolhand-node/auto-monitor'; // Automatically initializes global monitoring

dotenv.config();

async function main() {
  // Your AI code here - automatically monitored
  const { ChatOpenAI } = await import('@langchain/openai');
  const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await model.invoke("Hello!");
  console.log(response);
}

main();
```

The auto-monitor will automatically:
- Check for `COOLHAND_API_KEY` environment variable
- Initialize global monitoring if the key is present
- Patch all HTTP/HTTPS/fetch calls to monitor AI API requests

## 🎪 Example: T3 Stack with tRPC

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

## 🏗️ Service-Level Monitoring (Alternative)

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

## 🚨 Edge Runtime Considerations

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

## ✅ What Gets Monitored

With global monitoring enabled in `next.config.js`, all of these are automatically logged:

- **tRPC procedures** using AI APIs (OpenAI, Anthropic, etc.)
- **API routes** (`/api/*`) making AI calls
- **Server-side rendering** AI calls
- **Background jobs** and scripts
- **Any Node.js HTTP/HTTPS requests** to AI services

## 🔧 Environment Setup

```bash
# .env.local
COOLHAND_API_KEY=your_coolhand_key
```

## ✅ Verification

To verify global monitoring is working:

```typescript
// In any API route or server-side code
const { getGlobalStats, isGlobalMonitoringActive } = require('coolhand-node');

console.log('Monitoring active:', isGlobalMonitoringActive());
console.log('Stats:', getGlobalStats());
```