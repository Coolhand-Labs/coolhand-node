# Coolhand Node.js Monitor

Monitor and log LLM API calls from multiple providers (OpenAI, Anthropic, Google AI, Cohere, Hugging Face, and more) to the Coolhand analytics platform.

## Installation

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
COOLHAND_DEBUG=false  # Set to true for debug mode
```

**Or manual initialization:**

```javascript
import { initializeGlobalMonitoring } from 'coolhand-node';

// Initialize once at application startup
initializeGlobalMonitoring({
  apiKey: 'your-api-key',
  debug: false
});

// Now ALL outbound AI API calls are automatically monitored
```

**✨ Why Global Monitoring is Recommended:**
- 🚫 **Zero refactoring** - No code changes to existing services
- 📊 **Complete coverage** - Monitors ALL AI libraries automatically
- 🔒 **Security built-in** - Automatic credential sanitization
- ⚡ **Performance optimized** - Negligible overhead
- 🛡️ **Future-proof** - Automatically captures new AI calls added by your team

### Option 2: Instance-Based Monitoring (Explicit Control)

For cases where you need explicit control over which AI calls are monitored:

```javascript
const Coolhand = require('coolhand-node');

// Initialize the monitor
const monitor = new Coolhand({
    apiKey: 'your-api-key',
    debug: false  // Enable debug mode if needed
});
```

## Framework Integration

📚 **[Framework Integration Guide](./docs/framework-integration.md)** - Complete documentation for all supported frameworks

**Supported Frameworks:** Works with any Node.js framework (Express.js, NestJS, Fastify, Koa, AWS Lambda, Vercel Functions), extensively tested with Next.js/T3 Stack

### Quick Links by Framework:
- **[Next.js / T3 Stack](./docs/frameworks/nextjs.md)** - ✅ Production-ready
- **[React Frontend](./docs/frameworks/react.md)** - 🧪 Frontend integration patterns
- **[Express.js](./docs/frameworks/express.md)** - 🧪 Needs testing
- **[NestJS](./docs/frameworks/nestjs.md)** - 🧪 Needs testing
- **[Fastify](./docs/frameworks/fastify.md)** - 🧪 Needs testing
- **[Koa.js](./docs/frameworks/koa.md)** - 🧪 Needs testing
- **[Serverless (AWS Lambda, Vercel, Netlify)](./docs/frameworks/serverless.md)** - 🧪 Needs testing

## Configuration Options

### Global Monitoring Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | *required* | Your Coolhand API key for authentication |
| `silent` | boolean | `true` | Whether to suppress console output |
| `debug` | boolean | `false` | Enable debug mode (API calls will be mocked) |
| `patternsFile` | string | `undefined` | Path to custom API patterns file |

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `COOLHAND_API_KEY` | string | *required* | Your Coolhand API key |
| `COOLHAND_SILENT` | `'true'` \| `'false'` | `'true'` | Whether to suppress console output |
| `COOLHAND_DEBUG` | `'true'` \| `'false'` | `'false'` | Enable debug mode |
| `COOLHAND_PATTERNS_FILE` | string | `undefined` | Path to custom API patterns file |

### Instance-Based Monitoring Options

Same options as global monitoring, passed to the `Coolhand` constructor.

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import { Coolhand, CoolhandOptions, CoolhandCallData, CoolhandStats } from 'coolhand-node';

const monitor = new Coolhand({
  apiKey: 'your-api-key',
  silent: true,
  debug: false
});
```

## What Gets Logged

The monitor captures:

- **Request Data**: Method, URL, headers, request body
- **Response Data**: Status code, headers, response body
- **Metadata**: Timestamp, protocol used
- **LLM-Specific**: Model used, token counts, temperature settings

Headers containing API keys are automatically sanitized for security.

## Supported Libraries

The monitor works with any Node.js library that makes HTTP(S) requests to LLM APIs, including:

- OpenAI official SDK
- Anthropic SDK
- Google AI SDK
- LangChain
- Direct `fetch()` calls
- `https`/`http` module usage
- Any other HTTP client

## Custom AI Providers

Add support for custom AI providers by creating a patterns file:

```javascript
const monitor = new Coolhand({
    apiKey: 'your-api-key',
    patternsFile: './my-patterns.json'
});
```

Example patterns file (`my-patterns.json`):

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

## Feedback API

Collect feedback on LLM responses to improve model performance:

```typescript
import { Coolhand } from 'coolhand-node';

const monitor = new Coolhand({
  apiKey: 'your-api-key'
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

## Monitoring Statistics

Track monitoring statistics in your application:

```javascript
const { getGlobalStats } = require('coolhand-node');

setInterval(() => {
  const stats = getGlobalStats();
  console.log(`AI Calls: ${stats.interceptedCalls}, Total Requests: ${stats.totalRequests}`);
}, 60000);
```

## Debug Mode

Enable debug mode for development and testing:

```javascript
// Global monitoring with debug mode
require('coolhand-node/auto-monitor'); // Set COOLHAND_DEBUG=true in .env

// Or instance-based with debug mode
const monitor = new Coolhand({
  apiKey: 'your-api-key',
  debug: true
});
```

When debug mode is enabled:
- API calls to Coolhand will be mocked
- Debug messages will show what would have been sent
- No data will be sent to Coolhand servers

## Advanced Usage

### Modular Architecture

Access individual services for advanced use cases:

```typescript
import { PatternMatchingService, LoggingService } from 'coolhand-node';

// Use pattern matching independently
const patternService = new PatternMatchingService('./custom-patterns.json');
const match = patternService.matchesAPIPattern(requestOptions);

// Use logging service independently
const loggingService = new LoggingService({
  apiKey: 'your-key',
  silent: false,
  debug: false
});
```

## Getting Started

1. **Get API Key**: Visit [coolhand.io](https://coolhand.io/) to create a free account
2. **Install**: `npm install coolhand-node`
3. **Initialize**: Add `require('coolhand-node/auto-monitor')` to your main file
4. **Configure**: Set `COOLHAND_API_KEY` in your environment variables
5. **Deploy**: Your AI calls are now automatically monitored!

## Error Handling

The monitor handles errors gracefully:

- Failed API logging attempts are logged to console but don't interrupt your application
- Invalid API keys will be reported but won't crash your app
- Network issues are handled with appropriate error messages

## Security

- API keys in request headers are automatically redacted
- No sensitive data is exposed in logs
- Debug mode prevents data from being sent to external servers

## Documentation

- **[Framework Integration Guide](./docs/framework-integration.md)** - Complete setup for all frameworks
- **[Global Monitoring Guide](./docs/global-monitoring.md)** - Advanced global monitoring features
- **[React Integration Guide](./docs/frameworks/react.md)** - Frontend integration patterns

## Community

- **Questions?** [Create a discussion](https://github.com/coolhand-io/coolhand-node/discussions)
- **Issues?** [Report bugs](https://github.com/coolhand-io/coolhand-node/issues)
- **Contribute?** [Submit a pull request](https://github.com/coolhand-io/coolhand-node/pulls)