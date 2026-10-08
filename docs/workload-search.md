# Reading Workloads (Search)

`searchWorkloads()` lists your workloads — the groups of prompt templates that make up one task or
agent — optionally with a cost and performance `metrics` rollup per workload. It is read-only, and
there is no per-workload endpoint.

**Auth:** requires your **private** API key, passed as `apiKey` in the `Coolhand` constructor. The
public key is write-only on this API and is rejected exactly like an invalid key.

**IDs:** a workload's `id` is its **hashid**, a string, never an integer. It is what the `workloadId`
filter on `searchTemplates` and `searchLogs` expects, and the stable key to use for your own records.

**Scoping:** the client is always derived from your API key. There is deliberately no `clientId`
parameter.

## `searchWorkloads(params)`

```typescript
import { Coolhand } from 'coolhand-node';

const coolhand = new Coolhand({ apiKey: 'your-private-api-key' });

const { workloads, pagination } = await coolhand.searchWorkloads({
  includeMetrics: true,
  since: new Date('2026-09-01T00:00:00Z'),
  until: new Date('2026-10-01T00:00:00Z'),
  per: 50
});
```

### Parameters

`params: SearchWorkloadsParams` — all optional:

| Field | Type | Description |
|---|---|---|
| `search` | `string` | Case-insensitive substring match against the workload name |
| `includeArchived` | `boolean` | Include archived workloads. Defaults to `false` server-side |
| `includeSystem` | `boolean` | Include system workloads such as `Unmatched` and `Embedding Requests`. Defaults to `false` server-side |
| `includeTemplates` | `boolean` | Add each workload's active templates and their routing patterns as `templates` |
| `includeMetrics` | `boolean` | Add a `metrics` rollup per workload across all of its templates |
| `daysBack` | `number` | Rolling metrics window in days ending now (server default 28, max 365). Ignored when `since` is given |
| `since` | `Date \| string` | Metrics window start (inclusive). Overrides `daysBack` |
| `until` | `Date \| string` | Metrics window end (exclusive); defaults to now |
| `page` | `number` | Page number, 1-based |
| `per` | `number` | Page size (default 25, max 100). `per_page` is accepted on the wire as an alias; this SDK only sends `per` |

`metrics` is the same object `searchTemplates` returns per template: same window rules, same
counters, same SQL as the dashboard. See [Metrics in template-search.md](./template-search.md#metrics).

### Return value

`Promise<SearchWorkloadsResponse>` — `{ workloads, pagination }`, ordered by name:

```typescript
{
  workloads: [
    {
      id: 'j35494sql6yd',            // hashid
      name: 'Agent Engineering',
      description: null,
      archived: false,
      system: false,
      merged: false,
      template_count: 2,             // active templates
      draft_template_count: 1,
      log_count: 160,                // every log on any of its templates, all generators
      last_activity: '2026-08-25T20:03:47Z',
      // metrics: { ... }            only with includeMetrics
      // templates: [ ... ]          only with includeTemplates
    }
  ],
  pagination: { current_page: 1, per_page: 25, total_count: 1, total_pages: 1, has_next_page: false, has_prev_page: false }
}
```

`workloads` is a bare array on the wire; `pagination` is read off the
`X-Page`/`X-Per-Page`/`X-Total-Count`/`X-Total-Pages` response headers, which the endpoint always
sends, never computed from the array length.

`log_count` counts every log attached to any of the workload's templates, so it can exceed the sum
of the templates' own `log_count`, which counts only directly-collected client logs.

## Errors

Throws an `HttpError` (exported from `coolhand-node`) on a non-2xx response, with the HTTP status on
`status` and the server's body in the message (`{ "errors": { "<field>": ["msg"] } }` on a `422`):

| Status | When |
|---|---|
| `401` | No API key, an invalid key, or the public key (which cannot read) |
| `422` | A malformed `since`/`until`, a `since` not before `until`, a window over 365 days, or a bad `daysBack` (errors on the `since`/`until` key). Only checked when `includeMetrics` is set |
| `504` | An aggregate exceeded the backend's statement timeout. Retryable: narrow with `search` or a smaller `per` |

An invalid `Date` for `since`/`until`, network failures and non-JSON bodies throw a plain `Error`
without a `status`.
