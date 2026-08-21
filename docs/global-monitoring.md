# Universal Global Monitoring

Coolhand's **Global Monitoring** feature automatically logs ALL AI API calls across your entire Node.js application without requiring any code changes to your existing services or libraries. It works by patching core Node.js HTTP modules at the runtime level.

## 🌐 How Universal Monitoring Works

### Core Concept

Global monitoring operates at the **Node.js runtime level** by intercepting HTTP requests before they reach any framework or library code:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Your Code     │───▶│ Global Monitor   │───▶│  Node.js HTTP   │
│ (ChatOpenAI,    │    │ (Intercepts &    │    │  (https, http,  │
│  LangChain,     │    │  Logs AI APIs)   │    │   fetch)        │
│  Custom HTTP)   │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Response Stream Handling (http/https)

For intercepted `http.request()`/`https.request()` calls, the response object your callback receives is **not** the raw `http.IncomingMessage` — it's an independent stream (`PassThrough`) carrying the same metadata (`statusCode`, `statusMessage`, `headers`, `rawHeaders`, `httpVersion`, `httpVersionMajor`, `httpVersionMinor`, `method`, `url`, `socket`, `trailers`, `rawTrailers`, `complete`, `aborted`) and a `setTimeout()` shim that delegates to the real response. This exists because a raw Node `Readable` can only have one true consumer — if the interceptor read the response directly (to capture the body for logging) before your code did, a callback that consumes the response asynchronously (`await` before `res.on('data', ...)`, or a deferred `.pipe()`) would receive nothing. The independent stream sidesteps that entirely: it buffers correctly no matter when your code reads it.

In practice this is transparent for the vast majority of code — `res.on('data'/'end'/'aborted'/'timeout', ...)`, `.pipe()`, and `.destroy()` (which still aborts the real underlying response) all behave as expected. Two differences: `res instanceof http.IncomingMessage` is `false` for this stream, and `res.setTimeout(ms).on('data', ...)`-style chaining returns the tee rather than the real response (intentionally — returning the real response there would silently reintroduce the race this section describes). If any code you monitor relies on the `instanceof` check rather than duck-typing, account for it.

**Not covered**: this only applies when the response is delivered via the callback argument to `http.request()`/`https.request()`. Code that instead does `const req = https.request(options); req.on('response', handler)` still receives the raw `res` directly from Node, bypassing the tee — `handler` remains exposed to the original starvation bug if it consumes the response asynchronously. The callback form is by far the more common pattern and is what this fix targets; if you monitor code using the `req.on('response', ...)` form, be aware it isn't covered yet.

`fetch()` interception is unaffected — it already reads the body via `response.clone()` and returns the original `Response` object untouched.

### What Gets Monitored

✅ **Automatically Detected & Logged:**
- OpenAI API calls (`api.openai.com`)
- Anthropic API calls (`api.anthropic.com`)
- Google AI API calls (`generativelanguage.googleapis.com`)
- GitHub Models API calls (`models.github.ai`, `models.inference.ai.azure.com`)
- Cohere API calls (`api.cohere.ai`)
- Hugging Face API calls (`api-inference.huggingface.co`)
- Custom AI APIs (configurable)

✅ **HTTP Methods Supported:**
- `https.request()` / `https.get()`
- `http.request()` / `http.get()`
- `fetch()` (Node.js 18+)
- Any library using these methods (LangChain, OpenAI SDK, Axios, etc.)

✅ **Framework Compatibility:**
- **Next.js/T3** - ✅ **Production Tested** (via next.config.js)
- **Express.js** - 🧪 Theoretical (startup initialization)
- **NestJS** - 🧪 Theoretical (bootstrap method)
- **Fastify** - 🧪 Theoretical (register hook)
- **Koa.js** - 🧪 Theoretical (startup method)
- **Hapi.js** - 🧪 Theoretical (plugin system)
- **AWS Lambda** - 🧪 Theoretical (handler wrapper)
- **Vercel Functions** - ⚠️ Limited (Edge runtime restrictions)
- **Any Node.js app** - ✅ Universal (Node.js runtime only)

> **📝 Note**: Only Next.js integration has been thoroughly tested. See [Framework Integration Guide](./framework-integration.md) for detailed examples and testing status.

## 🚀 Quick Start

### Option 1: Auto-Monitor (Zero Configuration)

```javascript
// At the very top of your main application file
require('coolhand-node/auto-monitor');

// That's it! All AI API calls are now automatically logged
// No other code changes needed
```

**Environment Variables:**
```bash
COOLHAND_API_KEY=your_api_key_here
COOLHAND_ENVIRONMENT=production  # or 'local'
COOLHAND_SILENT=true            # or 'false'
```

### Option 2: Manual Initialization (Recommended)

```javascript
const { initializeGlobalMonitoring } = require('coolhand-node/auto-monitor');

// Async initialization at application startup
async function initializeMonitoring() {
  try {
    if (process.env.COOLHAND_API_KEY) {
      console.log('🌐 Initializing Coolhand global monitoring...');
      await initializeGlobalMonitoring({
        apiKey: process.env.COOLHAND_API_KEY,
        silent: process.env.NODE_ENV === 'production'
      });
      console.log('✅ Global monitoring enabled for all AI API calls!');
    }
  } catch (error) {
    console.error('❌ Failed to initialize global monitoring:', error);
  }
}

// Initialize before starting your application
initializeMonitoring();
```

## 🔧 Configuration Options

### `initializeGlobalMonitoring(config)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | *required* | Your Coolhand API key |
| `silent` | boolean | `true` | Suppress console output |
| `patternsFile` | string | `undefined` | Path to custom API patterns file |

### Environment Variables (Auto-Monitor)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `COOLHAND_API_KEY` | string | *required* | Your Coolhand API key |
| `COOLHAND_ENVIRONMENT` | `'local'` \| `'production'` | `'production'` | Target environment |
| `COOLHAND_SILENT` | `'true'` \| `'false'` | `'true'` | Suppress console output |
| `COOLHAND_PATTERNS_FILE` | string | `undefined` | Custom patterns file path |

## 🚨 Runtime Environment Considerations

### Node.js Runtime vs Edge Runtime

Global monitoring has **different capabilities** depending on the runtime environment:

| Runtime | HTTP/HTTPS Patching | Fetch Patching | File System Access | Recommended Use |
|---------|-------------------|----------------|-------------------|-----------------|
| **Node.js** | ✅ Full Support | ✅ Full Support | ✅ Available | **Recommended** |
| **Edge** | ❌ Limited | ✅ Available | ❌ Restricted | Limited monitoring |

### 🎯 Next.js Specific Considerations

- **Next.js middleware** runs in **Edge runtime** (limited HTTP patching)
- **API routes** run in **Node.js runtime** (full HTTP patching)
- **Solution**: Initialize in `next.config.js` (Node.js runtime) for full monitoring

```javascript
// ✅ Recommended: next.config.js (Node.js runtime)
(async () => {
  const { initializeGlobalMonitoring } = await import('coolhand-node/auto-monitor');
  await initializeGlobalMonitoring({
    apiKey: process.env.COOLHAND_API_KEY,
    silent: process.env.NODE_ENV === 'production'
  });
})();

// ❌ Limited: middleware.ts (Edge runtime - fetch only)
export async function middleware(request) {
  // Can only monitor fetch() calls, not HTTP/HTTPS modules
}
```

### Edge Runtime Fallback

When running in Edge runtime, the package automatically:
- ✅ **Detects Edge environment**
- ✅ **Loads fallback patterns** (OpenAI, Anthropic, Google AI)
- ✅ **Monitors fetch() calls only**
- ⚠️ **Cannot patch HTTP/HTTPS modules**

## 🎯 Core Features

### 1. **Zero Configuration Required**

```javascript
// Before: Manual Coolhand setup in every service
class EmailService {
  constructor() {
    this.coolhand = new Coolhand({ apiKey: '...' }); // Manual setup
    this.openai = new OpenAI({ apiKey: '...' });
  }

  async generate(prompt) {
    const result = await this.openai.chat.completions.create(...);
    // Manual logging required
    return result;
  }
}

// After: No Coolhand code needed anywhere!
class EmailService {
  constructor() {
    this.openai = new OpenAI({ apiKey: '...' }); // Just your AI service
  }

  async generate(prompt) {
    const result = await this.openai.chat.completions.create(...);
    // Automatically logged by global monitoring!
    return result;
  }
}
```

### 2. **Universal Library Support**

Works with ANY Node.js library that makes HTTP requests:

```javascript
// All of these are automatically monitored:

// OpenAI Official SDK
const openai = new OpenAI({ apiKey: '...' });
await openai.chat.completions.create(...); // ✅ Logged

// LangChain
const model = new ChatOpenAI({ apiKey: '...' });
await model.invoke('Hello'); // ✅ Logged

// Anthropic SDK
const anthropic = new Anthropic({ apiKey: '...' });
await anthropic.messages.create(...); // ✅ Logged

// Direct fetch calls
await fetch('https://api.openai.com/v1/chat/completions', {...}); // ✅ Logged

// Axios requests
await axios.post('https://api.openai.com/v1/chat/completions', {...}); // ✅ Logged

// Custom HTTP clients
const https = require('https');
https.request('https://api.openai.com/v1/chat/completions', {...}); // ✅ Logged
```

### 3. **Comprehensive Coverage**

Monitors all AI API calls regardless of how they're made:

```javascript
// All of these are automatically monitored:

// Direct AI SDK calls
const openai = new OpenAI({ apiKey: '...' });
await openai.chat.completions.create(...); // ✅ Logged

// Framework wrappers
const model = new ChatOpenAI({ apiKey: '...' });
await model.invoke('Hello'); // ✅ Logged

// Custom HTTP requests
await fetch('https://api.openai.com/v1/chat/completions', {...}); // ✅ Logged

// Third-party libraries making AI calls internally
await someLibrary.processWithAI(data); // ✅ Logged if it uses AI APIs
```

### 4. **Rich Metadata Capture**

Every AI API call is logged with complete context:

```json
{
  "id": 123,
  "timestamp": "2025-01-15T10:30:45.123Z",
  "method": "POST",
  "url": "https://api.openai.com/v1/chat/completions",
  "protocol": "fetch",
  "status_code": 200,
  "headers": {
    "authorization": "[REDACTED]",
    "content-type": "application/json"
  },
  "request_body": {
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "Hello"}],
    "temperature": 0.7,
    "max_tokens": 150
  },
  "response_body": {
    "choices": [{"message": {"content": "Hello! How can I help you?"}}],
    "usage": {"prompt_tokens": 10, "completion_tokens": 8}
  }
}
```

### 5. **Performance Optimized**

- **Zero overhead** for non-AI requests
- **Minimal overhead** for AI requests (microseconds)
- **Asynchronous logging** - doesn't block your application
- **Memory efficient** - lightweight tracking with automatic cleanup

## 📊 Monitoring & Statistics

### Real-time Statistics

```javascript
const { getGlobalStats, isGlobalMonitoringActive } = require('coolhand-node');

// Check if monitoring is active
console.log('Active:', isGlobalMonitoringActive()); // true/false

// Get real-time statistics
const stats = getGlobalStats();
console.log('Stats:', {
  totalRequests: stats.totalRequests,      // All HTTP requests seen
  interceptedCalls: stats.interceptedCalls, // AI API calls logged
  apiEndpoint: stats.apiEndpoint,          // Logging destination
  isInitialized: stats.isInitialized       // Monitoring status
});
```

### Console Output (when `silent: false`)

```
🌐 Global Coolhand monitoring initialized
🎯 API Endpoint: https://coolhandlabs.com/api/v2/llm_request_logs
📋 Loaded 5 AI API patterns
🔍 Now monitoring ALL outbound HTTP requests for AI API calls...

🌐 FETCH to: https://api.openai.com/v1/chat/completions
🎯 INTERCEPTING OpenAI FETCH call
📞 Starting FETCH call #1 to https://api.openai.com/v1/chat/completions

🎉 LOGGING OpenAI API Call #1
🕐 Time: 2025-01-15T10:30:45.123Z
🎯 POST https://api.openai.com/v1/chat/completions
📊 Status: 200
🔧 Protocol: fetch
🔍 Matched by: domain (openai.com)
🤖 Model: gpt-3.5-turbo
💬 Messages: 1
🌡️  Temperature: 0.7
📤 Sending to: https://coolhandlabs.com/api/v2/llm_request_logs
```

## 🎨 Advanced Usage

### Custom API Patterns

Monitor additional AI APIs by providing a custom patterns file:

```json
// custom-patterns.json
{
  "patterns": [
    {
      "name": "Custom AI Service",
      "domains": ["api.customai.com"],
      "paths": ["/v1/generate", "/v1/chat"],
      "headers": {
        "authorization": "[REDACTED]",
        "x-api-key": "[REDACTED]"
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

### Conditional Initialization

```javascript
// Only enable monitoring in specific environments
if (process.env.NODE_ENV !== 'test') {
  initializeGlobalMonitoring({
    apiKey: process.env.COOLHAND_API_KEY
  });
}
```

### Multiple Service Support

Perfect for microservices architectures:

```javascript
// service-a/index.js
require('coolhand-node/auto-monitor');
// All AI calls in Service A are monitored

// service-b/index.js
require('coolhand-node/auto-monitor');
// All AI calls in Service B are monitored

// service-c/index.js
require('coolhand-node/auto-monitor');
// All AI calls in Service C are monitored
```

## 🔒 Security Features

### Automatic Header Sanitization

Sensitive headers are automatically redacted:

```javascript
// Original request headers
{
  "authorization": "Bearer sk-1234567890abcdef",
  "x-api-key": "secret-key-123",
  "content-type": "application/json"
}

// Logged headers (sanitized)
{
  "authorization": "[REDACTED]",
  "x-api-key": "[REDACTED]",
  "content-type": "application/json"
}
```

### Configurable Sanitization

```json
// In patterns file
{
  "name": "Custom Service",
  "domains": ["api.example.com"],
  "headers": {
    "authorization": "[REDACTED]",
    "secret-header": "[REDACTED]",
    "custom-key": "[REDACTED]"
  }
}
```

## 🚨 Troubleshooting

### Common Issues

**1. "Global monitoring not working"**
```javascript
// Check initialization status
const { isGlobalMonitoringActive } = require('coolhand-node');
console.log('Active:', isGlobalMonitoringActive());

// Verify API key is set
console.log('API Key:', process.env.COOLHAND_API_KEY ? 'Set' : 'Missing');
```

**2. "AI calls not being logged"**
```javascript
// Check if requests match patterns
const { getGlobalStats } = require('coolhand-node');
const stats = getGlobalStats();
console.log('Total requests:', stats.totalRequests);
console.log('Intercepted calls:', stats.interceptedCalls);
```

**3. "Initialize before AI libraries"**
```javascript
// ✅ Correct order
const { initializeGlobalMonitoring } = require('coolhand-node');
initializeGlobalMonitoring({...});
const { ChatOpenAI } = require('@langchain/openai'); // After initialization

// ❌ Wrong order
const { ChatOpenAI } = require('@langchain/openai'); // Before initialization
const { initializeGlobalMonitoring } = require('coolhand-node');
initializeGlobalMonitoring({...});
```

**4. "LangChain / OpenAI calls not intercepted with ESM static imports"**

`@langchain/openai` (and the `openai` SDK) cache a reference to `https.request` at module evaluation time. Whether this is an issue depends on your module system:

**CJS projects** (TypeScript compiling to CommonJS): `import 'coolhand-node/auto-monitor'` patches `https.request` synchronously — calls are intercepted with no extra steps.

**Native ESM projects** (`"type": "module"`): static imports are hoisted and evaluated before any module body runs, so a sibling `import 'coolhand-node/auto-monitor'` cannot patch `https.request` in time.

```javascript
// ❌ Broken in native ESM
import 'coolhand-node/auto-monitor';
import { ChatOpenAI } from '@langchain/openai'; // captures original https.request first
```

**Recommended fix — `--import` flag (Node ≥ 20.6, no code changes):**

`--import` runs `auto-monitor` outside the application module graph, before any library is loaded:

```bash
node --import 'coolhand-node/auto-monitor' app.mjs
# or
NODE_OPTIONS="--import 'coolhand-node/auto-monitor'" node app.mjs
```

```json
{ "scripts": { "start": "node --import 'coolhand-node/auto-monitor' dist/app.mjs" } }
```

**Fallback — dynamic import (Node < 20.6):**

```javascript
import { initializeGlobalMonitoring } from 'coolhand-node';

await initializeGlobalMonitoring({ apiKey: process.env.COOLHAND_API_KEY });

const { ChatOpenAI } = await import('@langchain/openai'); // loads after patch
const model = new ChatOpenAI({ model: 'gpt-4o' });
await model.invoke('hello'); // ✅ intercepted
```

This only affects libraries that cache `https.request` at import time in native ESM projects. All other interception (including `fetch`) works in both module systems.

### Debug Mode

```javascript
initializeGlobalMonitoring({
  apiKey: 'your-api-key',
  silent: false // Enable verbose logging
});
```

## 🎯 Use Cases

### 1. **Legacy Application Monitoring**
Add AI monitoring to existing applications without refactoring:

```javascript
// Just add one line to your existing app
require('coolhand-node/auto-monitor');

// Your existing code works unchanged
const openai = new OpenAI({...});
await openai.chat.completions.create({...}); // Now monitored!
```

### 2. **Microservices Architecture**
Monitor AI usage across multiple services:

```javascript
// Each service: 1 line of code
require('coolhand-node/auto-monitor');

// Central dashboard shows AI usage from all services
```

### 3. **Third-Party Library Monitoring**
Monitor AI calls from libraries you don't control:

```javascript
// Some third-party library that uses AI internally
const smartLibrary = require('some-ai-library');

// Their AI calls are automatically monitored
await smartLibrary.processDocument(document);
```

### 4. **Development & Debugging**
Track AI usage during development:

```javascript
// See exactly what AI calls your app makes
initializeGlobalMonitoring({
  apiKey: 'dev-key',
  environment: 'local',
  silent: false // See all AI calls in console
});
```

## 📈 Benefits Summary

✅ **Zero Refactoring** - No code changes to existing services
✅ **Universal Compatibility** - Works with any Node.js framework
✅ **Complete Coverage** - Monitors ALL AI API calls automatically
✅ **Performance Optimized** - Negligible overhead
✅ **Security Built-in** - Automatic credential sanitization
✅ **Rich Metadata** - Complete request/response context
✅ **Easy Integration** - One line of code setup
✅ **Debugging Friendly** - Detailed logging and statistics

## 🚀 Getting Started

1. **Install the package:**
   ```bash
   npm install coolhand-node
   ```

2. **Get your API key:**
   Contact the Coolhand team for your API key

3. **Add one line to your app:**
   ```javascript
   require('coolhand-node/auto-monitor');
   ```

4. **Set environment variable:**
   ```bash
   COOLHAND_API_KEY=your_api_key_here
   ```

5. **That's it!** All your AI API calls are now automatically logged

## 🧪 Testing & Contributing

### Current Testing Status

- ✅ **Next.js/T3**: Thoroughly tested and production-ready
- 🧪 **Other frameworks**: Theoretical implementations need community validation

### Help Us Improve!

If you're using global monitoring with any framework:

1. **Test the integration** with your framework
2. **Verify AI API calls are being logged**
3. **[Create an issue](https://github.com/anthropics/coolhand-node/issues)** with your results:
   - ✅ Working: Share your setup for others
   - ❌ Issues: Help us fix and improve
   - 💡 Suggestions: Propose better approaches

4. **Contribute examples** to our [Framework Integration Guide](./framework-integration.md)

### What to Test

- [ ] Global monitoring initialization
- [ ] AI API calls being captured and logged
- [ ] Error handling and edge cases
- [ ] Performance impact (should be negligible)
- [ ] Runtime environment compatibility

Your testing and feedback helps make global monitoring reliable for everyone! 🚀

---

Universal Global Monitoring makes AI observability effortless across any Node.js application! 🎉