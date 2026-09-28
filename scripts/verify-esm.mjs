import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pkg from '../dist/index.js';
import { initializeGlobalMonitoring, getGlobalStats, isGlobalMonitoringActive, PatternMatchingService } from '../dist/index.js';

assert.equal(typeof pkg, 'function', 'default export should be the Coolhand class');
assert.equal(typeof initializeGlobalMonitoring, 'function', 'initializeGlobalMonitoring should be exported');
assert.equal(typeof getGlobalStats, 'function', 'getGlobalStats should be exported');
assert.equal(typeof isGlobalMonitoringActive, 'function', 'isGlobalMonitoringActive should be exported');
assert.equal(typeof PatternMatchingService, 'function', 'PatternMatchingService should be exported');

// The built-in patterns must be the packaged dist/api-patterns.json, on every Node version and
// without any filesystem lookup (regression: the base-dir lookup used eval('import.meta.url'),
// which throws in native ESM, so ESM silently got a separately maintained fallback array).
const svc = new PatternMatchingService({ silent: true });
const count = svc.getPatternsCountSync();
const packaged = JSON.parse(readFileSync(new URL('../dist/api-patterns.json', import.meta.url), 'utf-8')).patterns;
assert.ok(count > 0, `PatternMatchingService loaded ${count} patterns — expected > 0`);
assert.deepEqual(svc.getLoadedPatternsSync(), packaged,
  'default patterns loaded in ESM should equal the packaged dist/api-patterns.json');

// No module in the ESM build may reach for eval (it cannot see import.meta and throws under CSP/Edge).
const evalOffenders = [];
const scan = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { scan(full); } else if (entry.endsWith('.js') && /\beval\(/.test(readFileSync(full, 'utf-8'))) { evalOffenders.push(full); }
  }
};
scan(fileURLToPath(new URL('../dist/', import.meta.url)));
assert.deepEqual(evalOffenders, [], `ESM build should not call eval(): ${evalOffenders.join(', ')}`);

// Verify a well-known AI domain matches
const match = svc.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions');
assert.notEqual(match, null, 'Expected api.openai.com to match a pattern');
assert.equal(match.pattern.name, 'OpenAI', `Expected pattern name "OpenAI", got "${match.pattern.name}"`);

// A custom patternsFile must take effect in native ESM on every supported Node version: synchronously
// where process.getBuiltinModule exists (20.16+ / 22.3+), otherwise once loadPatterns() completes.
const dir = mkdtempSync(join(tmpdir(), 'coolhand-esm-'));
try {
  const file = join(dir, 'patterns.json');
  writeFileSync(file, JSON.stringify({ patterns: [{ name: 'Custom Host', domains: ['llm.custom-host.example'] }] }));
  const custom = new PatternMatchingService({ customPatternsFile: file, silent: true });
  if (typeof process.getBuiltinModule === 'function') {
    assert.equal(custom.getPatternsCountSync(), 1, 'custom patternsFile should replace the built-in patterns synchronously');
  }
  await custom.loadPatterns();
  assert.equal(custom.getPatternsCountSync(), 1, 'custom patternsFile should replace the built-in patterns in ESM');
  const customMatch = custom.matchesAPIPatternSync('https://llm.custom-host.example/v1/chat');
  assert.equal(customMatch?.pattern.name, 'Custom Host', 'custom patternsFile host should match in ESM');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Singleton test: initialise via auto-monitor's exported function, then assert the
// state is visible from the index entry point. Without a shared global-monitor
// module instance this cross-entry check would return false.
const autoMonitor = await import('../dist/auto-monitor.js');
await autoMonitor.initializeGlobalMonitoring({ apiKey: 'smoke-test-key', silent: true, dryRun: true });
assert.equal(isGlobalMonitoringActive(), true,
  'index entry should see active state initialised via auto-monitor (shared singleton)');

console.log(`ESM smoke test passed (${count} patterns loaded, OpenAI matched)`);
