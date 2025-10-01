# Coolhand Node.js Monitor

Monitor and log LLM API calls (OpenAI, Anthropic, etc.) to the Coolhand analytics platform.

## Installation

Install via npm:

```bash
npm install coolhand-node.git
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
| `silent` | boolean | `true` | Set to `false` to enable console output |

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
- LangChain
- Direct `fetch()` calls
- `https`/`http` module usage
- Any other HTTP client

## API Endpoints

- **Local**: `http://localhost:3000/api/v2/llm_request_logs`
- **Production**: `https://coolhand.io/api/v2/llm_request_logs`

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