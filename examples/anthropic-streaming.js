// examples/anthropic-streaming.js
//
// Demonstrates capturing usage (input/output token counts) from a streaming
// Anthropic `/v1/messages` response. Anthropic's streaming API sends usage as
// two separate SSE events — `message_start` (input_tokens) and `message_delta`
// (output_tokens) — rather than a single JSON body, so it's worth confirming
// the full SSE stream (not just the first chunk) makes it into the captured
// response body. See https://github.com/Coolhand-Labs/coolhand-node/issues/145.
//
// By default this runs against a local mock server that mimics Anthropic's
// streaming format (including gzip content-encoding, which real API responses
// use) — no API key required. Set ANTHROPIC_API_KEY to run the same check
// against the real API instead.
//
// Usage:
//   node examples/anthropic-streaming.js              # local mock server
//   ANTHROPIC_API_KEY=sk-ant-... node examples/anthropic-streaming.js

import http from 'http';
import https from 'https';
import zlib from 'zlib';
import { RequestMonitoringService, PatternMatchingService } from '../dist/index.js';

async function startMockAnthropicServer() {
  const events = [
    { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_mock', model: 'claude-haiku-4-5-20251001', usage: { input_tokens: 25, output_tokens: 1 } } } },
    { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello, world!' } } },
    { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } } },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ];

  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Content-Encoding': 'gzip', // real Anthropic API responses are gzip-compressed
    });
    const gz = zlib.createGzip();
    gz.pipe(res);
    let i = 0;
    const sendNext = () => {
      if (i >= events.length) { gz.end(); return; }
      const evt = events[i++];
      gz.write(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`);
      setTimeout(sendNext, 5);
    };
    sendNext();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function main() {
  const useRealApi = Boolean(process.env.ANTHROPIC_API_KEY);
  const server = useRealApi ? null : await startMockAnthropicServer();
  const requestOptions = useRealApi
    ? {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          // Node's raw https.request() doesn't send this by default, unlike most
          // real HTTP clients (axios, undici, etc.) — set explicitly so this
          // example exercises the same gzip-response path they'd hit in practice.
          'accept-encoding': 'gzip, deflate',
        },
      }
    : {
        hostname: '127.0.0.1',
        port: server.address().port,
        path: '/v1/messages',
        method: 'POST',
        headers: { 'x-api-key': 'sk-ant-fake', 'content-type': 'application/json' },
      };
  const requestModule = useRealApi ? https : http;
  const requestBody = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 64,
    stream: true,
    messages: [{ role: 'user', content: 'Say hello in one short sentence.' }],
  });

  console.log(`🧪 Anthropic streaming usage capture (${useRealApi ? 'live API' : 'local mock server'})\n`);

  // Use the monitoring/pattern-matching services directly (rather than the top-level
  // Coolhand class) so we can inspect the captured callData locally instead of only
  // submitting it to the backend — useful for confirming what actually got captured.
  const patternMatchingService = new PatternMatchingService();
  const monitor = new RequestMonitoringService(patternMatchingService, /* silent */ true);
  const matchedPattern = {
    pattern: { name: 'Anthropic', domains: ['api.anthropic.com'], paths: ['/v1/messages'], headers: { 'x-api-key': '[REDACTED]' } },
    matchType: 'domain',
    matchValue: 'api.anthropic.com',
  };

  const captured = await new Promise((resolve, reject) => {
    monitor.onRequestComplete = resolve;

    const req = monitor.interceptRequest(requestModule.request, requestOptions, undefined, useRealApi ? 'https' : 'http', matchedPattern);
    req.on('error', reject);
    req.end(requestBody);
  });

  server?.close();

  const body = typeof captured.response_body === 'string' ? captured.response_body : JSON.stringify(captured.response_body);
  const hasInputUsage = /"input_tokens"\s*:\s*\d+/.test(body);
  const hasOutputUsage = /"output_tokens"\s*:\s*\d+/.test(body);

  console.log(`📦 Captured response_body: ${body.length} chars`);
  console.log(`   message_start usage.input_tokens present: ${hasInputUsage ? '✅' : '❌'}`);
  console.log(`   message_delta usage.output_tokens present: ${hasOutputUsage ? '✅' : '❌'}`);

  if (!hasInputUsage || !hasOutputUsage) {
    console.log('\n⚠️  Usage tokens were NOT fully captured from the streamed response.');
    process.exitCode = 1;
  } else {
    console.log('\n✅ Full streaming usage was captured.');
  }
}

main().catch((err) => {
  console.error('❌ Example failed:', err);
  process.exitCode = 1;
});
