// examples/abandoned-stream.js
//
// Live smoke test for abandoned streamed responses (raw_request.stream_incomplete): real
// Anthropic streaming calls that the caller cuts short, monitored end-to-end by Coolhand, with the
// exact log payload sent to Coolhand's API inspected. Three calls:
//   1. fetch, abandoned: cancel the body once content arrives   -> stream_incomplete: true
//   2. https, abandoned: res.destroy() once content arrives     -> stream_incomplete: true
//   3. fetch, read to the end (control)                         -> no stream_incomplete field
// Run: node examples/abandoned-stream.js
// Requires: see examples/README.md

import https from 'node:https';
import { requireEnvOrSkip, initCoolhand, runOrFail } from './_shared.js';

requireEnvOrSkip('abandoned-stream.js', 'COOLHAND_API_KEY', 'ANTHROPIC_API_KEY');

// Installed before initCoolhand(), so it sits underneath Coolhand's patched fetch and sees the
// log uploads Coolhand actually sends (a payload and its HTTP status), not just what it intended.
const uploads = [];
const underlyingFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const response = await underlyingFetch(input, init);
  if (url.includes('/api/v2/llm_request_logs') && init?.method === 'POST' && typeof init.body === 'string') {
    uploads.push({ status: response.status, rawRequest: JSON.parse(init.body).llm_request_log.raw_request });
  }
  return response;
};

initCoolhand();

const HEADERS = {
  'Content-Type': 'application/json',
  'x-api-key': process.env.ANTHROPIC_API_KEY,
  'anthropic-version': '2023-06-01'
};
const LONG = { max_tokens: 400, prompt: 'Count from 1 to 100, one number per line.' };
const SHORT = { max_tokens: 16, prompt: 'Reply with a single short word.' };

function messageBody({ max_tokens, prompt }) {
  return JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens,
    stream: true,
    messages: [{ role: 'user', content: prompt }]
  });
}

async function nextUpload(previousCount) {
  const deadline = Date.now() + 15_000;
  while (uploads.length <= previousCount) {
    if (Date.now() > deadline) { throw new Error('No log upload reached Coolhand within 15s.'); }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return uploads[previousCount];
}

function check(label, upload, { incomplete }) {
  const { status, rawRequest } = upload;
  if (status < 200 || status >= 300) { throw new Error(`${label}: Coolhand answered ${status} to the log upload.`); }
  if (incomplete && rawRequest.stream_incomplete !== true) {
    throw new Error(`${label}: expected stream_incomplete: true, got ${JSON.stringify(rawRequest.stream_incomplete)}.`);
  }
  if (!incomplete && 'stream_incomplete' in rawRequest) {
    throw new Error(`${label}: a completed stream must omit stream_incomplete, got ${rawRequest.stream_incomplete}.`);
  }
  const body = String(rawRequest.response_body ?? '');
  if (!body.includes('message_start')) { throw new Error(`${label}: response_body has no stream content: ${body.slice(0, 120)}`); }
  if (incomplete && body.includes('message_stop')) {
    throw new Error(`${label}: stream was abandoned but the whole response was captured.`);
  }
  if (!incomplete && !body.includes('message_stop')) { throw new Error(`${label}: completed stream is missing message_stop.`); }
  console.log(`✅ ${label}: status ${status}, stream_incomplete ${incomplete ? 'true' : 'omitted'}, ${body.length} chars captured`);
}

async function fetchStream(request) {
  const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: HEADERS, body: messageBody(request) });
  if (!response.ok) { throw new Error(`Anthropic request failed: ${response.status} ${await response.text()}`); }
  return response;
}

await runOrFail(async () => {
  // 1. fetch, abandoned once content has arrived.
  let seen = uploads.length;
  const reader = (await fetchStream(LONG)).body.getReader();
  const decoder = new TextDecoder();
  let received = '';
  while (!received.includes('content_block_delta')) {
    const { value, done } = await reader.read();
    if (done) { throw new Error('fetch abandoned: the stream ended before any content arrived.'); }
    received += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  check('fetch abandoned', await nextUpload(seen), { incomplete: true });

  // 2. https, abandoned once content has arrived.
  seen = uploads.length;
  await new Promise((resolve, reject) => {
    const req = https.request('https://api.anthropic.com/v1/messages', { method: 'POST', headers: HEADERS }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`Anthropic request failed: ${res.statusCode}`)); res.resume(); return; }
      let received = '';
      res.on('data', (chunk) => {
        received += chunk;
        if (received.includes('content_block_delta')) { res.destroy(); resolve(); }
      });
    });
    req.on('error', (error) => { if (error.code !== 'ECONNRESET') { reject(error); } });
    req.end(messageBody(LONG));
  });
  check('https abandoned', await nextUpload(seen), { incomplete: true });

  // 3. fetch, read to the end: the marker must be absent.
  seen = uploads.length;
  await (await fetchStream(SHORT)).text();
  check('fetch completed (control)', await nextUpload(seen), { incomplete: false });

  console.log('See examples/README.md for how to confirm the request was both intercepted and delivered to Coolhand.');
});
