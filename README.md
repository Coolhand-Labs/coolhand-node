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

```javascript
const Coolhand = require('coolhand-node');

// Initialize the monitor
const monitor = new Coolhand({
    apiKey: 'your-api-key'
});
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | *required* | Your Coolhand API key for authentication |
| `environment` | `'local'` \| `'production'` | `'production'` | Environment for logging (affects API endpoint) |
| `silent` | boolean | `true` | Whether to suppress console output |
| `patternsFile` | string | `undefined` | Path to custom API patterns file |

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import { Coolhand, CoolhandOptions, CallData, Stats } from 'coolhand-node';

const monitor = new Coolhand({
  apiKey: 'your-api-key',
  environment: 'production', // Autocomplete available
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
    coolhandApiKey: string,
    environment: 'local' | 'production' = 'production'
  ) {
    // Initialize Coolhand FIRST - before any LLM libraries
    this.coolhand = new Coolhand({
      environment,
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

## Best Practices

### Preventing Duplicate Logs in T3/Next.js Applications

In T3 Stack and Next.js applications, you may encounter duplicate logging due to multiple Coolhand instances being created. This can happen because of:

- Hot reloading in development mode
- Server-side rendering + client hydration
- Multiple service instantiations in API routes
- React Strict Mode double-invocation
- Module re-evaluation in Next.js

To prevent duplicate logging, use a **singleton pattern** to ensure only one Coolhand instance exists:

```typescript
// src/lib/coolhand-singleton.ts
import { Coolhand } from 'coolhand-node';

let coolhandInstance: Coolhand | null = null;

export function getCoolhandInstance(apiKey: string, environment: 'local' | 'production' = 'production'): Coolhand {
  if (!coolhandInstance) {
    coolhandInstance = new Coolhand({
      apiKey,
      environment,
      silent: process.env.NODE_ENV === 'production'
    });
  }
  return coolhandInstance;
}
```

Then use the singleton in your services:

```typescript
// src/lib/email-service.ts
import { getCoolhandInstance } from './coolhand-singleton';
import { ChatOpenAI } from '@langchain/openai';

export class EmailResponseService {
  private coolhand: Coolhand;
  private model: ChatOpenAI;

  constructor(openAIApiKey: string, coolhandApiKey: string, environment: 'local' | 'production' = 'production') {
    // Use singleton to prevent multiple instances
    this.coolhand = getCoolhandInstance(coolhandApiKey, environment);

    this.model = new ChatOpenAI({
      apiKey: openAIApiKey,
      modelName: 'gpt-3.5-turbo',
      temperature: 0.7,
    });
  }
  // ... rest of implementation
}
```

**Alternative approaches:**
- Initialize Coolhand once at the module level (outside classes)
- Use dependency injection with a single Coolhand instance
- Create Coolhand in a Next.js middleware or API route wrapper

**Note**: Coolhand includes built-in deduplication that prevents duplicate logs from identical requests made within a 1-second window, but using a singleton pattern is still the recommended approach for optimal performance.

## Security

- API keys in request headers are automatically redacted
- No sensitive data is exposed in logs