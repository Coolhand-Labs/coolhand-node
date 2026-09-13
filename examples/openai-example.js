// examples/openai-example.js
//
// Live smoke test: one real OpenAI chat completion, monitored end-to-end by
// Coolhand (interception + a real log upload to Coolhand's API).
// Run: node examples/openai-example.js
// Requires: see examples/README.md

import { requireEnvOrSkip, initCoolhand, fetchOrThrow, assertContent, reportSuccess, runOrFail } from './_shared.js';

requireEnvOrSkip('openai-example.js', 'COOLHAND_API_KEY', 'OPENAI_API_KEY');
initCoolhand();

const PROVIDER = 'OpenAI';

await runOrFail(async () => {
  const data = await fetchOrThrow('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with a single short word.' }]
    })
  }, PROVIDER);

  const content = assertContent(data.choices?.[0]?.message?.content, PROVIDER, data);

  reportSuccess(PROVIDER, content);
});
