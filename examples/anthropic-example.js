// examples/anthropic-example.js
//
// Live smoke test: one real Anthropic message, monitored end-to-end by
// Coolhand (interception + a real log upload to Coolhand's API).
// Run: node examples/anthropic-example.js
// Requires: see examples/README.md

import { requireEnvOrSkip, initCoolhand, fetchOrThrow, assertContent, reportSuccess, runOrFail } from './_shared.js';

requireEnvOrSkip('anthropic-example.js', 'COOLHAND_API_KEY', 'ANTHROPIC_API_KEY');
initCoolhand();

const PROVIDER = 'Anthropic';

await runOrFail(async () => {
  const data = await fetchOrThrow('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with a single short word.' }]
    })
  }, PROVIDER);

  const content = assertContent(data.content?.[0]?.text, PROVIDER, data);

  reportSuccess(PROVIDER, content);
});
