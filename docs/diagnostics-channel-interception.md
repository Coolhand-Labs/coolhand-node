# Design exploration: `diagnostics_channel`-based interception

**Status:** exploratory — no implementation planned yet. This document scopes the tradeoffs for [#211](https://github.com/Coolhand-Labs/coolhand-node/issues/211); it is not a spec and does not commit to an approach.

## TL;DR

coolhand-node intercepts outbound AI calls by monkey-patching JS-level references (`globalThis.fetch`, `https.request`, `http.request`). Any code that captured a *copy* of one of those references before `initializeGlobalMonitoring()` ran keeps calling the original, unpatched function forever — silently, with no error. Node's `diagnostics_channel` module exposes events at the network-dispatch layer instead, which would sidestep that whole class of bug. This is a real option, but it's a parallel interception pipeline, not a drop-in fix: it changes when/how exclusion filtering can run, body capture needs its own solution for the fetch path (and unmodified teeing for the http/https path), and channel stability across supported Node versions needs confirming. Recommendation below is a narrow, flagged prototype — not a cutover.

**This is not the same thing as `coolhand-node/test-utils`.** That's a CI helper added alongside this doc (see `docs/global-monitoring.md`'s "Catching this in your own CI") that lets *you* assert a specific test's traffic was intercepted — a stopgap you apply one code path at a time. It does not close the underlying gap this document is about: a client library or code path nobody wrote a test for can still bypass monitoring in production, forever, with nothing to catch it. Closing that gap at the source is what this document explores.

## Problem

coolhand-node currently intercepts outbound AI API calls by monkey-patching JS-level exports — `patchFetch()`, `patchHTTPS()`, `patchHTTP()` in `src/global-monitor.ts`. Each function captures the current value of a global reference (`globalThis.fetch`, `https.request`, `http.request`) in a closure and reassigns the property to a wrapper that calls through to the captured original.

This works whenever calling code reads the patched reference fresh at call time, but fails silently for any code that already holds a *copy* of the pre-patch reference — most commonly a client library that captures `fetch`/`http.request` once, in its own constructor, before `initializeGlobalMonitoring()` has run. `openai` v5+ is one concrete example (`this.fetch = options.fetch ?? Shims.getDefaultFetch()`); any client with the same constructor shape has the same exposure. [#210](https://github.com/Coolhand-Labs/coolhand-node/issues/210) / [#212](https://github.com/Coolhand-Labs/coolhand-node/pull/212) fixed one concrete instance of this (lazy-construct the OpenAI client in `examples/fastify-openai-unbundled`), and `docs/global-monitoring.md` troubleshooting items 4–5 document the general pattern and `coolhand-node/test-utils` gives consumers a way to catch it in their own CI — but as the TL;DR above notes, neither closes the structural gap: a request made through a stale-captured reference never touches coolhand's patched wrapper at all, so there's no way for coolhand-node to detect or warn about it from inside the current architecture, and no test anyone forgot to write will ever fail on its own.

## Proposed mechanism

Node's `diagnostics_channel` module lets subscribers observe events published at fixed points in the runtime, independent of which JS-level function reference calling code holds. Two relevant channel families exist today:

### `undici` channels (cover global `fetch`)

Node's built-in `fetch` is powered by `undici`, which publishes (per [`nodejs/undici`'s `DiagnosticsChannel.md`](https://github.com/nodejs/undici/blob/main/docs/docs/api/DiagnosticsChannel.md)):

- Request lifecycle: `undici:request:create`, `undici:request:bodyChunkSent`, `undici:request:bodySent`, `undici:request:headers`, `undici:request:bodyChunkReceived`, `undici:request:trailers`, `undici:request:error`, `undici:request:pending-requests`
- Connection: `undici:client:sendHeaders`, `undici:client:beforeConnect`, `undici:client:connected`, `undici:client:connectError`
- (WebSocket and proxy channels also exist but aren't relevant here.)

Node's built-in `fetch` (and therefore these channels) is available from Node 18, this package's minimum supported version; the exact set of channels published per Node 18/20/22 minor should be confirmed before relying on them.

### Node's `http`/`https` client channels

Documented under Node's [`diagnostics_channel` API docs](https://nodejs.org/api/diagnostics_channel.html), **Stability 1 (Experimental)**:

- `http.client.request.created`, `http.client.request.start`, `http.client.request.error`, `http.client.response.finish`

Exact per-minor-version availability across Node 18/20/22 (this package's supported `engines` range and CI matrix, per `.github/workflows/ci.yml`) needs to be confirmed before relying on these — the docs don't give per-channel "Added in" versions, only the section-level Experimental marker.

Subscribing to both families would let coolhand-node observe traffic regardless of when a client library was constructed relative to `initializeGlobalMonitoring()` — the ordering requirement would shrink from "init before any AI client is constructed anywhere in the app" to "init before the first real outbound request," which matches how most apps already sequence startup and is a much easier bar to clear by accident.

This is the same technique APM/tracing vendors (Datadog, Sentry, OpenTelemetry's `@opentelemetry/instrumentation-undici`) use for exactly this class of monkey-patch fragility.

## Response body capture — more nuanced than initially assumed

The issue that prompted this exploration assumed diagnostics_channel events give headers/trailers/timing but not response bodies, requiring a different approach from the current stream-teeing (`src/utils/tee-response.ts`). That's only partially true:

- **undici does expose raw response bytes**: `undici:request:bodyChunkReceived` fires per chunk with the raw `Buffer`. Reconstructing a body is possible in principle by concatenating chunks keyed by request, without needing to tee the stream at all.
- However, it's **unconfirmed whether those chunks are pre- or post-decompression** (gzip/deflate/br) — the current `patchResponseEmit`/`tee-response.ts` pipeline already handles decompression (`MAX_DECOMPRESSED_BYTES`, `src/utils/decompress.ts`), and an undici-channel-based capture path would need to either reuse that logic or discover it doesn't need to (if undici hands back already-decoded bytes).
- **`http`/`https` client channels carry no body-bearing payload at all** — only `request`/`response` object references (`http.ClientRequest`/`IncomingMessage`). Body capture there would still need something equivalent to the existing teeing approach layered on top, for the same multi-consumer-stream reasons `tee-response.ts` exists today.

This means body capture is "possible but needs its own reassembly/decoding layer for the fetch path, and still needs teeing for the http/https path" — not "not possible" as originally framed. This should be scoped explicitly, not assumed away, before implementation.

## Architectural implications

- This would be a **parallel interception pipeline**, not a drop-in replacement: `src/global-monitor.ts` has no existing `diagnostics_channel`/`undici` usage (confirmed by grep across `src/`), so this is genuinely new API surface, not an extension of the current patching code.
- The current pattern-matching/exclusion pipeline (`matchesAPIPatternSync`/`matchesAPIPatternFromURL`, self/excluded-endpoint checks, dedup via `isRequestActive`) runs **before** a request is dispatched, inside the patched wrapper — it can veto interception (e.g. skip self-requests, skip excluded patterns) before the underlying call is even made. Under a diagnostics_channel model, `undici:request:create`/`http.client.request.created` fire *after* the request object already exists — the same exclusion logic would need to run as a filter on already-created requests rather than a gate before creation. Requests that should be excluded (e.g. calls to coolhand's own logging endpoint) would need to be filtered post-hoc instead of never intercepted in the first place — worth checking this can't cause a feedback loop before committing to the approach.
- Two mechanisms live side by side during any transition (or indefinitely, as a fallback for environments/Node versions where channels are unavailable/unstable) — added complexity and a second code path to keep correct, not a simplification.

## Open questions (not resolved by this document)

1. Exact per-Node-version stability/availability of `http.client.request.*` channels across the 18/20/22 CI matrix.
2. Whether pattern-matching/exclusion should run as a pre-filter on `undici:request:create` (before the request is sent — requires that channel to allow inspection early enough) or purely as a post-hoc classifier.
3. Whether `undici:request:bodyChunkReceived` bytes are pre- or post-decompression, and whether the existing `CappedBuffer`/decompress pipeline can be reused as-is.
4. Whether to run this as an opt-in alternate mode behind a config flag, a parallel-and-compared mode (for confidence before cutover), or eventually the default — and what that means for semver (the issue flags this as "likely a semver-major change given how central the interception mechanism is").

## Recommendation

Treat this as its own design-and-prototype spike, not a PR: build a minimal, flagged, opt-in `diagnostics_channel` listener for the fetch path only (narrowest scope, since `undici:request:*` channels are better-documented and less Experimental than the `http.client.*` ones), validate header/status/timing capture parity against the current `patchFetch()` path on real traffic, and resolve the four open questions above before deciding whether to extend to `http`/`https` or propose a cutover.

In the meantime, `coolhand-node/test-utils` (see `docs/global-monitoring.md`) remains the only mitigation available today, and it's opt-in and per-test by nature — it doesn't reduce the odds of a client bypassing monitoring in production going forward, only the odds that an *individual test author* fails to notice when it does. If closing that broader gap is a priority, the prototype described above is the next concrete step, not another documentation pass.

## References

- [#210](https://github.com/Coolhand-Labs/coolhand-node/issues/210) / [#212](https://github.com/Coolhand-Labs/coolhand-node/pull/212) — the concrete incident that prompted this exploration, and its fix
- [#211](https://github.com/Coolhand-Labs/coolhand-node/issues/211) — this exploration's tracking issue
- `docs/global-monitoring.md` troubleshooting items 4–5, and its "Catching this in your own CI" section (the `coolhand-node/test-utils` stopgap)
- `src/global-monitor.ts`: `patchFetch()`, `patchHTTPS()`, `patchHTTP()`
- `src/test-utils.ts` — the stopgap CI helper referenced above
- `src/utils/tee-response.ts` — current response-body capture mechanism
- [Node.js `diagnostics_channel` docs](https://nodejs.org/api/diagnostics_channel.html)
- [`nodejs/undici` `DiagnosticsChannel.md`](https://github.com/nodejs/undici/blob/main/docs/docs/api/DiagnosticsChannel.md)
