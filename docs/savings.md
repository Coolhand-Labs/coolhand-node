# Reading Realized Savings

`getRealizedSavings()` returns the saving your client has realized by switching templates or
models: what the requests served by the current templates cost, versus what the same requests
would have cost on the deprecated versions they replaced. It is the figure the dashboard shows.
It is read-only.

**Auth:** requires your **private** API key, passed as `apiKey` in the `Coolhand` constructor. The
public key is rejected exactly like an invalid key.

**Scoping:** the client is always derived from your API key. There is deliberately no `clientId`
parameter, and no parameter of any kind.

**Window:** the comparison covers deprecations from the last three months, fixed server-side. It is
not tied to a request window, so there is no `daysBack`. The result is cached server-side for an
hour.

## `getRealizedSavings()`

```typescript
import { Coolhand } from 'coolhand-node';

const coolhand = new Coolhand({ apiKey: 'your-private-api-key' });

const savings = await coolhand.getRealizedSavings();
savings.total;   // 4.5372 (USD)
savings.percent; // 79.7
```

### Return value

`Promise<RealizedSavings>`:

```typescript
{
  total: 4.5372,                      // the saving, USD
  cost_at_previous_versions: 5.6912,  // the baseline the saving is measured against, USD
  percent: 79.7,                      // total as a share of the baseline, one decimal; 0 when the baseline is 0
  workloads: [
    {
      id: 'xwjm0lgsdmy4',             // workload hashid, same as searchWorkloads
      name: 'Help Center Article Suggester',
      savings: 2.0437,
      cost_at_previous_versions: 3.0402,
      active_requests: 182
    }
  ]
}
```

Money values are USD numbers rounded to 4 decimals. `workloads` lists only workloads with a
template deprecated in the last three months, and every row always carries all five keys. A client
with nothing to compare gets `{ total: 0, cost_at_previous_versions: 0, percent: 0, workloads: [] }`,
which is real zero savings.

## Errors

Throws an `HttpError` (exported from `coolhand-node`) on a non-2xx response, with the HTTP status on
`status`:

| Status | When |
|---|---|
| `401` | No API key, an invalid key, or the public key |
| `503` | The comparison could not be computed right now. Retryable |

**A `503` is not zero savings.** Do not map it to zeros; show it as an error and retry. Network
failures and non-JSON bodies throw a plain `Error` without a `status`.

## Combining it with workload metrics

`savings` is **not windowed**, but a workload's `metrics` from `searchWorkloads({ includeMetrics: true, daysBack })`
are. A workload's `savings` can therefore exceed its windowed `metrics.total_cost`; do not read the two
as a ratio over the same period. Join the two on `id` to build a per-workload ROI view:

```typescript
const [{ workloads }, savings] = await Promise.all([
  coolhand.searchWorkloads({ includeMetrics: true, daysBack: 30, per: 100 }),
  coolhand.getRealizedSavings()
]);

const savingsById = new Map(savings.workloads.map((row) => [row.id, row]));

const roi = workloads.map((workload) => ({
  id: workload.id,
  name: workload.name,
  spendLast30Days: workload.metrics?.total_cost ?? null, // windowed
  realizedSavings: savingsById.get(workload.id)?.savings ?? 0 // not windowed
}));
```

`searchWorkloads` is paged (`page`, `per`, max 100), so follow `pagination.has_next_page` for a client
with more workloads than one page. This is how the `get_client_roi_summary` MCP tool composes the two
endpoints.
