# Reading Logs (Search + Get Content)

`searchLogs()` and `getLogContent()` read back logs previously submitted via `logRequest()` or
automatic monitoring.

**Auth:** both require your **private** API key, passed as `apiKey` in the `Coolhand`
constructor. The public key used for `logRequest`/`createFeedback` will 401 on these endpoints —
construct a separate `Coolhand` instance with the private key if your process also logs with the
public key.

**IDs:** `getLogContent(logId)` and `searchLogs`' `templateId` filter expect **hashids** — the
`id`/`template_id` strings you get back from a `searchLogs` result. Today, this is not the same
`id` `logRequest()`'s response resolves to, which is a plain numeric database ID; don't pass that
value here. (Once `#1096` below ships, `logRequest()`'s response `id` becomes a hashid too — the
same field, on the same blueprint, that `searchLogs`/`getLogContent` already return as one — so
this distinction goes away then; `CoolhandLogResponse.id` is typed `number | string` to cover both.)
`workloadId` is also a hashid, but one that doesn't come back from a log result — get it from the
app UI. (Not from a feedback record's `workload_id` — despite that field's name and its own doc
comment, `LLMRequestLogFeedbackResponse`/`Summary.workload_id` are the raw integer database ID, not
a hashid; passing that value here 422s.)

**Deployment status:** this entire read surface is implemented against
[Coolhand-Labs/coolhand#1096](https://github.com/Coolhand-Labs/coolhand/pull/1096), which is not
yet merged. Against today's deployed backend:
- `getLogContent` 404s outright — no `show` route exists yet.
- `searchLogs`' named filters below (everything except `sort`, `page`, and `per`, which already
  work today) are silently ignored — the backend returns unfiltered results, not an error.
- Each result is missing every field except `id`/`collector`/`source_api`/`created_at`/
  `updated_at` (`model`, `source_api_result`, `template_id`, `template_name`, the token/latency
  fields, and `include_prompts`' fields are all additive in `#1096`), and `id` is the raw integer
  primary key, not a hashid.
- Pagination (below) falls back to a lower-bound estimate on a non-empty page, and to `0` on an
  empty one — never a real total, until `#1096` ships.
- `#1096` also scopes `index` to client-generated logs only (excludes internally-generated
  records, e.g. evals); if you're relying on the current, broader result set, expect it to shrink.

## `searchLogs(params)`

```typescript
import { Coolhand } from 'coolhand-node';

const coolhand = new Coolhand({ apiKey: 'your-private-api-key' });

const { logs, pagination } = await coolhand.searchLogs({
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
| `sourceApiResult` | `string` | Filter by result status: `success`, `failed`, `operational`, `unsupported_api`, or `ingest_error`. Applied as a plain equality filter — a log with a `null` result (also generally "successful") won't match `sourceApiResult: 'success'`. Not related to `unmatchedOnly`, which filters on template assignment, not result status |
| `unmatchedOnly` | `boolean` | Only return logs with no assigned template |
| `daysBack` | `number` | Limit to logs created in the last N days. Unrestricted when omitted — there's no implicit default. A non-positive value (e.g. `0`) is rejected with a 422, not treated as "unrestricted" |
| `includePrompts` | `boolean` | Include `system_prompt`/`user_prompt` (truncated to 500 chars) on each result |
| `sort` | `string` | Ransack sort expression, e.g. `"created_at desc"` — sent as `q[s]`. Defaults to newest-first (`id desc`) when omitted |
| `page` | `number` | Page number. Must be a positive integer — the backend's pagination gem raises on `0`, negative, or non-integer values, rejected with a generic 500, not a 422 |
| `per` | `number` | Page size (default 25, max 100 — enforced server-side) |

`sort` is the only raw Ransack passthrough this method exposes — other `q[...]` predicates the
endpoint's underlying search may accept aren't reachable through `searchLogs`.

### Return value

`Promise<SearchLogsResponse>` — `{ logs, pagination }`:

```typescript
{
  logs: [
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
  ],
  pagination: {
    current_page: 1,
    per_page: 25,
    total_count: 1,
    total_pages: 1,
    has_next_page: false,
    has_prev_page: false
  }
}
```

The backing endpoint renders `logs` as a bare array on the wire; `searchLogs` reads `pagination`
off `X-Total-Count`/`X-Page`/`X-Per-Page`/`X-Total-Pages` response headers
([Coolhand-Labs/coolhand#1096](https://github.com/Coolhand-Labs/coolhand/pull/1096) — not yet
deployed as of this writing) and assembles the same field names/shape/semantics `searchFeedback`
embeds in its body — both endpoints paginate via `will_paginate` server-side
(`ActiveRecord::Relation#page`/`#previous_page`/`#next_page`), so once `#1096` ships,
`has_prev_page`/`has_next_page` mean exactly the same thing on both methods. Until that backend PR ships, those
headers are absent and `pagination` is derived from `logs`/the requested `page`/`per` instead:

- If `logs` is non-empty, `total_count`/`total_pages` are a **lower-bound estimate** — every prior
  page assumed full, plus this page's actual count (e.g. a single result on `page: 3, per: 10`
  reports `total_count: 21`, not `1`). This bound holds regardless of how large `page` is, since
  offset-based pagination can only return rows if that many precede them.
- If `logs` is empty, `total_count`/`total_pages` are both `0` — an empty page proves the opposite
  (that `page` is at or past the end, or nothing matched), so extrapolating from `page` here would
  fabricate a total, not estimate a real lower bound.
- `has_next_page` is `logs.length >= per` (a full page might not be the last one — costs one extra,
  empty request in the worst case, never drops real results) and `has_prev_page` is simply
  `page > 1`, both independent of the `total_count`/`total_pages` estimate above. Unlike
  `total_count`/`total_pages`, `has_prev_page`'s meaning does **not** change once `#1096` ships —
  `page > 1` is exactly what `will_paginate`'s `previous_page.present?` reduces to, with no
  out-of-range check on either side.

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
| `section` | `'full' \| 'beginning' \| 'end'` | Which part of each content field to return (default: `full`). Only takes effect together with `maxChars` — without it, the server returns the entire field regardless of `section` |
| `maxChars` | `number` | Max characters per content field — slices from the start, or the requested `section`. A non-positive value is rejected with a 422 |
| `searchQuery` | `string` | Returns up to 5 matching snippets per field with surrounding context instead of raw content. Mutually exclusive with `section`/`maxChars` — `GetLogContentOptions` is a discriminated union, so TypeScript rejects passing both. Must be non-blank — `getLogContent` throws client-side on `''`/whitespace-only rather than silently falling through to the content shape (which is what the backend does with a blank query) |
| `includeThinking` | `boolean` | Include `thinking_response` (an array of thinking blocks, not a single string) in the result (default: false) |

A `searchQuery` you don't know is present at compile time (e.g. typed `string | undefined`) can
still be passed straight through — a third, catch-all overload accepts the full
`GetLogContentOptions` union — but the call then resolves to the general `LlmRequestLogContent`
union rather than one of the two more specific overloads, so narrow the result with
`'matches' in result` before reading fields off it:

```typescript
const result = await coolhand.getLogContent('abc123', { searchQuery });

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
  truncated: true, total_chars: { system_prompt: 12000, user_prompt: 400, output: 900 },
  thinking_response: ['...']  // only present when includeThinking was set; an array, not a string
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
re-authenticate, 404 → unknown ID) without parsing the message string. `searchLogs`/`getLogContent`
also 422 on invalid input once `#1096` ships: an unknown `templateId`/`workloadId`, a non-positive
`daysBack`/`maxChars`, or an invalid `section`.

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

Network failures, non-JSON response bodies, and a blank/whitespace-only or dot-segment (`.`/`..`)
`logId`, or a blank/whitespace-only `searchQuery` (all rejected client-side before the request is
made) throw a plain `Error` without a `status` property.
