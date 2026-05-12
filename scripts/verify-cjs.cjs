'use strict';

// Smoke-test that the CJS build exports the expected symbols and works end-to-end
const pkg = require('../dist/index.cjs');

console.assert(typeof pkg.default === 'function', 'Coolhand class should be default export');
console.assert(typeof pkg.initializeGlobalMonitoring === 'function', 'initializeGlobalMonitoring should be exported');
console.assert(typeof pkg.getGlobalStats === 'function', 'getGlobalStats should be exported');
console.assert(typeof pkg.isGlobalMonitoringActive === 'function', 'isGlobalMonitoringActive should be exported');
console.assert(typeof pkg.PatternMatchingService === 'function', 'PatternMatchingService should be exported');

// Verify that api-patterns.json is found and loaded correctly.
// getPatternsCountSync() === 0 means the JSON was not found (bundling path regression).
const svc = new pkg.PatternMatchingService({ silent: true });
const count = svc.getPatternsCountSync();
console.assert(count > 0, `PatternMatchingService loaded ${count} patterns — expected > 0 (api-patterns.json not found?)`);

// Verify that at least one well-known AI domain actually matches
const match = svc.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions');
console.assert(match !== null, 'Expected api.openai.com to match a pattern');
console.assert(match && match.pattern.name === 'OpenAI', `Expected pattern name "OpenAI", got "${match && match.pattern.name}"`);

// auto-monitor: just require it (triggers env-var check, no assertion needed beyond no throw)
require('../dist/auto-monitor.cjs');

console.log(`CJS smoke test passed (${count} patterns loaded, OpenAI matched)`);
