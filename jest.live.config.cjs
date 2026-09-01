// Config for the opt-in live suite (`npm run test:live`) — real HTTP against a real Coolhand
// server, no mocks. Kept separate from jest.config.cjs so `npm test` (and therefore CI, which has
// no server and no private key) never picks these up, without any of the tests being skipped.
const base = require('./jest.config.cjs');

module.exports = {
  ...base,
  testMatch: ['**/*.live.ts'],
  // A Rails server in development mode adds a large flat overhead to every request: measured at
  // 13-15s here even for GET /up, which does no auth and no database work, and visible inside the
  // server's own X-Runtime header rather than in transport. The default 5s timeout would fail all
  // of these for reasons that have nothing to do with the wrapper.
  testTimeout: 300000,
  // Coverage thresholds are calibrated for the full unit suite; this suite exercises one service.
  collectCoverage: false,
};
