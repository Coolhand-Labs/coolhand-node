# Reading Referenced Files (Search + Sessions)

`searchReferencedFiles()` and `listReferencedFileSessions()` read back which files your logged
requests are associated with — the same data as the "Referenced Files" dashboard page. Both are
read-only; there is no create/update/destroy on this surface.

**Auth:** both require your **private** API key, passed as `apiKey` in the `Coolhand` constructor.
The public key is write-only on this API and is rejected exactly like an invalid key — construct a
separate `Coolhand` instance with the private key if your process also logs with the public key.

**Scoping:** the client is always derived from your API key. There is deliberately no `clientId`
parameter and one cannot be supplied.

**Window:** both endpoints are bounded to the last 90 days (`LlmReference::DEFAULT_WINDOW`
server-side) — a file referenced only outside that window will not appear anywhere on this surface.

**Status:** backed by
[Coolhand-Labs/coolhand#1488](https://github.com/Coolhand-Labs/coolhand/pull/1488), which adds
`GET /api/v2/llm_references` and `GET /api/v2/llm_references/sessions`. It has **not** shipped to
production yet, so both methods currently 404 — as they will on any self-hosted backend that
predates it.

## `searchReferencedFiles(params)`

```typescript
import { Coolhand } from 'coolhand-node';

const coolhand = new Coolhand({ apiKey: 'your-private-api-key' });

const { files, pagination } = await coolhand.searchReferencedFiles({
  filePathContains: 'routes',
  page: 1,
  per: 25
});
```

Returns the client's referenced files **aggregated to one row per distinct `file_path`**, ranked by
`reference_count` descending.

### Parameters

`params: SearchReferencedFilesParams` — all optional, a fixed set of Ransack-backed filters (not
raw `q[...]` predicates like `SearchFeedbackParams` — only these three are exposed):

| Field | Type | Description |
|---|---|---|
| `filePathContains` | `string` | Case-insensitive substring match against `file_path`. Sent as `q[file_path_cont]` |
| `createdAtGteq` | `string` | Lower bound (inclusive) on `created_at`, ISO-8601. Sent as `q[created_at_gteq]` |
| `createdAtLteq` | `string` | Upper bound (inclusive) on `created_at`, ISO-8601. Sent as `q[created_at_lteq]` |
| `page` | `number` | Page number, 1-based |
| `per` | `number` | Page size (default 25, max 100). `per_page` is accepted on the wire as an alias; this SDK only sends `per` |

**`id` is not a supported filter.** The aggregated response has no `id` field at all —
`reference_count`/`last_referenced_at` are computed aggregates (`COUNT(*)`/`MAX(created_at)`), not
stored columns — so `id` was deliberately excluded from the model's `ransackable_attributes`. Any
other unrecognized filter is a `422`, the same as an unrecognized `status` on `searchTemplates`.

### Return value

`Promise<SearchReferencedFilesResponse>` — `{ files, pagination }`:

```typescript
{
  files: [
    { file_path: 'config/routes.rb', reference_count: 12, last_referenced_at: '2026-09-10T12:00:00Z' }
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

`files` is a bare array on the wire (the same shape decision as `searchLogs`/`searchTemplates`, not
`searchFeedback`'s `{ feedback:, pagination: }` envelope). `pagination` is read off the
`X-Page`/`X-Per-Page`/`X-Total-Count`/`X-Total-Pages` response headers, never computed from the
array length — like `searchTemplates`, there is no `includeTotal` opt-out.

## `listReferencedFileSessions(params)`

```typescript
const { sessions } = await coolhand.listReferencedFileSessions({ filePath: 'config/routes.rb' });

const content = await coolhand.getLogContent(sessions[0].llm_request_log_id);
```

The per-file drill-down `searchReferencedFiles` intentionally omits: raw, un-aggregated rows for
**one exact `file_path`**, newest first — so you can see which individual sessions referenced a
file rather than only the aggregate count.

**There is no `GET /api/v2/llm_references/:file_path` show route.** File paths contain slashes and
aren't safe as a URL path segment, so this drill-down is a collection route with a query param
instead — don't design around a `get(filePath)`-shaped call.

### Parameters

`params: ListReferencedFileSessionsParams`:

| Field | Type | Description |
|---|---|---|
| `filePath` | `string` | **Required.** Exact match — no substring/Ransack matching here, this is a lookup for a path you already have (typically `file_path` from a `searchReferencedFiles` row), not a search |
| `page` | `number` | Page number, 1-based |
| `per` | `number` | Page size (default 25, max 100), same bounds as `searchReferencedFiles` |

**An unmatched `filePath` returns `200` with an empty array, not a `404`.**

### Return value

`Promise<ListReferencedFileSessionsResponse>` — `{ sessions, pagination }`:

```typescript
{
  sessions: [
    { llm_request_log_id: 'kp9npvc8qq2q', created_at: '2026-09-10T12:00:00Z' }
  ],
  pagination: { current_page: 1, per_page: 25, total_count: 1, total_pages: 1, has_next_page: false, has_prev_page: false }
}
```

`llm_request_log_id` is a hashid, like every other v2 id — pass it to `getLogContent` (or
`GET /api/v2/llm_request_logs/{id}`) to inspect that session directly.

## Errors

Both methods throw an `HttpError` (exported from `coolhand-node`) on a non-2xx response, with the
HTTP status attached to the `status` property, so callers can branch on it without parsing the
message string:

| Status | When |
|---|---|
| `401` | No API key, an invalid key, or the public key (which cannot read) |
| `404` | The backend doesn't have these routes — see **Status** above. Never a missing `filePath`, which is an empty page |
| `422` | `searchReferencedFiles`: an unrecognized Ransack attribute/predicate, or a non-scalar value where a scalar (e.g. `page`) is expected. `listReferencedFileSessions`: `filePath` missing/blank, or a non-scalar value |
| `504` | `searchReferencedFiles`: the `GROUP BY` aggregate exceeded the backend's statement timeout. `listReferencedFileSessions`: the pagination `COUNT(*)` for that one `file_path` exceeded it — a file_path referenced by very many sessions makes counting as expensive as the aggregate above |

**`504` is expected and retryable on both methods**, the same as `searchTemplates`'s `log_count`
timeout — narrow `searchReferencedFiles` with `filePathContains` or a smaller `per`, and
`listReferencedFileSessions` with a smaller `per`, then retry:

```typescript
import { Coolhand, HttpError } from 'coolhand-node';

try {
  return await coolhand.searchReferencedFiles();
} catch (err) {
  if (err instanceof HttpError && err.status === 504) {
    return await coolhand.searchReferencedFiles({ filePathContains: 'routes', per: 10 });
  }
  throw err;
}
```

Network failures and non-JSON response bodies throw a plain `Error` without a `status` property.

## Verifying against a live server

The unit suite mocks the transport. `test/live/llm-references.live.ts` does not — it runs both
methods against a real Coolhand server. It is excluded from `npm test` because it needs a reachable
server; run it explicitly via `npm run test:live`. Its unauthenticated assertions (missing/invalid
API key) need only a reachable server; the authenticated assertions additionally need a real private
key and are skipped when one isn't configured:

```bash
COOLHAND_LIVE_BASE_URL=http://127.0.0.1:3111 \
COOLHAND_LIVE_API_KEY=<your private key> \
npm run test:live
```

Every request it makes is read-only, so it is safe against a shared development database. See
`docs/template-search.md`'s "Verifying against a live server" section for why a dev-mode Rails
server's flat per-request overhead — not this endpoint's own cost — is what drives the long
`testTimeout` in `jest.live.config.cjs`.
