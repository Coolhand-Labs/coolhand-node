# Linking feedback to an optimization

Attach feedback to an optimization as supporting evidence. Backed by
`POST /api/v2/optimizations/{optimization_id}/feedback_links` (single and bulk share the route)
and `DELETE /api/v2/optimizations/{optimization_id}/feedback_links/{id}`.

These methods require the client's **private** API key; the public key gets a `401`.

```ts
const coolhand = new Coolhand({ apiKey: process.env.COOLHAND_PRIVATE_API_KEY! });

// One feedback. `link.id` is the link's hashid, not the feedback's.
const link = await coolhand.linkFeedback('optimizationHashid', 'feedbackHashid', { note: 'why' });

// Many feedbacks.
const { linked, already_linked, errored, not_found } =
  await coolhand.bulkLinkFeedback('optimizationHashid', ['fb1', 'fb2', 'fb3']);

// Remove a link.
await coolhand.unlinkFeedback('optimizationHashid', link.id);
```

## Bulk behavior

- The server accepts at most 100 ids per request. `bulkLinkFeedback` splits longer lists into
  batches of 100, sums `linked`/`already_linked`/`errored` and concatenates `not_found`.
- Already-linked ids count as `already_linked`, not errors. Unknown, malformed and other-client ids
  are all reported in `not_found`.
- If a batch fails, the call throws and earlier batches stay applied. Repeating the call is safe.
- An empty list or a blank id throws before any request is made.

## Errors

All three methods throw. A non-2xx response throws an `HttpError` whose `status` is the HTTP code:
`401` missing/public key, `404` unknown optimization, feedback or link, `422` invalid input,
already-linked (single mode) or a `note` that is too long.
