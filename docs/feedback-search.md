# Reading Feedback (Search + Get)

`searchFeedback()` and `getFeedback()` read back feedback previously submitted via
`createFeedback()` or the [coolhand](https://github.com/Coolhand-Labs/coolhand-js) widget.

**Auth:** both require your **private** API key, passed as `apiKey` in the `Coolhand`
constructor. The public key used for `createFeedback`/`logRequest` will 401 on these endpoints —
construct a separate `Coolhand` instance with the private key if your process also writes
feedback with the public key.

## `searchFeedback(params)`

```typescript
import { Coolhand } from 'coolhand-node';

const coolhand = new Coolhand({ apiKey: 'your-private-api-key' });

const { feedback, pagination } = await coolhand.searchFeedback({
  sentiment_eq: 0, // 0 = dislike, 1 = neutral, 2 = like
  explanation_cont: 'unhelpful',
  s: 'created_at desc',
  page: 1,
  per: 25
});
```

### Parameters

`params: SearchFeedbackParams` is close to the wire format — it's forwarded as raw
[Ransack](https://github.com/activerecord-hackery/ransack) query params (`q[<predicate>]=<value>`),
plus top-level `page`/`per`:

| Field | Type | Description |
|---|---|---|
| `sentiment_eq` | `0 \| 1 \| 2` | Exact match on sentiment. Takes the raw integer code the server stores (`0`=dislike, `1`=neutral, `2`=like) — **not** the `"like"`/`"dislike"`/`"neutral"` string the `sentiment` field renders as in responses. |
| `explanation_cont` | `string` | Substring match on the explanation text |
| `s` | `string` | Ransack sort expression, e.g. `"created_at desc"` |
| `page` | `number` | Page number (not wrapped in `q[...]`) |
| `per` | `number` | Page size (not wrapped in `q[...]`) |
| *(any other key)* | `string \| number \| boolean` | Any other Ransack predicate the search endpoint accepts (e.g. `workload_hashid_eq`), wrapped as `q[<key>]` |

Exact supported predicates are whatever `Api::V2::LlmRequestLogFeedbacksController#index` accepts
on the Coolhand server — this method doesn't validate or translate predicate names.

### Return value

`Promise<SearchFeedbackResponse>`:

```typescript
{
  feedback: LLMRequestLogFeedbackSummary[]; // omits original_output/revised_output
  pagination: {
    current_page: number;
    per_page: number;
    total_count: number;
    total_pages: number;
    has_next_page: boolean;
    has_prev_page: boolean;
  };
}
```

## `getFeedback(id)`

```typescript
const record = await coolhand.getFeedback('a1B2c3'); // the hashid from a search result's `id`
console.log(record.original_output, record.revised_output, record.feedback_partials);
```

Returns `Promise<LLMRequestLogFeedbackDetail>` — the full record, including
`original_output`/`revised_output` (omitted from search results) and `feedback_partials`.

## Errors

Both methods throw an `HttpError` (exported from `coolhand-node`) on a non-2xx response, with the
HTTP status attached to the `status` property, so callers can branch on it (e.g. 401 →
re-authenticate, 404 → unknown ID) without parsing the message string:

```typescript
import { Coolhand, HttpError } from 'coolhand-node';

try {
  await coolhand.getFeedback('does-not-exist');
} catch (err) {
  if (err instanceof HttpError && err.status === 404) {
    // handle not found
  }
  throw err;
}
```

Network failures, non-JSON response bodies, and a blank/whitespace-only or dot-segment (`.`/`..`)
`id` passed to `getFeedback` (rejected client-side before the request is made) throw a plain
`Error` without a `status` property.
