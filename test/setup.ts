// Jest setup file for global configuration
// This file runs before each test file

// Extend Jest matchers if needed
// import '@testing-library/jest-dom';

// Set up any global test utilities or mocks here
global.console = {
  ...console,
  // Suppress console.log in tests unless needed
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
// http/https are process-wide core modules shared by every test file in a Jest worker, unlike the
// per-file `globalThis`. A file that constructs a Coolhand leaves the real patched http.request/get
// behind, and a later file then stacks its own patch on that stale one, whose closure points at a
// torn-down environment. Restore the pristine functions after each file so each starts clean.
const nodeHttp = require('http');
const nodeHttps = require('https');
const pristineNetwork = {
  httpRequest: nodeHttp.request, httpGet: nodeHttp.get,
  httpsRequest: nodeHttps.request, httpsGet: nodeHttps.get,
  fetch: globalThis.fetch
};

afterAll(() => {
  nodeHttp.request = pristineNetwork.httpRequest;
  nodeHttp.get = pristineNetwork.httpGet;
  nodeHttps.request = pristineNetwork.httpsRequest;
  nodeHttps.get = pristineNetwork.httpsGet;
  globalThis.fetch = pristineNetwork.fetch;
});
