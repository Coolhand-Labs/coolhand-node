'use strict';
const assert = require('node:assert/strict');

// Smoke-test that the CJS build exports the expected symbols and works end-to-end
const pkg = require('../dist/index.cjs');

assert.equal(typeof pkg.default, 'function', 'Coolhand class should be default export');
assert.equal(typeof pkg.initializeGlobalMonitoring, 'function', 'initializeGlobalMonitoring should be exported');
assert.equal(typeof pkg.getGlobalStats, 'function', 'getGlobalStats should be exported');
assert.equal(typeof pkg.isGlobalMonitoringActive, 'function', 'isGlobalMonitoringActive should be exported');
assert.equal(typeof pkg.PatternMatchingService, 'function', 'PatternMatchingService should be exported');

// Verify that api-patterns.json is found and loaded correctly.
// getPatternsCountSync() === 0 means the JSON was not found (bundling path regression).
const svc = new pkg.PatternMatchingService({ silent: true });
const count = svc.getPatternsCountSync();
assert.ok(count > 0, `PatternMatchingService loaded ${count} patterns — expected > 0 (api-patterns.json not found?)`);

// Verify that at least one well-known AI domain actually matches
const match = svc.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions');
assert.notEqual(match, null, 'Expected api.openai.com to match a pattern');
assert.equal(match.pattern.name, 'OpenAI', `Expected pattern name "OpenAI", got "${match.pattern.name}"`);

// Verify singleton: auto-monitor's initialisation should be visible via the index entry point.
// (This would silently fail if bundle:true duplicated global-monitor state.)
require('../dist/auto-monitor.cjs');
const stats = pkg.getGlobalStats();
assert.equal(typeof stats, 'object', 'getGlobalStats() should return an object after auto-monitor is loaded');

console.log(`CJS smoke test passed (${count} patterns loaded, OpenAI matched)`);
