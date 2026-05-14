import assert from 'node:assert/strict';

// Smoke-test that the ESM build exports the expected symbols and works end-to-end
import pkg from '../dist/index.js';
import { initializeGlobalMonitoring, getGlobalStats, isGlobalMonitoringActive, PatternMatchingService } from '../dist/index.js';

assert.equal(typeof pkg, 'function', 'default export should be the Coolhand class');
assert.equal(typeof initializeGlobalMonitoring, 'function', 'initializeGlobalMonitoring should be exported');
assert.equal(typeof getGlobalStats, 'function', 'getGlobalStats should be exported');
assert.equal(typeof isGlobalMonitoringActive, 'function', 'isGlobalMonitoringActive should be exported');
assert.equal(typeof PatternMatchingService, 'function', 'PatternMatchingService should be exported');

// Verify api-patterns.json is found and patterns load correctly
const svc = new PatternMatchingService({ silent: true });
const count = svc.getPatternsCountSync();
assert.ok(count > 0, `PatternMatchingService loaded ${count} patterns — expected > 0 (api-patterns.json not found?)`);

// Verify a well-known AI domain matches
const match = svc.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions');
assert.notEqual(match, null, 'Expected api.openai.com to match a pattern');
assert.equal(match.pattern.name, 'OpenAI', `Expected pattern name "OpenAI", got "${match.pattern.name}"`);

// Verify singleton: auto-monitor's initialisation should be visible via the index entry point
await import('../dist/auto-monitor.js');
const stats = getGlobalStats();
assert.equal(typeof stats, 'object', 'getGlobalStats() should return an object after auto-monitor is loaded');

console.log(`ESM smoke test passed (${count} patterns loaded, OpenAI matched)`);
