'use strict';
const assert = require('node:assert/strict');

const pkg = require('../dist/index.cjs');

assert.equal(typeof pkg.default, 'function', 'Coolhand class should be default export');
assert.equal(typeof pkg.initializeGlobalMonitoring, 'function', 'initializeGlobalMonitoring should be exported');
assert.equal(typeof pkg.getGlobalStats, 'function', 'getGlobalStats should be exported');
assert.equal(typeof pkg.isGlobalMonitoringActive, 'function', 'isGlobalMonitoringActive should be exported');
assert.equal(typeof pkg.PatternMatchingService, 'function', 'PatternMatchingService should be exported');

// Verify api-patterns.json is found and loaded correctly.
// getPatternsCountSync() === 0 means the JSON was not found (bundling path regression).
const svc = new pkg.PatternMatchingService({ silent: true });
const count = svc.getPatternsCountSync();
assert.ok(count > 0, `PatternMatchingService loaded ${count} patterns — expected > 0 (api-patterns.json not found?)`);

// Verify a well-known AI domain matches
const match = svc.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions');
assert.notEqual(match, null, 'Expected api.openai.com to match a pattern');
assert.equal(match.pattern.name, 'OpenAI', `Expected pattern name "OpenAI", got "${match.pattern.name}"`);

// Singleton test: initialise via auto-monitor's exported function, then assert the
// state is visible from the index entry point. Without a shared global-monitor
// module instance this cross-entry check would return false.
(async () => {
  const autoMonitor = require('../dist/auto-monitor.cjs');
  await autoMonitor.initializeGlobalMonitoring({ apiKey: 'smoke-test-key', silent: true, dryRun: true });
  assert.equal(pkg.isGlobalMonitoringActive(), true,
    'index entry should see active state initialised via auto-monitor (shared singleton)');

  console.log(`CJS smoke test passed (${count} patterns loaded, OpenAI matched)`);
})().catch(err => { console.error(err); process.exitCode = 1; });
