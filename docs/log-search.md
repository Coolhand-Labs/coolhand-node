# Reading Logs (Search + Get Content)

`searchLogs()` and `getLogContent()` read back logs previously submitted via `logRequest()` or
automatic monitoring.

**Auth:** both require your **private** API key, passed as `apiKey` in the `Coolhand`
constructor. The public key used for `logRequest`/`createFeedback` will 401 on these endpoints —
construct a separate `Coolhand` instance with the private key if your process also logs with the
public key.

**IDs:** `getLogContent(logId)` and `searchLogs`' `templateId` filter expect **hashids** — the
`id`/`template_id` strings you get back from a `searchLogs` result. This is not the same `id`
`logRequest()`'s response resolves to, which is a plain numeric database ID; don't pass that value
here. `workloadId` is also a hashid, but one that doesn't come back from a log result — get it from
the app UI or a feedback record's `workload_id`.

## `searchLogs(params)`

```typescript
import { Coolhand } from 'coolhand-node';

const coolhand = new Coolhand({ apiKey: 'your-private-api-key' });

const logs = await coolhand.searchLogs({
  model: 'gpt-4',
  sourceApiResult: 'failed',
  daysBack: 7,
  page: 1,
  per: 25
});
```

### Parameters

`params: SearchLogsParams` is mostly a bag of dedicated named filters — not raw Ransack
predicates like `FeedbackService#searchFeedback` — since several of these need joins, hashid
decoding, or a substring match that don't fit a Ransack allowlist. They're applied **on top of**
the endpoint's own Ransack-backed search, not in place of it; `sort` below reaches that directly:

| Field | Type | Description |
|---|---|---|
| `templateId` | `string` | Filter by template hashid |
| `workloadId` | `string` | Filter by workload hashid (matches all templates in that workload) |
| `systemPromptContains` | `string` | Case-insensitive substring match against the system prompt |
| `userPromptContains` | `string` | Case-insensitive substring match against the user prompt |
| `model` | `string` | Filter by model name (e.g. `"gpt-4o"`, `"claude-3-5-sonnet"`) |
| `sourceApi` | `string` | Filter by source API (e.g. `"openai"`, `"anthropic"`, `"vertex"`) |
| `sourceApiResult` | `string` | Filter by result status: `success`, `failed`, `operational`, `unmatched` |
| `unmatchedOnly` | `boolean` | Only return logs with no assigned template |
| `daysBack` | `number` | Limit to logs created in the last N days. Unrestricted when omitted — there's no implicit default |
| `includePrompts` | `boolean` | Include `system_prompt`/`user_prompt` (truncated to 500 chars) on each result |
| `sort` | `string` | Ransack sort expression, e.g. `"created_at desc"` — sent as `q[s]`. Defaults to newest-first (`id desc`) when omitted |
| `page` | `number` | Page number |
| `per` | `number` | Page size (default 25, max 100 — enforced server-side) |

`sort` is the only raw Ransack passthrough this method exposes — other `q[...]` predicates the
endpoint's underlying search may accept aren't reachable through `searchLogs`.

### Return value

`Promise<SearchLogsResponse>` — a bare array of `LlmRequestLogSummary`, **no pagination
metadata** in the response:

```typescript
[
  {
    id: 'abc123',              // hashid
    collector: 'coolhand-node-0.10.0-manual',
    source_api: 'openai',
    source_api_result: 'success',
    model: 'gpt-4',
    template_id: null,         // hashid, or null when unmatched
    template_name: null,
    input_tokens: 100,
    output_tokens: 50,
    latency_ms: 250,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
    // system_prompt/user_prompt only present when includePrompts was set
  }
]
```

## `getLogContent(logId, opts)`

```typescript
const content = await coolhand.getLogContent('abc123'); // the hashid from a search result's `id`
console.log(content.system_prompt, content.user_prompt, content.output);

// Large logs: fetch just the end of each field, or search within them instead
await coolhand.getLogContent('abc123', { section: 'end', maxChars: 2000 });
await coolhand.getLogContent('abc123', { searchQuery: 'timeout' }); // mutually exclusive with section/maxChars
```

### Options

| Field | Type | Description |
|---|---|---|
| `section` | `'full' \| 'beginning' \| 'end'` | Which part of each content field to return (default: `full`) |
| `maxChars` | `number` | Max characters per content field — slices from the start, or the requested `section` |
| `searchQuery` | `string` | Returns up to 5 matching snippets per field with surrounding context instead of raw content. Mutually exclusive with `section`/`maxChars` — `GetLogContentOptions` is a discriminated union, so TypeScript rejects passing both |
| `includeThinking` | `boolean` | Include `thinking_response` in the result (default: false) |

Since `GetLogContentOptions` is a discriminated union, a `searchQuery` you don't know is present at
compile time (e.g. typed `string | undefined`) won't satisfy either branch. Branch on it explicitly
instead of passing it straight through. The call then resolves to the general `LlmRequestLogContent`
union, so narrow the result with `'matches' in result` before reading fields off it:

```typescript
const opts = searchQuery ? { searchQuery } : {};
const result = await coolhand.getLogContent('abc123', opts);

if ('matches' in result) {
  console.log(result.matches, result.search_query);
} else {
  console.log(result.system_prompt, result.user_prompt, result.output);
}
```

### Return value

`Promise<LlmRequestLogContent>`. When `searchQuery` wasn't passed, the result includes the
content fields directly (sliced if `section`/`maxChars` were given, with `truncated`/
`total_chars` set on a partial fetch):

```typescript
{
  id: 'abc123', url: '/c/.../llm_request_logs/abc123', model: 'gpt-4', source_api: 'openai',
  template_id: null, template_name: null, input_tokens: 100, output_tokens: 50, latency_ms: 250,
  created_at: '2026-01-01T00:00:00Z',
  system_prompt: '...', user_prompt: '...', output: '...',
  truncated: true, total_chars: { system_prompt: 12000, user_prompt: 400, output: 900 }
}
```

When `searchQuery` was passed, `matches`/`search_query` replace the content fields:

```typescript
{
  id: 'abc123', /* ...same base fields... */
  search_query: 'timeout',
  matches: { system_prompt: [], user_prompt: ['...timeout...'], output: [] }
}
```

## Errors

Both methods throw an `HttpError` (exported from `coolhand-node`) on a non-2xx response, with the
HTTP status attached to the `status` property, so callers can branch on it (e.g. 401 →
re-authenticate, 404 → unknown ID) without parsing the message string:

```typescript
import { Coolhand, HttpError } from 'coolhand-node';

try {
  await coolhand.getLogContent('does-not-exist');
} catch (err) {
  if (err instanceof HttpError && err.status === 404) {
    // handle not found
  }
  throw err;
}
```

Network failures and non-JSON response bodies throw a plain `Error` without a `status` property.
