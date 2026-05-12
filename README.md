# Coolhand Node.js Monitor

Monitor and log LLM API calls from multiple providers (OpenAI, Anthropic, Google AI, and more) to the Coolhand analytics platform.

## Related Packages

| Package | Environment | Purpose |
|---------|-------------|---------|
| `coolhand-node` | Node.js | Server-side monitoring and logging of LLM API calls |
| `coolhand` | Browser | Feedback widget for collecting user sentiment on AI outputs |

This package (`coolhand-node`) is the **server-side SDK** for monitoring LLM calls. For browser-based feedback collection widgets, see [coolhand](https://github.com/Coolhand-Labs/coolhand-js).

## Installation

```bash
npm install coolhand-node
```

## Getting Started

1. **Get API Key**: Visit [coolhandlabs.com](https://coolhandlabs.com/) and get an API key
2. **Install**: `npm install coolhand-node`
3. **Initialize**: Add monitoring to your app's startup (see examples below)
4. **Configure**: Set `COOLHAND_API_KEY` in your environment variables
5. **Deploy**: Your AI calls are now automatically monitored!

## Quick Start

### Option 1: Universal Global Monitoring (Recommended)

🔥 **RECOMMENDED** - Zero Configuration AI Monitoring

> **Note:** Global monitoring works in Node.js server environments. For React frontend apps, see our [React Integration Guide](./docs/frameworks/react.md).

**Set it and forget it! Monitor ALL AI API calls across your entire application with just one line of code, so you'll never be surprised by new LLM calls added to your production codebase.**

> **Important:** `coolhand-node` is an **ES module** package. See [Module System Compatibility](#module-system-compatibility) for setup in CommonJS environments.

**ESM projects** (`"type": "module"` in package.json):

```javascript
// Add this ONE line at the top of your main application file
import 'coolhand-node/auto-monitor';

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
await initializeGlobalMonitoring({
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
import Coolhand from 'coolhand-node';

// Initialize the monitor
const monitor = new Coolhand({
    apiKey: 'your-api-key',
    debug: false  // Enable debug mode if needed
});
```

## Module System Compatibility

`coolhand-node` is published as an **ES module** (`"type": "module"`). How you import it depends on your project's module system.

### ESM Projects

If your `package.json` has `"type": "module"`, or you use `.mjs` files:

```javascript
import { initializeGlobalMonitoring } from 'coolhand-node';
// or
import 'coolhand-node/auto-monitor';
```

### CommonJS Projects

If your project uses CommonJS (no `"type": "module"`, or `.cjs` files), you cannot use `require()` with this package. Use dynamic `import()` inside an async function:

```javascript
async function startServer() {
  // Dynamic import works in CJS
  const { initializeGlobalMonitoring } = await import('coolhand-node');
  await initializeGlobalMonitoring({
    apiKey: process.env.COOLHAND_API_KEY,
    silent: true
  });

  // ... start your server
}

startServer();
```

### TypeScript Compiling to CommonJS

If your `tsconfig.json` has `"module": "commonjs"`, TypeScript converts `await import()` into `require()` at compile time, which will fail. Use the `new Function` workaround to emit a native ESM `import()`:

```typescript
async function startServer() {
  if (process.env.COOLHAND_API_KEY) {
    // new Function emits a native import() that survives CJS compilation
    const _import = new Function('m', 'return import(m)');
    const { initializeGlobalMonitoring } = await _import('coolhand-node');
    await initializeGlobalMonitoring({
      apiKey: process.env.COOLHAND_API_KEY,
      silent: true
    });
  }

  // ... start your server
}
```

> **Tip:** If your tsconfig uses `"module": "ES2020"`, `"ESNext"`, or `"NodeNext"`, TypeScript preserves the native `import()` and you can use `await import('coolhand-node')` directly without the workaround.

See the [framework guides](#framework-integration) for complete examples.

## Feedback API

Collect feedback on LLM responses to improve model performance.

> **Frontend Feedback Widget**: For browser-based feedback collection, see [coolhand-js](https://github.com/Coolhand-Labs/coolhand-js) - an accessible, lightweight JavaScript widget that leverages best UX practices to capture actionable user feedback on any AI output.

```typescript
import { Coolhand } from 'coolhand-node';

const coolhand = new Coolhand({
  apiKey: 'your-api-key'
});

// Create feedback for an LLM response
const feedback = await coolhand.createFeedback({
  llm_request_log_id: 123,
  llm_provider_unique_id: 'req_xxxxxxx',
  client_unique_id: 'workorder-chat-456',
  creator_unique_id: 'user-789'
  original_output: 'Here is the original LLM response!',
  revised_output: 'Here is the human edit of the original LLM response.',
  explanation: 'Tone of the original response read like AI-generated open source README docs',
  sentiment: 'dislike', // preferred over `like`
  // like: true,        // deprecated — use `sentiment` instead
});
```

**Field Guide:** All fields are optional, but here's how to get the best results:

### Matching Fields
- **`llm_request_log_id`** 🎯 *Exact Match* - ID from the Coolhand API response when the original LLM request was logged. Provides exact matching.
- **`llm_provider_unique_id`** 🎯 *Exact Match* - The x-request-id from the LLM API response (e.g., "req_xxxxxxx")
- **`original_output`** 🔍 *Fuzzy Match* - The original LLM response text. Provides fuzzy matching but isn't 100% reliable.
- **`client_unique_id`** 🔗 *Your Internal Matcher* - Connect to an identifier from your system for internal matching

### Quality Data
- **`revised_output`** ⭐ *Best Signal* - End user revision of the LLM response. The highest value data for improving quality scores.
- **`explanation`** 💬 *Medium Signal* - End user explanation of why the response was good or bad. Valuable qualitative data.
- **`sentiment`** 🎭 *Preferred* - String: `'like'`, `'dislike'`, or `'neutral'`. Takes precedence if both `sentiment` and `like` are provided.
- **`like`** 👍 *Low Signal (Deprecated)* - Boolean: `true` = like, `false` = dislike. Use `sentiment` instead. Automatically converted to `sentiment` before sending.

  | `like` (boolean) | `sentiment` (string) |
  |------------------|----------------------|
  | `true`           | `"like"`             |
  | `false`          | `"dislike"`          |
  | omitted          | *(no conversion)*    |

- **`creator_unique_id`** 👤 *User Tracking* - Unique ID to match feedback to the end user who created it
- **`workload_hashid`** 🔗 *Workload Association* - Associate feedback with a specific workload

## Framework Integration

📚 **[Framework Integration Guide](./docs/framework-integration.md)** - Complete documentation for all supported frameworks

**Supported Frameworks:** Works with any Node.js framework (Express.js, NestJS, Fastify, Koa, AWS Lambda, Vercel Functions), extensively tested with Next.js/T3 Stack

### Quick Links by Framework:
- **[Next.js / T3 Stack](./docs/frameworks/nextjs.md)** - ✅ Production-ready
- **[Fastify](./docs/frameworks/fastify.md)** - ✅ Tested with working example app
- **[React Frontend](./docs/frameworks/react.md)** - 🧪 Frontend integration patterns
- **[Express.js](./docs/frameworks/express.md)** - 🧪 Needs testing
- **[NestJS](./docs/frameworks/nestjs.md)** - 🧪 Needs testing
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
| `baseUrl` | string | `'https://coolhandlabs.com'` | Override the API host for self-hosted deployments. Must be `https://` (or `http://localhost` for local dev). |

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `COOLHAND_API_KEY` | string | *required* | Your Coolhand API key |
| `COOLHAND_SILENT` | `'true'` \| `'false'` | `'true'` | Whether to suppress console output |
| `COOLHAND_DEBUG` | `'true'` \| `'false'` | `'false'` | Enable debug mode |
| `COOLHAND_PATTERNS_FILE` | string | `undefined` | Path to custom API patterns file |
| `COOLHAND_BASE_URL` | string | `undefined` | Override the API host (e.g. `https://feedback.example.com`). Same rules as `baseUrl` option. |

### Instance-Based Monitoring Options

Same options as global monitoring, passed to the `Coolhand` constructor. Includes `baseUrl`.

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
import Coolhand from 'coolhand-node';

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

## Monitoring Statistics

Track monitoring statistics in your application:

```javascript
import { getGlobalStats } from 'coolhand-node';

setInterval(() => {
  const stats = getGlobalStats();
  console.log(`AI Calls: ${stats.interceptedCalls}, Total Requests: ${stats.totalRequests}`);
}, 60000);
```

## Debug Mode

Enable debug mode for development and testing:

```javascript
// Via environment variable
// Set COOLHAND_DEBUG=true in .env, then:
import 'coolhand-node/auto-monitor';

// Or via manual initialization
import { initializeGlobalMonitoring } from 'coolhand-node';

await initializeGlobalMonitoring({
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

## API Key

🆓 **Sign up for free** at [coolhandlabs.com](https://coolhandlabs.com/) to get your API key and start monitoring your LLM usage.

**What you get:**
- Complete LLM request and response logging
- Usage analytics and insights
- Feedback collection and quality scoring
- No credit card required to start

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

- **[Framework Integration Guide](./docs/framework-integration.md)** - Complete setup for all frameworks. (Well, some are more complete than others.)
- **[Global Monitoring Guide](./docs/global-monitoring.md)** - Advanced global monitoring features. Even easier than asking your favorite LLM coding tool to do it for you.
- **[React Integration Guide](./docs/frameworks/react.md)** - Frontend integration patterns. We won't ask about how you are planning to keep your API keys secret.

## Related Packages

- **Frontend (Feedback Collection Widget)**: [coolhand-js](https://github.com/Coolhand-Labs/coolhand-js) - Frontend feedback widget for collecting user feedback on AI outputs
- **Ruby**: [coolhand gem](https://github.com/Coolhand-Labs/coolhand-ruby) - Coolhand monitoring for Ruby applications
- **Python**: [coolhand package](https://github.com/Coolhand-Labs/coolhand-python) - Coolhand monitoring for Python applications

## Community

- **Questions?** [Create a discussion](https://github.com/coolhand-io/coolhand-node/discussions)
- **Issues?** [Report bugs](https://github.com/coolhand-io/coolhand-node/issues)
- **Contribute?** [Submit a pull request](https://github.com/coolhand-io/coolhand-node/pulls)
