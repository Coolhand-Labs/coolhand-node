// Config for the opt-in live suite (`npm run test:live`) — real HTTP against a real Coolhand
// server, no mocks. Kept separate from jest.config.cjs so `npm test` (and therefore CI, which has
// no server and no private key) never picks these up, without any of the tests being skipped.
const base = require('./jest.config.cjs');

module.exports = {
  ...base,
  testMatch: ['**/*.live.ts'],
  // Round trips to a containerised local server go through the host's port forwarding, which on
  // Windows adds ~15-20s per request even when the server itself answers in ~400ms. The default
  // 5s timeout would fail every one of these for environmental reasons.
  testTimeout: 300000,
  // Coverage thresholds are calibrated for the full unit suite; this suite exercises one service.
  collectCoverage: false,
};
