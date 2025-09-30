# Coolhand Node.js Monitor

Monitor and log LLM API calls (OpenAI, Anthropic, etc.) to the Coolhand analytics platform.

## Installation

Install directly from GitHub:

```bash
npm install git+https://github.com/mikecarroll/coolhand-node.git
```

## Quick Start

```javascript
const Coolhand = require('coolhand-node');

// Initialize the monitor
const monitor = new Coolhand({
    environment: 'production'
    apiKey: 'your-api-key',
    silent: true
});
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `environment` | string | `'local'` | Target environment: `'local'` (localhost:3000) or `'production'` (coolhand.io) |
| `apiKey` | string | *required* | Your Coolhand API key for authentication |
| `silent` | boolean | `false` | Set to `true` to suppress console output |

## Usage Examples

### Local Development

```javascript
const Coolhand = require('coolhand-node');

const monitor = new Coolhand({
    environment: 'local',
    apiKey: 'your-api-key-here',
    silent: false  // Verbose logging for development
});

// Your existing OpenAI code
const openai = new OpenAI({ apiKey: 'your-openai-key' });
const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: "Hello!" }]
});
// This call will automatically be logged to Coolhand!
```

### Production

```javascript
const Coolhand = require('coolhand-node');

const monitor = new Coolhand({
    environment: 'production',
    apiKey: process.env.COOLHAND_API_KEY,
    silent: true  // Quiet mode for production
});
```

### With LangChain

```javascript
const Coolhand = require('coolhand-node');
const { ChatOpenAI } = require("@langchain/openai");

// Initialize monitor first
const monitor = new Coolhand({
    environment: 'local',
    apiKey: 'your-coolhand-api-key',
    silent: false
});

// Use LangChain as normal
const llm = new ChatOpenAI({
    modelName: "gpt-3.5-turbo",
    openAIApiKey: "your-openai-key"
});

const response = await llm.invoke("Hello, world!");
// Coolhand will automagically analyze the results
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