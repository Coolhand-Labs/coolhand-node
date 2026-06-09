# Manual Submission API

`logRequest()` lets you submit a captured LLM request/response that did not flow through automatic monitoring — for example, a CLI tool replaying locally-saved session turns.

## Usage

```typescript
import { Coolhand } from 'coolhand-node';

const coolhand = new Coolhand({
  apiKey: 'your-api-key'
});

const result = await coolhand.logRequest(rawRequest, {
  collector: 'my-cli/1.0.0' // optional: overrides the default SDK collector string
});

// result is CoolhandLogResponse | null
// null is returned on submission failure, in dry-run mode, or when using
// the HTTPS fallback path (Node.js < 18, where the response body is not parsed)
console.log(result?.id); // Coolhand log ID assigned by the API
```

## Parameters

**`rawRequest: CoolhandCallData`** — the captured request/response payload. Fields:

| Field | Type | Description |
|---|---|---|
| `id` | `number` | Local sequence ID for the call |
| `timestamp` | `string` | ISO 8601 capture time |
| `method` | `string` | HTTP method (`POST`, `GET`, …) |
| `url` | `string` | Full request URL |
| `headers` | `object` | Request headers |
| `request_body` | `object \| null` | Parsed request body |
| `response_body` | `object \| null` | Parsed response body |
| `response_headers` | `object \| null` | Response headers |
| `status_code` | `number` | HTTP status code |
| `protocol` | `string` | Protocol identifier (e.g. `claudecode`) |

**`options.collector?: string`** — overrides the default SDK collector string (e.g. `'coolhand-cli/claude-code'`). When omitted, the SDK derives the collector from the package name and version.

## Return value

`Promise<CoolhandLogResponse | null>` — resolves to the API response on success, or `null` when:
- the submission failed (network error or non-2xx response)
- `dryRun` mode is enabled
- the request was sent via the HTTPS fallback (Node.js < 18, where the response body is not parsed)
