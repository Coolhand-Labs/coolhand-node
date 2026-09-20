import assert from 'node:assert/strict';

import pkg from '../dist/index.js';
import { initializeGlobalMonitoring, getGlobalStats, isGlobalMonitoringActive, PatternMatchingService } from '../dist/index.js';

assert.equal(typeof pkg, 'function', 'default export should be the Coolhand class');
assert.equal(typeof initializeGlobalMonitoring, 'function', 'initializeGlobalMonitoring should be exported');
assert.equal(typeof getGlobalStats, 'function', 'getGlobalStats should be exported');
assert.equal(typeof isGlobalMonitoringActive, 'function', 'isGlobalMonitoringActive should be exported');
assert.equal(typeof PatternMatchingService, 'function', 'PatternMatchingService should be exported');

// Verify api-patterns.json is found and loaded correctly.
// getPatternsCountSync() === 0 means the JSON was not found (bundling path regression).
const svc = new PatternMatchingService({ silent: true });
const count = svc.getPatternsCountSync();
assert.ok(count > 0, `PatternMatchingService loaded ${count} patterns — expected > 0 (api-patterns.json not found?)`);

// Verify a well-known AI domain matches
const match = svc.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions');
assert.notEqual(match, null, 'Expected api.openai.com to match a pattern');
assert.equal(match.pattern.name, 'OpenAI', `Expected pattern name "OpenAI", got "${match.pattern.name}"`);

// Singleton test: initialise via auto-monitor's exported function, then assert the
// state is visible from the index entry point. Without a shared global-monitor
// module instance this cross-entry check would return false.
const autoMonitor = await import('../dist/auto-monitor.js');
await autoMonitor.initializeGlobalMonitoring({ apiKey: 'smoke-test-key', silent: true, dryRun: true });
assert.equal(isGlobalMonitoringActive(), true,
  'index entry should see active state initialised via auto-monitor (shared singleton)');

// Verify the dist/test-utils build output resolves and its exports are wired up — a
// stale/broken exports map or missed build entry here would otherwise ship undetected. The
// typeof checks are what actually catch that; this script makes no real intercepted call, so
// the equality check below is 0 === 0 and, on its own, wouldn't catch a broken module-sharing
// regression (e.g. bundle:true re-introduced for one entry) — it's a sanity check, not
// meaningful regression coverage.
const testUtils = await import('../dist/test-utils.js');
assert.equal(typeof testUtils.captureInterceptionSnapshot, 'function',
  'captureInterceptionSnapshot should be exported from coolhand-node/test-utils');
assert.equal(typeof testUtils.assertInterceptionOccurred, 'function',
  'assertInterceptionOccurred should be exported from coolhand-node/test-utils');
const snapshot = testUtils.captureInterceptionSnapshot();
assert.equal(snapshot.interceptedCalls, getGlobalStats().interceptedCalls,
  'captureInterceptionSnapshot should mirror getGlobalStats().interceptedCalls');

console.log(`ESM smoke test passed (${count} patterns loaded, OpenAI matched)`);
