# Coolhand Node.js Monitor

Monitor and log LLM API calls from multiple providers (OpenAI, Anthropic, Google AI, Cohere, Hugging Face, and more) to the Coolhand analytics platform.

## Installation

Install via npm:

```bash
npm install coolhand-node
```

## Quick Start

### Option 1: Universal Global Monitoring (Recommended)

🔥 **RECOMMENDED** - Zero Configuration AI Monitoring

> **Note:** Global monitoring works in Node.js server environments. For React frontend apps, see our [React Integration Guide](./docs/frameworks/react.md).

**Set it and forget it! Monitor ALL AI API calls across your entire application with just one line of code, so you'll never be surprised by new LLM calls added to your production codebase.**

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

**✨ Why Global Monitoring is Recommended:**
- 🚫 **Zero refactoring** - No code changes to existing services
- 📊 **Complete coverage** - Monitors ALL AI libraries automatically
- 🔒 **Security built-in** - Automatic credential sanitization
- ⚡ **Performance optimized** - Negligible overhead
- 🛡️ **Future-proof** - Automatically captures new AI calls added by your team

**Supported Frameworks:** Designed for all Node.js frameworks (Express.js, NestJS, Fastify, Koa, Hapi, AWS Lambda, Vercel Functions), extensively tested with Next.js/T3 Stack

📚 **[Complete Framework Integration Guide](./docs/framework-integration.md)** - Detailed setup instructions for all frameworks

### Option 2: Instance-Based Monitoring (Explicit Control)

For cases where you need explicit control over which AI calls are monitored:

```javascript
const Coolhand = require('coolhand-node');

// Initialize the monitor
const monitor = new Coolhand({
    apiKey: 'your-api-key'
});
```

## Framework Compatibility

📚 **[Framework Integration Guide](./docs/framework-integration.md)** - Complete documentation for all supported frameworks

🎯 **Primary Testing**: This library has been extensively tested and validated with **Next.js/T3 Stack** applications.

🌐 **Universal Design**: Built using Node.js HTTP module patching, this library is designed to work with **any Node.js framework** that makes HTTP requests.

### Quick Links by Framework:
- **[Next.js / T3 Stack](./docs/frameworks/nextjs.md)** - ✅ Production-ready
- **[React Frontend](./docs/frameworks/react.md)** - ✅ Frontend integration patterns
- **[Express.js](./docs/frameworks/express.md)** - 🧪 Needs testing
- **[NestJS](./docs/frameworks/nestjs.md)** - 🧪 Needs testing
- **[Fastify](./docs/frameworks/fastify.md)** - 🧪 Needs testing
- **[Koa.js](./docs/frameworks/koa.md)** - 🧪 Needs testing
- **[Serverless (AWS Lambda, Vercel, Netlify)](./docs/frameworks/serverless.md)** - 🧪 Needs testing

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
import { Coolhand, CoolhandOptions, CoolhandCallData, CoolhandStats } from 'coolhand-node';

const monitor = new Coolhand({
  apiKey: 'your-api-key',
  silent: true
});
```

##

### Basic

```javascript
const Coolhand = require('coolhand-node');

const monitor = new Coolhand({
    apiKey: process.env.COOLHAND_API_KEY
});
```

### Custom AI Service Monitoring
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

## Adding (or Limiting) LLM Providers

You can add support for additional providers (and override the defaults that Coolhand monitors) by creating a custom patterns file:

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

## Miscellany

## Getting Your API Key

Visit [coolhand.io](https://coolhand.io/) to create a free account.

## Error Handling

The monitor handles errors gracefully:

- Failed API logging attempts are logged to console but don't interrupt your application
- Invalid API keys will be reported but won't crash your app
- Network issues are handled with appropriate error messages

## Security

- API keys in request headers are automatically redacted
- No sensitive data is exposed in logs