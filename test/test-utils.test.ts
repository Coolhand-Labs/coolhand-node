import { PatternMatchingService } from '../src/services/PatternMatchingService';
import { LoggingService } from '../src/services/LoggingService';

// Isolated from test/global-monitor.test.ts: this file gets its own module registry and
// globalThis (Jest sandboxes each test file), so the module-level `__coolhand_node_v1__` state
// global-monitor.ts stores on globalThis starts fresh here and won't leak between the two files.
jest.mock('https');
jest.mock('http');
jest.mock('fs');
jest.mock('../src/services/PatternMatchingService');
jest.mock('../src/services/LoggingService');

describe('test-utils', () => {
  let mockPatternMatchingService: jest.Mocked<PatternMatchingService>;
  let mockLoggingService: jest.Mocked<LoggingService>;
  let globalMonitor: any;
  let testUtils: any;
  let underlyingHttpsRequestMock: jest.Mock;
  let underlyingHttpsGetMock: jest.Mock;
  let originalFetch: typeof globalThis.fetch;
  let underlyingFetchMock: jest.Mock;

  beforeAll(async () => {
    // patchFetch() captures globalThis.fetch at init time, so the mock must be in place first.
    originalFetch = globalThis.fetch;
    underlyingFetchMock = jest.fn().mockImplementation(async () => new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    globalThis.fetch = underlyingFetchMock;

    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    mockPatternMatchingService = {
      matchesAPIPattern: jest.fn(),
      matchesAPIPatternSync: jest.fn(),
      matchesAPIPatternFromURL: jest.fn(),
      sanitizeHeaders: jest.fn().mockImplementation((headers: any) => ({ ...headers })),
      sanitizeURL: jest.fn().mockImplementation((url: string) => url),
      getLoadedPatterns: jest.fn(),
      getLoadedPatternsSync: jest.fn(),
      getPatternsCount: jest.fn().mockResolvedValue(1),
      getPatternsCountSync: jest.fn().mockReturnValue(1)
    } as any;

    mockLoggingService = {
      logRequestToAPI: jest.fn().mockResolvedValue(null),
      getApiEndpoint: jest.fn().mockReturnValue('http://localhost:3000/api/v2/llm_request_logs')
    } as any;

    (PatternMatchingService as jest.MockedClass<typeof PatternMatchingService>).mockImplementation(() => mockPatternMatchingService);
    (LoggingService as jest.MockedClass<typeof LoggingService>).mockImplementation(() => mockLoggingService);

    jest.spyOn(Object, 'getOwnPropertyDescriptor').mockReturnValue({
      configurable: true,
      writable: true,
      enumerable: true,
      value: jest.fn()
    });
    jest.spyOn(Object, 'defineProperty').mockImplementation((obj, prop, descriptor) => {
      (obj as any)[prop] = descriptor.value;
      return obj;
    });

    underlyingHttpsRequestMock = require('https').request as jest.Mock;
    underlyingHttpsGetMock = require('https').get as jest.Mock;

    globalMonitor = await import('../src/global-monitor');
    testUtils = await import('../src/test-utils');
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    globalMonitor._resetGlobalState();
    // See global-monitor-exclude-patterns.test.ts: Object.defineProperty is mocked to just
    // reassign the property, so without restoring the pristine mock first, patchHTTPS() would
    // capture the *previous* test's already-patched wrapper as "original" and double-wrap it.
    require('https').request = underlyingHttpsRequestMock;
    require('https').get = underlyingHttpsGetMock;
    // Same reason for fetch: patchFetch() would otherwise wrap the previous test's wrapper.
    globalThis.fetch = underlyingFetchMock;
  });

  function mockHttpsResponse() {
    const { EventEmitter } = require('events');
    underlyingHttpsRequestMock.mockImplementationOnce(() => {
      const fakeReq: any = new EventEmitter();
      fakeReq.write = jest.fn();
      fakeReq.end = jest.fn();

      const fakeRes: any = new EventEmitter();
      fakeRes.statusCode = 200;
      fakeRes.headers = {};
      fakeRes.destroyed = false;
      fakeRes.destroy = jest.fn();

      queueMicrotask(() => {
        fakeReq.emit('response', fakeRes);
        fakeRes.emit('end');
      });

      return fakeReq;
    });
  }

  it('captureInterceptionSnapshot mirrors getGlobalStats().interceptedCalls, including after it changes', async () => {
    mockPatternMatchingService.matchesAPIPatternSync.mockReturnValue({
      pattern: { name: 'Test API', domains: ['api.test.com'] },
      matchType: 'domain',
      matchValue: 'api.test.com'
    } as any);
    mockHttpsResponse();

    await globalMonitor.initializeGlobalMonitoring({ apiKey: 'test-key', silent: true });

    expect(testUtils.captureInterceptionSnapshot()).toEqual({
      interceptedCalls: globalMonitor.getGlobalStats().interceptedCalls
    });

    const https = require('https');
    https.request('https://api.test.com/v1/test', jest.fn());

    expect(testUtils.captureInterceptionSnapshot()).toEqual({
      interceptedCalls: globalMonitor.getGlobalStats().interceptedCalls
    });
    expect(testUtils.captureInterceptionSnapshot().interceptedCalls).toBeGreaterThan(0);
  });

  it('assertInterceptionOccurred does not throw once a matched request is intercepted', async () => {
    mockPatternMatchingService.matchesAPIPatternSync.mockReturnValue({
      pattern: { name: 'Test API', domains: ['api.test.com'] },
      matchType: 'domain',
      matchValue: 'api.test.com'
    } as any);
    mockHttpsResponse();

    await globalMonitor.initializeGlobalMonitoring({ apiKey: 'test-key', silent: true });

    const before = testUtils.captureInterceptionSnapshot();

    const https = require('https');
    https.request('https://api.test.com/v1/test', jest.fn());

    expect(() => testUtils.assertInterceptionOccurred(before)).not.toThrow();
  });

  it('assertInterceptionOccurred throws when a request is made but does not match a pattern', async () => {
    mockPatternMatchingService.matchesAPIPatternSync.mockReturnValue(null);
    underlyingHttpsRequestMock.mockImplementationOnce(() => {
      const { EventEmitter } = require('events');
      const fakeReq: any = new EventEmitter();
      fakeReq.write = jest.fn();
      fakeReq.end = jest.fn();
      return fakeReq;
    });

    await globalMonitor.initializeGlobalMonitoring({ apiKey: 'test-key', silent: true });

    const before = testUtils.captureInterceptionSnapshot();

    const https = require('https');
    https.request('https://not-an-ai-api.example.com/v1/test', jest.fn());

    expect(() => testUtils.assertInterceptionOccurred(before)).toThrow(/did not increase/);
  });

  it('assertInterceptionOccurred does not throw once a matched fetch() call is intercepted', async () => {
    mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue({
      pattern: { name: 'Test API', domains: ['api.test.com'] },
      matchType: 'domain',
      matchValue: 'api.test.com'
    } as any);

    await globalMonitor.initializeGlobalMonitoring({ apiKey: 'test-key', silent: true });

    const before = testUtils.captureInterceptionSnapshot();

    await globalThis.fetch('https://api.test.com/v1/test', { method: 'POST', body: '{}' });

    expect(underlyingFetchMock).toHaveBeenCalledTimes(1);
    expect(() => testUtils.assertInterceptionOccurred(before)).not.toThrow();
  });

  it('assertInterceptionOccurred throws when a fetch() call does not match a pattern', async () => {
    mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue(null);

    await globalMonitor.initializeGlobalMonitoring({ apiKey: 'test-key', silent: true });

    const before = testUtils.captureInterceptionSnapshot();

    await globalThis.fetch('https://not-an-ai-api.example.com/v1/test', { method: 'POST', body: '{}' });

    expect(underlyingFetchMock).toHaveBeenCalledTimes(1);
    expect(() => testUtils.assertInterceptionOccurred(before)).toThrow(/did not increase/);
  });

  it('assertInterceptionOccurred throws when no request was made at all after the snapshot', async () => {
    await globalMonitor.initializeGlobalMonitoring({ apiKey: 'test-key', silent: true });

    const before = testUtils.captureInterceptionSnapshot();

    expect(() => testUtils.assertInterceptionOccurred(before)).toThrow(/did not increase/);
  });

  it('assertInterceptionOccurred uses a caller-supplied message when provided', () => {
    const before = testUtils.captureInterceptionSnapshot();

    expect(() => testUtils.assertInterceptionOccurred(before, 'custom failure message')).toThrow(
      'custom failure message'
    );
  });
});
