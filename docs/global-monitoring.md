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

### What Gets Monitored

✅ **Automatically Detected & Logged:**
- OpenAI API calls (`api.openai.com`)
- Anthropic API calls (`api.anthropic.com`)
- Google AI API calls (`generativelanguage.googleapis.com`)
- Cohere API calls (`api.cohere.ai`)
- Hugging Face API calls (`api-inference.huggingface.co`)
- Custom AI APIs (configurable)

✅ **HTTP Methods Supported:**
- `https.request()` / `https.get()`
- `http.request()` / `http.get()`
- `fetch()` (Node.js 18+)
- Any library using these methods (LangChain, OpenAI SDK, Axios, etc.)

✅ **Frameworks Supported:**
- **Express.js** - ✅ Full compatibility
- **Next.js/T3** - ✅ Full compatibility
- **NestJS** - ✅ Full compatibility
- **Fastify** - ✅ Full compatibility
- **Koa.js** - ✅ Full compatibility
- **Hapi.js** - ✅ Full compatibility
- **AWS Lambda** - ✅ Full compatibility
- **Vercel Functions** - ✅ Full compatibility
- **Any Node.js app** - ✅ Universal compatibility

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

### Option 2: Manual Initialization

```javascript
const { initializeGlobalMonitoring } = require('coolhand-node');

// Initialize once at application startup
initializeGlobalMonitoring({
  apiKey: 'your-api-key'
});

// Now all AI API calls are automatically monitored
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
🎯 API Endpoint: https://coolhand.io/api/v2/llm_request_logs
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
📤 Sending to: https://coolhand.io/api/v2/llm_request_logs
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

Universal Global Monitoring makes AI observability effortless across any Node.js application! 🎉