# Reading Templates (Search + Get)

`searchTemplates()` and `getTemplate()` read back the LLM request templates your logs are matched
against. Both are read-only — creating, updating and deprecating templates stays on the MCP
surface, and there is no version-history sub-resource on this REST API.

**Auth:** both require your **private** API key, passed as `apiKey` in the `Coolhand` constructor.
The public key is write-only on this API and is rejected exactly like an invalid key — construct a
separate `Coolhand` instance with the private key if your process also logs with the public key.

**IDs:** `getTemplate(id)` expects a **hashid** — the `id` string a `searchTemplates` result gives
you, never a raw integer. `workloadId` is also a hashid; one that doesn't decode, or that belongs
to another client, is a `422`, not an empty list.

**Scoping:** the client is always derived from your API key. There is deliberately no `clientId`
parameter and one cannot be supplied.

**Status:** backed by
[Coolhand-Labs/coolhand#1376](https://github.com/Coolhand-Labs/coolhand/pull/1376), which adds
`GET /api/v2/llm_request_templates` and `GET /api/v2/llm_request_templates/{id}`. Confirm your
target Coolhand backend has deployed it before relying on these methods — against a backend that
hasn't, both will 404.

## `searchTemplates(params)`

```typescript
import { Coolhand } from 'coolhand-node';

const coolhand = new Coolhand({ apiKey: 'your-private-api-key' });

const { templates, pagination } = await coolhand.searchTemplates({
  search: 'summar',
  status: 'published',
  page: 1,
  per: 25
});
```

Search is a **parameter on the list endpoint**, not a route of its own, so there is one method
rather than a separate list/search pair.

> This is not a port of the `search_templates` MCP tool, and it does not match it. `log_count` here
> counts only directly-collected client logs (evals, bakeoff comparisons and synthetic logs are
> excluded), so it is often lower than the MCP tool's number. Templates on **archived** workloads
> are returned rather than hidden — otherwise the list would disagree with `getTemplate`, which can
> always fetch such a template by id. Narrow with `workloadId` if you want them out.

### Parameters

`params: SearchTemplatesParams` — all optional, all dedicated named filters (like
`SearchLogsParams`, not raw Ransack predicates like `SearchFeedbackParams`):

| Field | Type | Description |
|---|---|---|
| `search` | `string` | Case-insensitive **literal** substring match against the template name. `%` and `_` are escaped server-side, so they match themselves — don't escape them again |
| `workloadId` | `string` | Filter to a single workload, by workload hashid. One that doesn't decode, or belongs to another client, returns `422` rather than an empty list |
| `status` | `'draft' \| 'published' \| 'failure'` | Filter by status. Any other non-empty value returns `422` |
| `includeDeprecated` | `boolean` | Include templates with a non-null `deprecated_at`. Defaults to `false` server-side |
| `includeSystem` | `boolean` | Include the `Unmatched` / `Ignored API Calls` system buckets. Defaults to `false` server-side |
| `page` | `number` | Page number, 1-based |
| `per` | `number` | Page size (default 25, max 100). `per_page` is accepted on the wire as an alias; this SDK only sends `per` |

**System templates.** Every client is created with two system buckets, `Unmatched` and
`Ignored API Calls`. They are hidden unless `includeSystem: true`, so a client with no templates of
its own returns an **empty array**, not those two rows — that is the filter working, not an empty
database. Each row carries a `system_template` boolean so you don't have to match on names. The
`Unmatched` bucket is what you inspect when logs are misrouting.

### Return value

`Promise<SearchTemplatesResponse>` — `{ templates, pagination }`:

```typescript
{
  templates: [
    {
      id: 'kp9npvc8qq2q',            // hashid, never the integer PK
      name: 'Summarize document',
      status: 'published',           // draft | published | failure, or null
      version: null,
      group: 'user_prompt',          // chat | user_prompt | user_prompt_with_system_prompt | embedding | other
      workload_id: '47myqes2q692',   // hashid
      workload_name: 'Summarization',
      system_template: false,
      deprecated_at: null,           // ISO-8601 UTC; non-null means superseded
      log_count: 412,
      created_at: '2026-08-20T02:12:27Z',
      updated_at: '2026-08-20T02:12:27Z'
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

Results are ordered **newest first** (`created_at DESC`, with the primary key as a tiebreaker, so
paging is deterministic when two templates share a timestamp).

`templates` is a bare array on the wire (the same shape decision as `searchLogs`, not
`searchFeedback`'s `{ feedback:, pagination: }` envelope). `pagination` is read off the
`X-Page`/`X-Per-Page`/`X-Total-Count`/`X-Total-Pages` response headers, never computed from the
array length. Unlike `searchLogs`, this endpoint has **no `includeTotal` opt-out** — the headers
are always present, because counting a client's templates is cheap.

**Prompt patterns are not here.** `user_prompt_pattern`/`system_prompt_pattern` come from
`getTemplate` only.

`log_count` counts the same records `searchLogs({ templateId })` returns, so the two numbers agree.

## `getTemplate(id)`

```typescript
const template = await coolhand.getTemplate('kp9npvc8qq2q');

console.log(template.user_prompt_pattern);
console.log(template.system_prompt_pattern);
```

### Return value

`Promise<LlmRequestTemplateDetail>` — every field from a `searchTemplates` row, plus:

| Field | Type | Description |
|---|---|---|
| `user_prompt_pattern` | `string \| null` | The full, untruncated regex |
| `system_prompt_pattern` | `string \| null` | The full, untruncated regex |

Unlike the list, this applies **no filtering beyond client ownership**: a deprecated template or a
system template is reachable by id with no opt-in flag, because inspecting one of those is the
usual reason to fetch a template directly.

## Errors

Both methods throw an `HttpError` (exported from `coolhand-node`) on a non-2xx response, with the
HTTP status attached to the `status` property, so callers can branch on it without parsing the
message string:

| Status | When |
|---|---|
| `401` | No API key, an invalid key, or the public key (which cannot read) |
| `404` | Unknown template id — **or** one belonging to another client. Never `403`: a foreign template's existence is not disclosed |
| `422` | An unrecognized `status`, or a `workloadId` that doesn't decode / belongs to another client |
| `504` | The `log_count` aggregate exceeded the backend's 10-second statement timeout |

**`504` is expected on both methods, and it is retryable.** `log_count` aggregates over
`llm_request_logs`, so its cost scales with how many logs the matched templates hold — the
`Unmatched` bucket can hold every log that never matched a template. Treat it as "narrow the query
and try again" rather than as a server fault:

```typescript
import { Coolhand, HttpError } from 'coolhand-node';

try {
  return await coolhand.searchTemplates({ includeSystem: true });
} catch (err) {
  if (err instanceof HttpError && err.status === 504) {
    // Bounded by a statement timeout, not broken — narrow it down and retry.
    return await coolhand.searchTemplates({ includeSystem: true, workloadId, per: 10 });
  }
  throw err;
}
```

Network failures, non-JSON response bodies, and a blank/whitespace-only or dot-segment (`.`/`..`)
`id` (rejected client-side before the request is made) throw a plain `Error` without a `status`
property.

## Verifying against a live server

The unit suite mocks the transport. `test/live/templates.live.ts` does not — it runs both methods
against a real Coolhand server and asserts the real responses. It is excluded from `npm test`
because it needs a reachable server and a real private key, and is run explicitly instead:

```bash
COOLHAND_LIVE_BASE_URL=http://127.0.0.1:3111 \
COOLHAND_LIVE_API_KEY=<your private key> \
npm run test:live
```

Every request it makes is read-only, so it is safe against a shared development database. Give it a
generous timeout budget: a Rails server running in development mode adds a large flat overhead to
**every** request, measured at 13-15s here even for `GET /up`, which does no auth and touches no
database. That cost shows up inside the server's own `X-Runtime` header, so it is the server, not
the network. The template query itself only adds ~2-3s on top. This is why `jest.live.config.cjs`
sets a much longer `testTimeout` than the unit suite needs.

Do not read that latency as an impending `504`. The two are unrelated: `504` comes from a
*per-statement* 10-second bound on the `log_count` aggregate, and a slow response is not evidence
you are approaching it. Set client timeouts from the measured round trip (60s+ against a dev
server), not from the 10s figure.
