// examples/_shared.js
//
// Shared helpers for the live-key smoke test scripts in this directory
// (openai-example.js, anthropic-example.js).

import fs from 'node:fs';
import Coolhand from '../dist/index.js';

export function requireEnvOrSkip(scriptName, ...envVars) {
  for (const name of envVars) {
    if (!process.env[name]) {
      // Write synchronously to fd 1 rather than console.log: when stdout is a
      // pipe (the common case when another process/agent captures this
      // script's output), console.log's write can be asynchronous and get
      // truncated by the process.exit() call immediately after it.
      fs.writeSync(1, `Skipping ${scriptName} — ${name} not set.\n`);
      process.exit(0);
    }
  }
}

export function initCoolhand() {
  new Coolhand({ apiKey: process.env.COOLHAND_API_KEY, silent: false });
}

export async function fetchOrThrow(url, options, providerName) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`${providerName} request failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

export function assertContent(content, providerName, data) {
  // == null (not falsy) — a legitimate empty-string completion (e.g. a stop
  // sequence hit immediately) still proves the round-trip worked and
  // shouldn't be treated the same as a missing/undefined field.
  if (content == null) {
    throw new Error(`No content in ${providerName} response: ${JSON.stringify(data)}`);
  }
  return content;
}

export function reportSuccess(providerName, content) {
  console.log(`${providerName} replied: ${content.trim()}`);
  console.log('See examples/README.md for how to confirm the request was both intercepted and delivered to Coolhand.');
}

export async function runOrFail(main) {
  // Safety net — registered *before* calling `main`, not just around the
  // post-completion log-delivery drain. Neither leg has its own timeout:
  // BaseService's fetch calls don't set one for the Coolhand log upload, and
  // the provider call above (a real network request to OpenAI/Anthropic) has
  // none either. Registering this only after `main()` settles would leave a
  // stalled provider call with no bound at all. 30s covers a slow provider
  // response plus the log upload, rather than just the upload leg, so it's
  // wider than a pure "log upload" budget. Force-exit after that window
  // rather than waiting forever — this only fires if the process hasn't
  // already exited naturally by then (unref'd, so it never delays a fast
  // exit).
  const timeout = setTimeout(() => {
    // Write synchronously to fd 2 rather than console.error, for the same
    // reason requireEnvOrSkip writes to fd 1 before its own process.exit —
    // an async console.error write can be truncated by the immediately
    // following process.exit() when stderr is a pipe.
    fs.writeSync(2, '❌ Timed out waiting for the provider call and/or Coolhand log upload to settle.\n');
    process.exit(1);
  }, 30_000);
  timeout.unref();

  try {
    await main();
  } catch (error) {
    // Catch rather than let this throw escape as an uncaught top-level
    // exception: an uncaught throw kills the process immediately, before
    // the interceptor's fire-and-forget log upload (kicked off inside the
    // fetch call above) gets a chance to run and print its own
    // delivery-confirmed/delivery-failed marker — exactly the signal
    // examples/README.md and the prep-release skill's Phase 4.2 rely on.
    // Falling off the end of the script instead lets Node's event loop
    // drain that pending upload before exiting, the same as the
    // happy path already does.
    //
    // A caught value isn't guaranteed to be an Error instance (matching
    // src/utils/format-error.ts's rationale, not imported here since these
    // scripts intentionally stick to the package's public surface —
    // dist/index.js — rather than a dist/utils/* path that only happens to
    // exist because tsup currently compiles files 1:1 rather than bundling;
    // that layout is an implementation detail, not part of the public API).
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
