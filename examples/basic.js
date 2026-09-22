// examples/basic.js
//
// Live smoke test: the most basic Coolhand setup — `new Coolhand({ apiKey })`
// with nothing else configured — making one real OpenAI call, and confirming
// both that the automatic http/https/fetch interception captured it and that
// getStats() reflects the intercepted call. See examples/README.md.
//
// Run: node examples/basic.js
// Requires: see examples/README.md (COOLHAND_API_KEY, OPENAI_API_KEY)

import Coolhand from '../dist/index.js';
import { requireEnvOrSkip, fetchOrThrow, assertContent, runOrFail } from './_shared.js';

requireEnvOrSkip('basic.js', 'COOLHAND_API_KEY', 'OPENAI_API_KEY');

await runOrFail(async () => {
  console.log('🧪 Basic usage: new Coolhand({ apiKey }), default config\n');

  const monitor = new Coolhand({ apiKey: process.env.COOLHAND_API_KEY, silent: false });

  const before = monitor.getStats();
  console.log('📊 Stats before any call:', before);
  if (before.interceptedCalls !== 0) {
    throw new Error(`Expected 0 intercepted calls before any request, got ${before.interceptedCalls}`);
  }

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
  }, 'OpenAI');

  const content = assertContent(data.choices?.[0]?.message?.content, 'OpenAI', data);
  console.log(`OpenAI replied: ${content.trim()}`);

  const after = monitor.getStats();
  console.log('\n📊 Stats after the call:', after);
  if (after.interceptedCalls !== before.interceptedCalls + 1) {
    throw new Error(`Expected interceptedCalls to increase by 1, went from ${before.interceptedCalls} to ${after.interceptedCalls}`);
  }
  console.log('✅ getStats() reflects the intercepted call.');

  console.log('\n💡 Other options this basic setup omits — see docs/global-monitoring.md and README.md:');
  console.log('   - patternsFile: "./my-custom-patterns.json"  (add support for additional providers)');
  console.log('   - excludeApiPatterns: [...]                  (skip specific endpoints)');
  console.log('   - baseUrl: "https://your-self-hosted-backend" (self-hosted Coolhand)');
  console.log('\nSee examples/README.md for how to confirm the request was both intercepted and delivered to Coolhand.');
});
