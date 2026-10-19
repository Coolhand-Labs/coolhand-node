# Declared Workloads and Templates

By default Coolhand matches each captured call to a template by its prompt. If you already know
which workload and template a call belongs to, **declare** it: wrap the call in `withContext` and
the log is sent with that identity, skipping log-to-template matching.

```ts
import { Coolhand, withContext } from 'coolhand-node';

new Coolhand({ apiKey: process.env.COOLHAND_API_KEY! }); // or: import 'coolhand-node/auto-monitor'

const summary = await withContext(
  {
    reporter: 'my-app',
    workload: { key: 'Parser#call', name: 'Parser#call', description: 'Parses user input' },
    template: { key: 'Parser#call/squish:L2', name: 'Parser#call · squish L2' }
  },
  () => openai.chat.completions.create({ /* ... */ })
);
```

`withContext` returns whatever the callback returns (a promise stays a promise). Every LLM call
captured while the callback runs — `fetch`, `http`, `https`, streamed or not — carries the
declaration. It uses `AsyncLocalStorage`, so it follows your code across `await`s.

## What you can declare

| Field | Meaning |
|---|---|
| `reporter` | Who is declaring (e.g. `"my-app"`). |
| `workload` | `{ id }` of an existing workload, or `{ key }` that is find-or-created. Also `name`, `description` (≤ 1000 chars). |
| `template` | `{ id }` or `{ key }` (`id` wins). Also `name`. |

- `id` references an existing record; an unknown or foreign id is a `422` and the **log is not saved**.
- `key` is find-or-created. `name`, `description` and `reporter` apply only when the record is first
  created — ingest never renames or re-attributes an existing one (use the upserts below).
- A workload alone gets a derived `<workload key>/default` template.
- A template `key` needs a workload (in this or an enclosing `withContext`); a template `id` does not.
- A blank `reporter` is treated as not given (an inner block inherits the outer reporter; there is no way to clear it).
- Only these fields are forwarded; anything else is dropped.

## Nesting

Per top-level field (`reporter`, `workload`, `template`) the **innermost** value wins.
`workload` and `template` are replaced as a whole, never merged key by key. A block that sets a
`workload` without a `template` does **not** inherit the outer template — it would pair the new
workload with another workload's template.

```ts
withContext({ workload: { key: 'Agent' }, template: { key: 'Agent/plan' } }, () => {
  withContext({ reporter: 'x' }, () => { /* Agent + Agent/plan, reporter x */ });
  withContext({ template: { key: 'Agent/act' } }, () => { /* Agent + Agent/act */ });
  withContext({ workload: { key: 'Other' } }, () => { /* Other, no template */ });
});
```

## Validation

The server drops the whole log for a bad declaration, so `withContext` checks it first and throws
**before your callback runs** — never from inside your LLM call:

- `workload` / `template` must be objects with a non-blank `id` or a `key` (a blank `id` counts as not given).
- Keys: at most 255 characters, no control or invisible-format characters, no broken (lone-surrogate)
  strings, no leading/trailing whitespace, no leading, trailing or doubled `/`. `#`, `:` and `·` are fine.
- A template `key` with no workload in scope.

## Timing

The declaration is captured when the call is **intercepted** and carried with it, so a log that is
sent later (after the response finishes, or from a background sender) still has the declaration even
though your `withContext` block has long since returned.

On native ESM under Node.js older than 20.16, `AsyncLocalStorage` is loaded asynchronously when the
package first loads, so a `withContext` call made synchronously during startup can run undeclared
(a one-time console warning says so). Any call after the first tick is fine.

## Warnings and caps

If the server saves the log but ignores the declaration (public-key callers are capped at 200
declared workloads / 1,000 templates; private keys are uncapped), its `warnings` are written to the
console unless `silent`. Nothing throws. Older servers ignore the unknown `declared` field, so
sending it is safe.

## Creating and renaming explicitly

`upsertWorkload` and `upsertTemplate` (private API key) create or update by key — useful to name a
workload before any call declares it:

```ts
const coolhand = new Coolhand({ apiKey: process.env.COOLHAND_PRIVATE_API_KEY! });

const { workload, created } = (await coolhand.upsertWorkload({
  key: 'Parser#call',
  name: 'Parser',
  description: 'Parses user input',
  reporter: 'my-app'
}))!;

await coolhand.upsertTemplate({
  key: 'Parser#call/squish:L2',
  workload: { key: 'Parser#call' }, // or { id: workload.id }
  name: 'Parser · squish L2'
});
```

- Only the fields you pass are sent, so an update changes only what you send. The key is immutable;
  a new `name` renames.
- `created` is `true` for a new record (`201`) and `false` for an update (`200`). The result is
  `null` only in dry-run mode.
- `workload` on a template is `{ id }` or `{ key }`; it is sent as the flat `workload_id` /
  `workload_key` parameter.
- The route is a glob. Each `/`-separated segment of the key is percent-encoded and `/` stays
  literal: `Parser#call/squish:L2` is requested as `Parser%23call/squish%3AL2`. Blank keys and
  empty, `.` or `..` segments are rejected before any request.
- These throw an `HttpError` (with `status`): `401` for a missing or public key, `422` for a taken
  name, and — for templates — a missing workload when creating, a different workload for an existing
  template, or a key held by a deprecated template.
- `upsertWorkload`/`upsertTemplate` additionally reject keys with `.` or `..` path segments (they would be resolved away in the URL), which `withContext` accepts as ordinary key text.
- These calls go to the Coolhand API and are never captured or declared themselves.
