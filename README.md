# Coolhand Node.js Monitor

Monitor and log LLM API calls from multiple providers (OpenAI, Anthropic, Google AI, Cohere, Hugging Face, and more) to the Coolhand analytics platform.

**✨ Now with full TypeScript support and multi-provider pattern matching!**

**✨ Now with full TypeScript support!**

## Installation

Install via npm:

```bash
npm install coolhand-node
```

## Quick Start

### Option 1: Instance-Based Monitoring (Explicit Control)

```javascript
const Coolhand = require('coolhand-node');

// Initialize the monitor
const monitor = new Coolhand({
    apiKey: 'your-api-key'
});
```

### Option 2: Universal Global Monitoring (🔥 NEW - Zero Configuration AI Monitoring)

> **Note:** Global monitoring works in Node.js server environments. For React frontend apps, see [Frontend Integration](#-react-frontend-integration) below.

**Monitor ALL AI API calls across your entire application with just one line of code!**

```javascript
// Add this ONE line at the top of your main application file
require('coolhand-node/auto-monitor');

// That's it! ALL AI API calls are now automatically monitored:
// ✅ OpenAI SDK calls
// ✅ LangChain operations
// ✅ Anthropic API calls
// ✅ Custom AI libraries
// ✅ Direct fetch/axios requests to AI APIs
// ✅ ANY library making AI API calls

// NO code changes needed in your existing services!
```

**Environment Variables:**
```bash
# .env
COOLHAND_API_KEY=your_api_key_here
COOLHAND_ENVIRONMENT=production
COOLHAND_SILENT=true
```

**Or manual initialization:**

```javascript
import { initializeGlobalMonitoring } from 'coolhand-node';

// Initialize once at application startup
initializeGlobalMonitoring({
  apiKey: 'your-api-key'
});

// Now ALL outbound AI API calls are automatically monitored
```

**✨ Global Monitoring Benefits:**
- 🚫 **Zero refactoring** - No code changes to existing services
- 🌐 **Universal compatibility** - Works with ANY Node.js framework
- 📊 **Complete coverage** - Monitors ALL AI libraries automatically
- 🔒 **Security built-in** - Automatic credential sanitization
- ⚡ **Performance optimized** - Negligible overhead

**Supported Frameworks:** Designed for all Node.js frameworks (Express.js, NestJS, Fastify, Koa, Hapi, AWS Lambda, Vercel Functions), extensively tested with Next.js/T3 Stack

## Framework Compatibility

🎯 **Primary Testing**: This library has been extensively tested and validated with **Next.js/T3 Stack** applications.

🌐 **Universal Design**: Built using Node.js HTTP module patching, this library is designed to work with **any Node.js framework** that makes HTTP requests.

🤝 **Community Validation**: We're actively seeking feedback from users of other frameworks:

- **Using Express.js, NestJS, Fastify, or other frameworks?** Please share your experience!
- **Encountered issues?** [Report them here](https://github.com/coolhand-io/coolhand-node/issues) and help us improve
- **Success stories?** [Share your implementation](https://github.com/coolhand-io/coolhand-node/discussions) to help other developers
- **Framework-specific tips?** [Contribute to our documentation](https://github.com/coolhand-io/coolhand-node/pulls)

Your feedback helps us ensure reliable compatibility across the entire Node.js ecosystem.

## Configuration Options

### Instance-Based Monitoring Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | *required* | Your Coolhand API key for authentication |
| `environment` | `'local'` \| `'production'` | `'production'` | Environment for logging (affects API endpoint) |
| `silent` | boolean | `true` | Whether to suppress console output |
| `patternsFile` | string | `undefined` | Path to custom API patterns file |

### Global Monitoring Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | *required* | Your Coolhand API key for authentication |
| `environment` | `'local'` \| `'production'` | `'production'` | Environment for logging (affects API endpoint) |
| `silent` | boolean | `true` | Whether to suppress console output |
| `patternsFile` | string | `undefined` | Path to custom API patterns file |

### Auto-Monitor Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `COOLHAND_API_KEY` | string | *required* | Your Coolhand API key |
| `COOLHAND_ENVIRONMENT` | `'local'` \| `'production'` | `'production'` | Environment for logging |
| `COOLHAND_SILENT` | `'true'` \| `'false'` | `'true'` | Whether to suppress console output |
| `COOLHAND_PATTERNS_FILE` | string | `undefined` | Path to custom API patterns file |

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import { Coolhand, CoolhandOptions, CallData, Stats } from 'coolhand-node';

const monitor = new Coolhand({
  apiKey: 'your-api-key',
  silent: true
});
```

## Usage Examples

### Basic

```javascript
const Coolhand = require('coolhand-node');

const monitor = new Coolhand({
    apiKey: process.env.COOLHAND_API_KEY
});
```

### Next.js/T3 Stack Implementation

For TypeScript frameworks like Next.js or T3 Stack, initialize Coolhand in your service layer:

```typescript
// src/lib/email-service.ts
import { Coolhand } from 'coolhand-node';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';

export class EmailResponseService {
  private coolhand: Coolhand;
  private model: ChatOpenAI;
  private promptTemplate: PromptTemplate;

  constructor(
    openAIApiKey: string,
    coolhandApiKey: string
  ) {
    // Initialize Coolhand FIRST - before any LLM libraries
    this.coolhand = new Coolhand({
      apiKey: coolhandApiKey,
      silent: process.env.NODE_ENV === 'production'
    });

    // Initialize LLM after Coolhand is set up
    this.model = new ChatOpenAI({
      apiKey: openAIApiKey,
      modelName: 'gpt-3.5-turbo',
      temperature: 0.7,
    });

    this.promptTemplate = new PromptTemplate({
      template: `You are a helpful customer service representative...`,
      inputVariables: ["from", "subject", "body"],
    });
  }

  async generateResponse(customerEmail: any): Promise<any> {
    try {
      const formattedPrompt = await this.promptTemplate.format(customerEmail);

      // This call will be automatically logged by Coolhand
      const result = await this.model.invoke(formattedPrompt);

      return {
        original: customerEmail,
        response: result.content,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error('Error generating response:', error);
      throw error;
    }
  }
}
```

**Key points for Next.js/T3:**
- Initialize Coolhand **before** any LLM libraries in your constructor
- Use environment variables for API keys
- Set `silent: process.env.NODE_ENV === 'production'` for automatic dev/prod logging
- All LangChain, OpenAI SDK, or fetch calls will be automatically monitored

### Global Monitoring (Zero Configuration)

For applications where you want to monitor ALL AI API calls without explicit Coolhand instantiation:

```typescript
// At the very top of your main.ts, index.ts, or app.ts
import 'coolhand-node/auto-monitor';

// The rest of your application code...
import { ChatOpenAI } from '@langchain/openai';
import express from 'express';

// All AI API calls are now automatically monitored!
const app = express();
const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/chat', async (req, res) => {
  // This call will be automatically logged to Coolhand
  const response = await model.invoke(req.body.message);
  res.json({ response: response.content });
});
```

**Environment Variables for Auto-Monitor:**

```bash
# .env
COOLHAND_API_KEY=your_coolhand_key_here
COOLHAND_ENVIRONMENT=production
COOLHAND_SILENT=true
```

**Or manual global initialization:**

```typescript
import { initializeGlobalMonitoring } from 'coolhand-node';

// Initialize once at app startup
initializeGlobalMonitoring({
  apiKey: process.env.COOLHAND_API_KEY!,
  environment: 'production',
  silent: process.env.NODE_ENV === 'production'
});

// Now import and use any AI libraries - they'll be monitored automatically
import { ChatOpenAI } from '@langchain/openai';
```

**Benefits of Global Monitoring:**
- ✅ Zero configuration required in your business logic
- ✅ Works with any HTTP client (fetch, axios, http/https modules)
- ✅ Automatically monitors third-party libraries that make AI API calls
- ✅ No need to manage Coolhand instances or singleton patterns
- ✅ Perfect for microservices and serverless functions

## 🌐 Universal Global Monitoring

### What is Global Monitoring?

Global monitoring automatically detects and logs **ALL AI API calls** across your entire Node.js application without requiring any code changes to your existing services. It works by patching Node.js HTTP modules at the runtime level.

### How It Works

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Your Code     │───▶│ Global Monitor   │───▶│  Node.js HTTP   │
│ (Any AI Library)│    │ (Auto-detects &  │    │  (https, http,  │
│                 │    │  Logs AI APIs)   │    │   fetch)        │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Universal Compatibility

| Framework/Platform | Status | Integration | Testing Status |
|-------------------|--------|-------------|----------------|
| **Express.js** | ✅ Designed | One line: `require('coolhand-node/auto-monitor')` | 🧪 Community Testing |
| **Next.js/T3 Stack** | ✅ Tested | Add to `middleware.ts` or main entry | ✅ Fully Tested |
| **NestJS** | ✅ Designed | Initialize in `main.ts` bootstrap | 🧪 Community Testing |
| **Fastify** | ✅ Designed | Plugin or startup hook | 🧪 Community Testing |
| **Koa.js** | ✅ Designed | Middleware or app startup | 🧪 Community Testing |
| **AWS Lambda** | ✅ Designed | Initialize outside handler | 🧪 Community Testing |
| **Vercel Functions** | ✅ Designed | Initialize at function top | 🧪 Community Testing |
| **Serverless** | ✅ Designed | Cold start initialization | 🧪 Community Testing |
| **Any Node.js App** | ✅ Designed | Universal compatibility | 🧪 Community Testing |

**Framework Support Status:**
- ✅ **Fully Tested**: Confirmed working with extensive testing
- ✅ **Designed**: Designed to work universally with all Node.js frameworks
- 🧪 **Community Testing**: Working in theory, seeking community validation

> **Note**: This library is designed to work with all Node.js frameworks through universal HTTP module patching, but has been most extensively tested with **Next.js/T3 Stack**.
>
> **Help us improve!** If you use this library with other frameworks:
> - 🐛 **Found an issue?** [Submit a bug report](https://github.com/coolhand-io/coolhand-node/issues)
> - ✅ **Works great?** [Share your implementation](https://github.com/coolhand-io/coolhand-node/discussions)
> - 📚 **Have integration tips?** [Contribute to our docs](https://github.com/coolhand-io/coolhand-node/pulls)

### Real-World Example

**Before (Manual Setup Required):**
```javascript
// service-a.js
const Coolhand = require('coolhand-node');
const coolhand = new Coolhand({ apiKey: '...' }); // Manual setup
const { ChatOpenAI } = require('@langchain/openai');

// service-b.js
const Coolhand = require('coolhand-node');
const coolhand = new Coolhand({ apiKey: '...' }); // Manual setup
const openai = require('openai');

// service-c.js
const Coolhand = require('coolhand-node');
const coolhand = new Coolhand({ apiKey: '...' }); // Manual setup
const anthropic = require('@anthropic-ai/sdk');
```

**After (Global Monitoring):**
```javascript
// main.js - ONE LINE SETUP
require('coolhand-node/auto-monitor');

// service-a.js - NO CHANGES NEEDED
const { ChatOpenAI } = require('@langchain/openai');
// All LangChain calls automatically logged!

// service-b.js - NO CHANGES NEEDED
const openai = require('openai');
// All OpenAI calls automatically logged!

// service-c.js - NO CHANGES NEEDED
const anthropic = require('@anthropic-ai/sdk');
// All Anthropic calls automatically logged!
```

### Supported AI Libraries

✅ **Automatically Monitored (Zero Setup):**
- **OpenAI SDK** - Official OpenAI library
- **LangChain** - All LLM chains and agents
- **Anthropic SDK** - Claude API calls
- **Google AI SDK** - Gemini/Bard API calls
- **Cohere SDK** - Cohere API calls
- **Hugging Face** - Inference API calls
- **Custom AI APIs** - Configurable patterns
- **Direct HTTP** - fetch, axios, https calls to AI endpoints

### Framework Integration Examples

#### Express.js
```javascript
// app.js
require('coolhand-node/auto-monitor');

const express = require('express');
const { ChatOpenAI } = require('@langchain/openai');

const app = express();
const model = new ChatOpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/chat', async (req, res) => {
  // Automatically monitored!
  const response = await model.invoke(req.body.message);
  res.json({ response: response.content });
});
```

#### Next.js/T3 Stack
```javascript
// middleware.ts
import { initializeGlobalMonitoring } from 'coolhand-node';

export function middleware() {
  initializeGlobalMonitoring({
    apiKey: process.env.COOLHAND_API_KEY!
  });
}

// Any API route - automatically monitored
export async function POST(request: Request) {
  const model = new ChatOpenAI({...});
  const result = await model.invoke(prompt); // Logged automatically!
  return Response.json({ result });
}
```

#### AWS Lambda
```javascript
// handler.js
const { initializeGlobalMonitoring } = require('coolhand-node');

// Initialize once per container
initializeGlobalMonitoring({
  apiKey: process.env.COOLHAND_API_KEY
});

const { ChatOpenAI } = require('@langchain/openai');

exports.handler = async (event) => {
  const model = new ChatOpenAI({...});
  const response = await model.invoke(event.prompt); // Automatically logged!
  return { statusCode: 200, body: JSON.stringify({ response }) };
};
```

### Advanced Features


#### Custom AI Service Monitoring
```json
// custom-patterns.json
{
  "patterns": [
    {
      "name": "Custom AI Service",
      "domains": ["api.customai.com"],
      "paths": ["/v1/generate"],
      "headers": {
        "authorization": "[REDACTED]"
      }
    }
  ]
}
```

```javascript
initializeGlobalMonitoring({
  apiKey: 'your-api-key',
  patternsFile: './custom-patterns.json'
});
```

#### Monitoring Statistics
```javascript
const { getGlobalStats } = require('coolhand-node');

setInterval(() => {
  const stats = getGlobalStats();
  console.log(`AI Calls: ${stats.interceptedCalls}, Total Requests: ${stats.totalRequests}`);
}, 60000);
```

For complete documentation, see: [Global Monitoring Guide](./docs/global-monitoring.md)

## ⚛️ React Frontend Integration

For React applications making AI API calls directly from the browser, use the instance-based approach with proper React patterns:

### React Hook Pattern

```typescript
// hooks/useCoolhand.ts
import { useEffect, useRef } from 'react';
import { Coolhand } from 'coolhand-node';

let coolhandInstance: Coolhand | null = null;

export function useCoolhand() {
  const instanceRef = useRef<Coolhand | null>(null);

  useEffect(() => {
    if (!coolhandInstance && process.env.REACT_APP_COOLHAND_API_KEY) {
      coolhandInstance = new Coolhand({
        apiKey: process.env.REACT_APP_COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      instanceRef.current = coolhandInstance;
    }
  }, []);

  return instanceRef.current;
}
```

### React Component Usage

```typescript
// components/AIChat.tsx
import React, { useState } from 'react';
import { useCoolhand } from '../hooks/useCoolhand';

// Import your AI library
import OpenAI from 'openai';

export function AIChat() {
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const coolhand = useCoolhand(); // Initialize monitoring

  const handleChat = async (message: string) => {
    setLoading(true);

    try {
      // Create OpenAI client
      const openai = new OpenAI({
        apiKey: process.env.REACT_APP_OPENAI_API_KEY,
        dangerouslyAllowBrowser: true // Only for demo - use backend in production
      });

      // This AI call will be automatically logged by Coolhand
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: message }],
      });

      setResponse(completion.choices[0]?.message?.content || '');
    } catch (error) {
      console.error('AI request failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => handleChat('Hello, AI!')}
        disabled={loading}
      >
        {loading ? 'Thinking...' : 'Chat with AI'}
      </button>
      {response && <p>AI Response: {response}</p>}
    </div>
  );
}
```

### App-Level Initialization

```typescript
// App.tsx
import React, { useEffect } from 'react';
import { Coolhand } from 'coolhand-node';
import { AIChat } from './components/AIChat';

// Initialize Coolhand once at app level
let coolhandInitialized = false;

function App() {
  useEffect(() => {
    if (!coolhandInitialized && process.env.REACT_APP_COOLHAND_API_KEY) {
      new Coolhand({
        apiKey: process.env.REACT_APP_COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      coolhandInitialized = true;
      console.log('🔍 Coolhand monitoring initialized for React app');
    }
  }, []);

  return (
    <div className="App">
      <AIChat />
    </div>
  );
}

export default App;
```

### Environment Variables (React)

```bash
# .env.local
REACT_APP_OPENAI_API_KEY=your_openai_key_here
REACT_APP_COOLHAND_API_KEY=your_coolhand_key_here
```

### Context Provider Pattern

```typescript
// contexts/CoolhandContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Coolhand } from 'coolhand-node';

interface CoolhandContextType {
  coolhand: Coolhand | null;
  isInitialized: boolean;
}

const CoolhandContext = createContext<CoolhandContextType>({
  coolhand: null,
  isInitialized: false
});

export function CoolhandProvider({ children }: { children: React.ReactNode }) {
  const [coolhand, setCoolhand] = useState<Coolhand | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (process.env.REACT_APP_COOLHAND_API_KEY) {
      const instance = new Coolhand({
        apiKey: process.env.REACT_APP_COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });

      setCoolhand(instance);
      setIsInitialized(true);
    }
  }, []);

  return (
    <CoolhandContext.Provider value={{ coolhand, isInitialized }}>
      {children}
    </CoolhandContext.Provider>
  );
}

export const useCoolhandContext = () => useContext(CoolhandContext);
```

```typescript
// Usage in components
import { useCoolhandContext } from '../contexts/CoolhandContext';

function MyComponent() {
  const { coolhand, isInitialized } = useCoolhandContext();

  // Use coolhand for AI calls when initialized
  // All AI API calls will be automatically logged
}
```

### Next.js App Router

```typescript
// app/layout.tsx
'use client';
import { useEffect } from 'react';
import { Coolhand } from 'coolhand-node';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_COOLHAND_API_KEY) {
      new Coolhand({
        apiKey: process.env.NEXT_PUBLIC_COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
    }
  }, []);

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

### Important Security Notes

⚠️ **For Production React Apps:**

1. **Never expose API keys in frontend code** - Use a backend proxy instead:

```typescript
// ✅ Secure approach - Backend proxy
const response = await fetch('/api/ai-chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: userInput })
});

// ❌ Insecure - Direct API calls from browser
const openai = new OpenAI({
  apiKey: 'sk-...' // Never do this in production!
});
```

2. **Use environment prefixes correctly:**
   - React: `REACT_APP_*`
   - Next.js: `NEXT_PUBLIC_*`
   - Vite: `VITE_*`

3. **Backend integration recommended:**

```typescript
// pages/api/ai-chat.ts (Next.js API route)
import { Coolhand } from 'coolhand-node';
import OpenAI from 'openai';

const coolhand = new Coolhand({
  apiKey: process.env.COOLHAND_API_KEY // Server-side only
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // Server-side only
});

export default async function handler(req, res) {
  // AI call logged automatically by Coolhand
  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: req.body.message }],
  });

  res.json({ response: completion.choices[0]?.message?.content });
}
```

### Browser Compatibility

✅ **Supported Browsers:**
- Chrome 66+ (fetch support)
- Firefox 57+ (fetch support)
- Safari 10+ (fetch support)
- Edge 79+ (fetch support)

⚠️ **Limitations:**
- Requires `fetch` API support
- CORS policies may affect direct AI API calls
- Some AI providers block browser requests

**Recommended:** Use Coolhand monitoring on your backend API routes instead of direct frontend AI calls for better security and reliability.

### Environment Variables

Add to your `.env.local`:

```bash
OPENAI_API_KEY=your_openai_key_here
COOLHAND_API_KEY=your_coolhand_key_here
```

## Feedback API

Coolhand now supports collecting feedback on LLM responses to improve model performance and quality:

```typescript
import { Coolhand } from 'coolhand-node';

const monitor = new Coolhand({
  apiKey: 'your-api-key',
  environment: 'production'
});

// Create feedback for an LLM response
const feedback = await monitor.createFeedback({
  llm_request_log_id: 123, // ID from a logged LLM request
  like: true, // true for positive, false for negative
  explanation: 'Great response! Very helpful and accurate.',
  revised_output: 'This could be an improved version if needed',
  llm_provider_unique_id: 'openai-gpt-4',
  original_output: 'The original AI response',
  client_unique_id: 'user-session-456'
});

if (feedback) {
  console.log('Feedback created:', feedback.id);
}
```

## What Gets Logged

The monitor captures:

- **Request Data**: Method, URL, headers, request body
- **Response Data**: Status code, headers, response body
- **Metadata**: Timestamp, protocol used
- **LLM-Specific**: Model used, token counts, temperature settings

Headers containing API keys are automatically sanitized for security.

## Supported Providers

The monitor automatically detects and logs API calls from multiple LLM providers:

- **OpenAI** (openai.com, api.openai.com)
- **Anthropic** (api.anthropic.com)
- **Google AI** (generativelanguage.googleapis.com, ai.googleapis.com)
- **Cohere** (api.cohere.ai)
- **Hugging Face** (api-inference.huggingface.co)

### Custom Providers

You can add support for additional providers by creating a custom patterns file:

```javascript
const monitor = new Coolhand({
    apiKey: 'your-api-key',
    patternsFile: './my-patterns.json'
});
```

Example custom patterns file (`my-patterns.json`):

```json
{
  "patterns": [
    {
      "name": "My Custom AI",
      "domains": ["api.mycustomai.com"],
      "paths": ["/v1/generate", "/v1/chat"],
      "headers": {
        "authorization": "[REDACTED]",
        "api-key": "[REDACTED]"
      }
    }
  ]
}
```

## Supported Libraries

The monitor works with any Node.js library that makes HTTP(S) requests to LLM APIs, including:

- OpenAI official SDK
- Anthropic SDK
- Google AI SDK
- LangChain
- Direct `fetch()` calls
- `https`/`http` module usage
- Any other HTTP client

## Advanced Usage

### Modular Architecture

Coolhand uses a modular service-based architecture for easy extensibility:

```typescript
import {
  Coolhand,
  PatternMatchingService,
  LoggingService,
  FeedbackService,
  RequestMonitoringService
} from 'coolhand-node';

// Main class coordinates all services
const monitor = new Coolhand({
  apiKey: 'your-api-key',
  environment: 'production'
});

// Services are also available for advanced use cases
// (though typically you'll just use the main Coolhand class)
```

### Direct Service Access

For advanced integrations, you can access individual services:

```typescript
import { PatternMatchingService, LoggingService } from 'coolhand-node';

// Use pattern matching independently
const patternService = new PatternMatchingService('./custom-patterns.json');
const match = patternService.matchesAPIPattern(requestOptions);

// Use logging service independently
const loggingService = new LoggingService({
  apiKey: 'your-key',
  environment: 'production',
  silent: false
});
```

## API Endpoints

### LLM Request Logging
- **Local**: `http://localhost:3000/api/v2/llm_request_logs`
- **Production**: `https://coolhand.io/api/v2/llm_request_logs`

### LLM Request Feedback
- **Local**: `http://localhost:3000/api/v2/llm_request_log_feedbacks`
- **Production**: `https://coolhand.io/api/v2/llm_request_log_feedbacks`

## Examples

The package includes example files to help you get started:

```bash
# Basic monitoring example
node examples/basic.js

# Feedback API example
node examples/feedback-example.js
```

## Getting Your API Key

Contact Michael to obtain an API key for logging.

## Error Handling

The monitor handles errors gracefully:

- Failed API logging attempts are logged to console but don't interrupt your application
- Invalid API keys will be reported but won't crash your app
- Network issues are handled with appropriate error messages

## Security

- API keys in request headers are automatically redacted
- No sensitive data is exposed in logs