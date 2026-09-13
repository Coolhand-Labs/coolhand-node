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
  if (!content) {
    throw new Error(`No content in ${providerName} response: ${JSON.stringify(data)}`);
  }
  return content;
}

export function reportSuccess(providerName, content) {
  console.log(`${providerName} replied: ${content.trim()}`);
  console.log('See examples/README.md for how to confirm the request was both intercepted and delivered to Coolhand.');
}
