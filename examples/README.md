# Examples

## Live smoke tests

`openai-example.js`, `anthropic-example.js`, `basic.js` and
`feedback-example.js` are small, runnable scripts that exercise Coolhand
against real provider/Coolhand API calls — no mocking. Each configures
`Coolhand` (or the individual services it's built from) with `silent:
false`, so a successful run prints a `🎉 LOGGING ... API Call #...` line
once the response finishes being captured — that line only confirms
interception, not delivery, since the log upload to Coolhand's API happens
asynchronously afterward and swallows its own errors. Look for the
delivery outcome that follows: `✅ Successfully logged to API...` (or, for
`feedback-example.js`, its own `✅ Log delivered`/`✅ Feedback delivered`
lines) confirms the log/feedback actually reached Coolhand; a `❌ Request
error`/`❌ Request failed`/`❌ Failed to log request to API`/`❌ ... failed —
... returned null` line means delivery failed silently — **the exit code
alone doesn't tell you this happened**, since exit code `0` covers both a
clean skip (no keys set) and a provider call that succeeded but whose
delivery failed.

Exit code does tell you whether the *provider call itself* worked: `0`
means either a clean skip or a successful provider call; a non-zero exit
means the provider call failed (bad/expired key, missing content in the
response), a delivery step returned `null`, or something didn't settle
within 30 seconds (logged as a timeout, not silence).

These are used by the `/prep-release` skill as a live smoke test before a
release ships, and are just as useful to run by hand when working on the
interceptor code.

- `openai-example.js` / `anthropic-example.js` — one real chat completion
  each, through the automatic `new Coolhand()` interception, proving
  interception + log delivery for that provider.
- `basic.js` — the most basic `new Coolhand({ apiKey })` setup, making one
  real OpenAI call; additionally asserts `getStats().interceptedCalls`
  increases by exactly 1, so it also proves `getStats()` reflects real
  traffic, not just that a request didn't throw.
- `feedback-example.js` — one real Anthropic call, logged to Coolhand via
  `LoggingService` directly (so the script can read back the log's real
  `id`), then one real `FeedbackService#createFeedback` call attached to
  that exact log — proving delivery for *both* the log-upload and the
  feedback-creation paths, not just that `createFeedback()` didn't throw
  against a fabricated ID.

### Prerequisites

Build the package first (`npm run build`) — all four scripts import from
`../dist/index.js`. Then set `COOLHAND_API_KEY` plus the API key(s) for
whichever script(s) you want to run:

| Script | Required env vars |
|---|---|
| `openai-example.js` | `COOLHAND_API_KEY`, `OPENAI_API_KEY` |
| `anthropic-example.js` | `COOLHAND_API_KEY`, `ANTHROPIC_API_KEY` |
| `basic.js` | `COOLHAND_API_KEY`, `OPENAI_API_KEY` |
| `feedback-example.js` | `COOLHAND_API_KEY`, `ANTHROPIC_API_KEY` |

A script whose `COOLHAND_API_KEY` or provider key isn't set exits `0` with
a message saying it skipped — that's expected in an environment that
doesn't have every key configured, and isn't treated as a failure.

### Running

```bash
npm run build
node examples/openai-example.js
node examples/anthropic-example.js
node examples/basic.js
node examples/feedback-example.js
```

Each script hits a different combination of provider + Coolhand calls, so
they're also safe to run in parallel (e.g. as background jobs) if you'd
rather not wait for them one at a time — `basic.js` and
`feedback-example.js` don't share any log records with each other or with
`openai-example.js`/`anthropic-example.js`.

## Other examples in this directory

- `custom-patterns.json` — a sample custom patterns file.
- `anthropic-streaming.js` — a targeted regression check for capturing
  usage from a streaming Anthropic response; runs against a local mock
  server by default, or the real API if `ANTHROPIC_API_KEY` is set —
  neither mode needs `COOLHAND_API_KEY`. Its default job is confirming
  what interception *captured*, not exercising the log-upload path, so
  it's not part of the required table above. Set `COOLHAND_API_KEY` too
  and it additionally delivers the captured streaming call to Coolhand and
  confirms delivery the same way `feedback-example.js` does, printing its
  own `✅ Streaming call delivered to Coolhand, id=...` line.
- `fastify-openai-unbundled/` — a full example app (its own
  `package.json`) showing Coolhand wired into a Fastify + TypeScript
  service; its smoke test (run in CI) uses a fake key, not a live call.
