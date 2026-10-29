# Reading Step Templates (List + Get)

A step template is a skill or other recurring step Coolhand detects in captured agent sessions. A
`prompt_step` matches a user prompt such as a slash command; a `tool_step` matches tool usage.
`listStepTemplates()` and `getStepTemplate()` are read-only; there are no write endpoints.

**Auth:** both require your **private** API key; the public key returns `401`.
The client is derived from the key; there is no `clientId` parameter.

## `listStepTemplates(params)`

```typescript
import { Coolhand } from 'coolhand-node';

const coolhand = new Coolhand({ apiKey: 'your-private-api-key' });

const { stepTemplates, pagination } = await coolhand.listStepTemplates({
  stepType: 'prompt_step',
  includeMetrics: true,
  page: 1
});
```

| Field | Type | Description |
|---|---|---|
| `search` | `string` | Case-insensitive substring match against the step template name |
| `stepType` | `'prompt_step' \| 'tool_step'` | Only step templates of this type. Anything else is a `422` |
| `includeMetrics` | `boolean` | Add a `metrics` object per row. Off by default, and the server caps `per` at 25 when set (`pagination.per_page` reports the size applied) |
| `page` | `number` | Page number, 1-based |
| `per` | `number` | Page size (default 25, max 100) |

Returns `{ stepTemplates, pagination }`, newest first. The endpoint renders a bare array;
`pagination` is read from the `X-Page`/`X-Per-Page`/`X-Total-Count`/`X-Total-Pages` response
headers, in the same shape `searchLogs` and `searchTemplates` return.

## `getStepTemplate(id, opts)`

```typescript
const stepTemplate = await coolhand.getStepTemplate(14);
const lean = await coolhand.getStepTemplate(14, { includeMetrics: false });
```

`id` is the integer `id` from the list (not a hashid). Unlike the list, `metrics` is included by
default; `includeMetrics: false` skips the metrics queries.

## Fields

Every row has `id`, `name`, `step_type`, `status`, `user_turn_pattern` (nullable), `created_at`,
`updated_at`, `sessions_count` (distinct sessions it appeared in), `occurrences_count` and
`last_seen_at` (nullable). `metrics` is present only when requested (or by default on `getStepTemplate`):

| `metrics` field | Meaning |
|---|---|
| `total_runs` | Runs counted; excludes scrubbed prompt-step sessions |
| `tool_stats` | `{ name, pct_of_runs, avg_per_run }[]`, or `null` when there is nothing to show |
| `turn_stats` | `{ avg, median, high, single_turn_pct }` (`single_turn_pct` nullable), or `null` |
| `efficiency` | `{ interactive, automated, all, unavailable_runs }`, or `null` for tool steps and step templates with no runs. Each cohort is `null` when it has no runs |
| `notes` | Plain-sentence explanations of each data gap that applies |

A cohort is `{ runs, avg_turns_after, avg_tool_calls, avg_requests, token_runs, tokens_available,
median_tokens, p90_tokens, tokens_per_tool_call }`. The last three are `null`, and
`tokens_available` is `false`, when no run in the cohort has token data (expected today).

## Errors

Both methods throw an `HttpError` whose `status` holds the HTTP status: `401` (missing, invalid or
public key), `404` (`getStepTemplate`: unknown id, a draft or failed step template, or another
client's), `422` (`listStepTemplates`: bad `stepType`), and `504` (a query exceeded the statement
timeout; retryable). `getStepTemplate` also throws before any request if `id` is not a positive integer.
