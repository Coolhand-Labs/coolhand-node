# Examples

## Live smoke tests

`openai-example.js` and `anthropic-example.js` are small, runnable scripts
that exercise Coolhand against a real provider API call. Each configures
`Coolhand` with `silent: false`, so a successful run prints a `🎉 LOGGING
... API Call #...` line once the response finishes being captured — that
line only confirms interception, not delivery, since the log upload to
Coolhand's API happens asynchronously afterward and swallows its own
errors. Look for the delivery outcome that follows: `✅ Successfully
logged to API...` confirms the log actually reached Coolhand; a `❌
Request error`/`❌ Request failed`/`❌ Failed to log request to API` line
means delivery failed silently — **the exit code alone doesn't tell you
this happened**, since exit code `0` covers both a clean skip (no keys
set) and a provider call that succeeded but whose log delivery failed.

Exit code does tell you whether the *provider call itself* worked: `0`
means either a clean skip or a successful provider call; a non-zero exit
means the provider call failed (bad/expired key, missing content in the
response) or the provider call and/or the pending log upload didn't settle
within 30 seconds combined (logged as a timeout, not silence).

These are used by the `/prep-release` skill as a live smoke test before a
release ships, and are just as useful to run by hand when working on the
interceptor code.

### Prerequisites

Build the package first (`npm run build`) — both scripts import from
`../dist/index.js`. Then set `COOLHAND_API_KEY` plus the API key for
whichever provider script you want to run:

| Script | Required env var |
|---|---|
| `openai-example.js` | `OPENAI_API_KEY` |
| `anthropic-example.js` | `ANTHROPIC_API_KEY` |

A script whose `COOLHAND_API_KEY` or provider key isn't set exits `0` with
a message saying it skipped — that's expected in an environment that
doesn't have every key configured, and isn't treated as a failure.

### Running

```bash
npm run build
node examples/openai-example.js
node examples/anthropic-example.js
```

Each script hits a different, unrelated provider, so they're also safe to
run in parallel (e.g. as background jobs) if you'd rather not wait for
them one at a time.

## Other examples in this directory

- `basic.js` / `feedback-example.js` — demo scripts showing SDK setup and
  the feedback API; not live smoke tests (no real provider call).
- `custom-patterns.json` — a sample custom patterns file.
- `anthropic-streaming.js` — a targeted regression check for capturing
  usage from a streaming Anthropic response; runs against a local mock
  server by default, or the real API if `ANTHROPIC_API_KEY` is set. It
  doesn't require `COOLHAND_API_KEY` and doesn't exercise the log-upload
  path, so it's not a substitute for `anthropic-example.js` above.
- `fastify-openai-unbundled/` — a full example app (its own
  `package.json`) showing Coolhand wired into a Fastify + TypeScript
  service; its smoke test (run in CI) uses a fake key, not a live call.
