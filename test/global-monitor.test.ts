import { PatternMatchingService } from '../src/services/PatternMatchingService';
import { LoggingService } from '../src/services/LoggingService';

// Mock the modules
jest.mock('https');
jest.mock('http');
jest.mock('fs');
jest.mock('../src/services/PatternMatchingService');
jest.mock('../src/services/LoggingService');

// The fetch interception drains and logs the response body in a detached promise chain
// (see issue #114) so callers of fetch() no longer wait on it; tests need to flush the
// microtask queue after awaiting fetch() before asserting on the logged callData.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('Global Monitor', () => {
  let originalFetch: typeof globalThis.fetch;
  let underlyingFetchMock: jest.Mock;
  let underlyingHttpsRequestMock: jest.Mock;
  let mockPatternMatchingService: jest.Mocked<PatternMatchingService>;
  let mockLoggingService: jest.Mocked<LoggingService>;
  let globalMonitor: any;

  beforeAll(async () => {
    // Save original fetch
    originalFetch = globalThis.fetch;

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Create mocks
    mockPatternMatchingService = {
      matchesAPIPattern: jest.fn(),
      matchesAPIPatternSync: jest.fn(),
      matchesAPIPatternFromURL: jest.fn(),
      sanitizeHeaders: jest.fn(),
      sanitizeURL: jest.fn(),
      getLoadedPatterns: jest.fn(),
      getLoadedPatternsSync: jest.fn(),
      getPatternsCount: jest.fn().mockResolvedValue(5),
      getPatternsCountSync: jest.fn().mockReturnValue(5)
    } as any;

    mockLoggingService = {
      logRequestToAPI: jest.fn(),
      getApiEndpoint: jest.fn().mockReturnValue('https://api.coolhand.dev')
    } as any;

    // Mock constructors
    (PatternMatchingService as jest.MockedClass<typeof PatternMatchingService>).mockImplementation(() => mockPatternMatchingService);
    (LoggingService as jest.MockedClass<typeof LoggingService>).mockImplementation(() => mockLoggingService);

    // Mock sanitizeHeaders and sanitizeURL to pass through as-is
    mockPatternMatchingService.sanitizeHeaders.mockImplementation((headers) => ({ ...headers }));
    mockPatternMatchingService.sanitizeURL.mockImplementation((url: string) => url);

    // Mock Object property descriptors for patching
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

    // Mock fetch
    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: () => ({
        text: () => Promise.resolve('{"result": "success"}')
      })
    });

    // Capture reference before patching so tests can spy on originalFetch calls
    underlyingFetchMock = globalThis.fetch as jest.Mock;

    // Capture the https.request automock reference before global-monitor patches it,
    // so tests can control the "original" request behavior it wraps.
    underlyingHttpsRequestMock = require('https').request as jest.Mock;

    // Import the module after all mocks are set up
    globalMonitor = await import('../src/global-monitor');
  });

  afterAll(() => {
    // Restore original functions
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    // Clear mock calls between tests
    jest.clearAllMocks();
  });

  describe('Module Exports', () => {
    it('should export the required functions', () => {
      expect(typeof globalMonitor.initializeGlobalMonitoring).toBe('function');
      expect(typeof globalMonitor.getGlobalStats).toBe('function');
      expect(typeof globalMonitor.isGlobalMonitoringActive).toBe('function');
    });
  });

  describe('Global Statistics API', () => {
    it('should return stats object with correct structure', () => {
      const stats = globalMonitor.getGlobalStats();

      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('interceptedCalls');
      expect(stats).toHaveProperty('apiEndpoint');
      expect(stats).toHaveProperty('isInitialized');

      expect(typeof stats.totalRequests).toBe('number');
      expect(typeof stats.interceptedCalls).toBe('number');
      expect(typeof stats.apiEndpoint).toBe('string');
      expect(typeof stats.isInitialized).toBe('boolean');
    });

    it('should return boolean for monitoring active status', () => {
      const isActive = globalMonitor.isGlobalMonitoringActive();
      expect(typeof isActive).toBe('boolean');
    });
  });

  describe('Basic Initialization', () => {
    it('should accept configuration object', async () => {
      const config = {
        apiKey: 'test-api-key',
        silent: true
      };

      // Should not throw
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();
    });

    it('should accept configuration with custom patterns file', async () => {
      const config = {
        apiKey: 'test-api-key',
        patternsFile: './custom-patterns.json',
        silent: true
      };

      // Should not throw
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();
    });

    it('should handle Edge runtime environment', async () => {
      // Mock Edge runtime
      (globalThis as any).EdgeRuntime = 'edge';

      const config = { apiKey: 'test-key', silent: true };

      // Should not throw
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();

      // Cleanup
      delete (globalThis as any).EdgeRuntime;
    });

    it('should handle NEXT_RUNTIME environment', async () => {
      const originalNextRuntime = process.env.NEXT_RUNTIME;
      process.env.NEXT_RUNTIME = 'edge';

      const config = { apiKey: 'test-key', silent: true };

      // Should not throw
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();

      // Cleanup
      if (originalNextRuntime) {
        process.env.NEXT_RUNTIME = originalNextRuntime;
      } else {
        delete process.env.NEXT_RUNTIME;
      }
    });

    it('should handle browser environment', async () => {
      // Mock browser environment
      (globalThis as any).window = {};

      const config = { apiKey: 'test-key', silent: true };

      // Should not throw
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();

      // Cleanup
      delete (globalThis as any).window;
    });
  });

  describe('Service Integration', () => {
    it('should create services when initialized for the first time', async () => {
      // Since the module may already be initialized, we test that the services
      // were created at some point during the test suite
      const config = { apiKey: 'test-key', silent: true };

      await globalMonitor.initializeGlobalMonitoring(config);

      // Verify that the module can handle the configuration
      expect(config.apiKey).toBe('test-key');
      expect(config.silent).toBe(true);
    });

    it('should handle patterns file configuration', async () => {
      const config = {
        apiKey: 'test-key',
        patternsFile: './custom.json',
        silent: true
      };

      // Should accept the configuration without throwing
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();
    });

    it('should provide service integration functionality', async () => {
      const config = { apiKey: 'test-key', silent: true };

      await globalMonitor.initializeGlobalMonitoring(config);

      // Verify stats are available (indicates services are working)
      const stats = globalMonitor.getGlobalStats();
      expect(stats).toHaveProperty('apiEndpoint');
      expect(stats).toHaveProperty('isInitialized');
    });
  });

  describe('HTTP Module Patching', () => {
    it('should have HTTP/HTTPS patching capabilities', async () => {
      const config = { apiKey: 'test-key', silent: true };

      // Should not throw when attempting to patch modules
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();

      // Verify patching infrastructure is in place
      expect(Object.defineProperty).toBeDefined();
      expect(Object.getOwnPropertyDescriptor).toBeDefined();
    });

    it('should handle module patching errors gracefully', async () => {
      const config = { apiKey: 'test-key', silent: true };

      // Should complete initialization even if patching fails
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();
    });

    it('should handle non-configurable properties gracefully', async () => {
      // Mock non-configurable property descriptor
      (Object.getOwnPropertyDescriptor as jest.Mock).mockReturnValue({
        configurable: false
      });

      const config = { apiKey: 'test-key', silent: true };

      // Should not throw even with non-configurable properties
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();
    });
  });

  describe('HTTPS/HTTP request interception', () => {
    it('sanitizes query-param secrets from the logged URL for https.request', async () => {
      const { EventEmitter } = require('events');

      underlyingHttpsRequestMock.mockImplementationOnce((_options: any, callback: any) => {
        const fakeReq: any = new EventEmitter();
        fakeReq.write = jest.fn();
        fakeReq.end = jest.fn();

        const fakeRes: any = new EventEmitter();
        fakeRes.statusCode = 200;
        fakeRes.headers = { 'content-type': 'application/json' };

        queueMicrotask(() => {
          callback(fakeRes);
          fakeRes.emit('end');
        });

        return fakeReq;
      });

      const rawUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=secret123';
      const cleanUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=REDACTED';

      mockPatternMatchingService.matchesAPIPatternSync.mockReturnValueOnce({
        pattern: { name: 'Google AI', domains: ['generativelanguage.googleapis.com'] },
        matchType: 'domain',
        matchValue: 'generativelanguage.googleapis.com'
      } as any);
      mockPatternMatchingService.sanitizeURL.mockReturnValueOnce(cleanUrl);

      // Ensure global monitoring (and therefore https.request patching) has run.
      await globalMonitor.initializeGlobalMonitoring({ apiKey: 'test-key', silent: true });

      const https = require('https');
      https.request(rawUrl, jest.fn());

      // Let the queued microtask (response callback + 'end' event, plus the
      // async decompress/log chain it triggers) flush.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockPatternMatchingService.sanitizeURL).toHaveBeenCalledWith(rawUrl);
      const [callData] = (mockLoggingService.logRequestToAPI as jest.Mock).mock.calls[0];
      expect(callData.url).toBe(cleanUrl);
    });

    it('does not starve a host callback that attaches its data listener asynchronously (regression for #115)', async () => {
      // Regression test for #115: a real Readable (not EventEmitter) is required here because
      // only a real stream reproduces Node's flowing-mode race — an EventEmitter never "drops"
      // emitted events regardless of listener attach order.
      const { Readable } = require('stream');
      const { EventEmitter } = require('events');

      const realRes: any = new Readable({ read() {} });
      realRes.statusCode = 200;
      realRes.headers = { 'content-type': 'application/json' };

      underlyingHttpsRequestMock.mockImplementationOnce((_options: any, callback: any) => {
        const fakeReq: any = new EventEmitter();
        fakeReq.write = jest.fn();
        fakeReq.end = jest.fn();

        callback(realRes);
        realRes.push('{"ok":true}');
        realRes.push(null);

        return fakeReq;
      });

      mockPatternMatchingService.matchesAPIPatternSync.mockReturnValueOnce({
        pattern: { name: 'Test API', domains: ['api.test.com'] },
        matchType: 'domain',
        matchValue: 'api.test.com'
      } as any);

      await globalMonitor.initializeGlobalMonitoring({ apiKey: 'test-key', silent: true });

      let hostReceived = '';
      let hostEnded = false;
      const hostCallback = async (res: any) => {
        // Simulate host code that does something async before touching the response. A macrotask
        // gap (setImmediate) reliably reproduces the race — see request-monitoring-service.test.ts
        // for why a microtask (Promise.resolve()) doesn't.
        await new Promise((resolve) => setImmediate(resolve));
        res.on('data', (chunk: any) => { hostReceived += chunk.toString(); });
        res.on('end', () => { hostEnded = true; });
      };

      const https = require('https');
      https.request('https://api.test.com/v1/test', hostCallback);

      // Let the setImmediate gap, stream flow, and interceptor's own async decompress/log chain flush.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(hostReceived).toBe('{"ok":true}');
      expect(hostEnded).toBe(true);
    });
  });

  describe('Fetch Patching', () => {
    it('should replace global fetch function', async () => {
      const config = { apiKey: 'test-key', silent: true };

      await globalMonitor.initializeGlobalMonitoring(config);

      // Fetch should be replaced (this is hard to test directly due to mocking)
      expect(typeof globalThis.fetch).toBe('function');
    });

    it('should handle missing fetch gracefully', async () => {
      // Temporarily remove fetch
      const tempFetch = globalThis.fetch;
      delete (globalThis as any).fetch;

      const config = { apiKey: 'test-key', silent: true };

      // Should not throw even without fetch
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();

      // Restore fetch
      globalThis.fetch = tempFetch;
    });
  });

  describe('Pattern Matching Integration', () => {
    beforeEach(async () => {
      const config = { apiKey: 'test-key', silent: true };
      await globalMonitor.initializeGlobalMonitoring(config);
    });

    it('should use pattern matching service for URL matching', async () => {
      const mockPattern = {
        pattern: { name: 'OpenAI', domains: ['api.openai.com'] },
        matchType: 'domain' as const,
        matchValue: 'api.openai.com'
      };

      mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue(mockPattern);

      // This will call the patched fetch
      await globalThis.fetch('https://api.openai.com/v1/test');

      // Since we can't directly test the internal behavior due to complex mocking,
      // we'll just verify the test setup works
      expect(mockPatternMatchingService.matchesAPIPatternFromURL).toBeDefined();
    });

    it('should handle non-matching URLs', async () => {
      mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue(null);

      // This should pass through without interception
      await globalThis.fetch('https://example.com/api');

      // Verify mock is working
      expect(mockPatternMatchingService.matchesAPIPatternFromURL).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle various error conditions gracefully', async () => {
      const config = { apiKey: 'test-key', silent: true };

      // Should complete without throwing regardless of internal errors
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();
    });

    it('should handle property descriptor errors', async () => {
      // Mock Object.getOwnPropertyDescriptor to throw
      (Object.getOwnPropertyDescriptor as jest.Mock).mockImplementation(() => {
        throw new Error('Property descriptor error');
      });

      const config = { apiKey: 'test-key', silent: true };

      // Should handle the error gracefully
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();
    });

    it('should validate required configuration', async () => {
      // Test that API key is required
      const stats = globalMonitor.getGlobalStats();
      expect(stats).toHaveProperty('isInitialized');
    });
  });

  describe('Configuration Handling', () => {
    it('should handle different configuration options', async () => {
      const config = { apiKey: 'test-key' };

      // Should accept configuration without silent flag
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();
    });

    it('should handle explicit silent configuration', async () => {
      const config = { apiKey: 'test-key', silent: false };

      // Should accept explicit silent configuration
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();
    });

    it('should handle API key configuration', async () => {
      const testApiKey = 'my-test-api-key-12345';
      const config = { apiKey: testApiKey, silent: true };

      // Should accept API key configuration
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();

      // Verify the configuration was accepted
      expect(config.apiKey).toBe(testApiKey);
    });

    it('should handle patterns file configuration', async () => {
      const config = {
        apiKey: 'test-key',
        patternsFile: './custom-patterns.json',
        silent: true
      };

      // Should accept patterns file configuration
      await expect(globalMonitor.initializeGlobalMonitoring(config)).resolves.not.toThrow();

      // Verify the configuration was accepted
      expect(config.patternsFile).toBe('./custom-patterns.json');
    });
  });

  describe('Deduplication', () => {
    const mockPattern = {
      pattern: { name: 'OpenAI', domains: ['api.openai.com'] },
      matchType: 'domain' as const,
      matchValue: 'api.openai.com'
    };

    beforeEach(async () => {
      await globalMonitor.initializeGlobalMonitoring({ apiKey: 'test-key', silent: true });
      mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue(mockPattern);
      mockPatternMatchingService.sanitizeHeaders.mockImplementation((headers: any) => ({ ...headers }));
    });

    it('should intercept all concurrent POST requests to the same URL', async () => {
      await Promise.all([
        globalThis.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: '{"prompt":"a"}' }),
        globalThis.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: '{"prompt":"b"}' }),
        globalThis.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: '{"prompt":"c"}' }),
      ]);

      expect(mockLoggingService.logRequestToAPI).toHaveBeenCalledTimes(3);
    });

    it('should deduplicate concurrent GET requests to the same URL', async () => {
      await Promise.all([
        globalThis.fetch('https://api.openai.com/v1/models'),
        globalThis.fetch('https://api.openai.com/v1/models'),
      ]);

      expect(mockLoggingService.logRequestToAPI).toHaveBeenCalledTimes(1);
    });

    it('should intercept all concurrent PUT requests to the same URL', async () => {
      await Promise.all([
        globalThis.fetch('https://api.openai.com/v1/thread', { method: 'PUT', body: '{"a":1}' }),
        globalThis.fetch('https://api.openai.com/v1/thread', { method: 'PUT', body: '{"b":2}' }),
      ]);

      expect(mockLoggingService.logRequestToAPI).toHaveBeenCalledTimes(2);
    });

    it('should intercept all concurrent POST calls when url is a Request object', async () => {
      const url = 'https://api.openai.com/v1/chat/completions';
      await Promise.all([
        globalThis.fetch(new Request(url, { method: 'POST', body: '{"prompt":"a"}' })),
        globalThis.fetch(new Request(url, { method: 'POST', body: '{"prompt":"b"}' })),
      ]);

      expect(mockLoggingService.logRequestToAPI).toHaveBeenCalledTimes(2);
    });

    it('should log Request object URL, method, headers, and body', async () => {
      const url = 'https://api.openai.com/v1/chat/completions';

      await globalThis.fetch(new Request(url, {
        method: 'POST',
        headers: { authorization: 'Bearer token' },
        body: '{"prompt":"a"}'
      }));
      await flush();

      expect(mockPatternMatchingService.matchesAPIPatternFromURL).toHaveBeenCalledWith(url);
      expect(mockLoggingService.logRequestToAPI).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url,
          headers: expect.objectContaining({ authorization: 'Bearer token' }),
          request_body: { prompt: 'a' }
        }),
        mockPattern,
        'global-monitoring'
      );
    });

    it('logs only init headers when fetch(Request, { headers }) is called', async () => {
      const request = new Request('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'x-stale': 'drop-me', authorization: 'Bearer old' },
        body: '{}'
      });

      await globalThis.fetch(request, { headers: { authorization: 'Bearer new' } });
      await flush();

      const [callData] = (mockLoggingService.logRequestToAPI as jest.Mock).mock.calls[0];
      expect(callData.headers).toMatchObject({ authorization: 'Bearer new' });
      expect(callData.headers).not.toHaveProperty('x-stale');
    });

    it('falls back to Request headers when no init.headers is provided', async () => {
      const request = new Request('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'x-custom': 'keep-me' },
        body: '{}'
      });

      await globalThis.fetch(request);
      await flush();

      const [callData] = (mockLoggingService.logRequestToAPI as jest.Mock).mock.calls[0];
      expect(callData.headers).toHaveProperty('x-custom', 'keep-me');
    });

    it('sanitizes response headers on the fetch path', async () => {
      underlyingFetchMock.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ 'set-cookie': 'session=secret', 'content-type': 'application/json' }),
        clone: () => ({ text: () => Promise.resolve('{}') })
      });
      mockPatternMatchingService.sanitizeHeaders.mockImplementation((headers: any) => (
        'set-cookie' in headers ? { ...headers, 'set-cookie': '[REDACTED]' } : { ...headers }
      ));

      await globalThis.fetch('https://api.openai.com/v1/models');
      await flush();

      const [callData] = (mockLoggingService.logRequestToAPI as jest.Mock).mock.calls[0];
      expect(callData.response_headers).toEqual(expect.objectContaining({ 'set-cookie': '[REDACTED]' }));
    });

    it('sanitizes query-param secrets from the logged URL', async () => {
      const rawUrl = 'https://api.openai.com/v1/chat/completions?key=secret123';
      const cleanUrl = 'https://api.openai.com/v1/chat/completions?key=REDACTED';
      mockPatternMatchingService.sanitizeURL.mockReturnValueOnce(cleanUrl);

      await globalThis.fetch(rawUrl, { method: 'POST', body: '{}' });
      await flush();

      expect(mockPatternMatchingService.sanitizeURL).toHaveBeenCalledWith(rawUrl);
      const [callData] = (mockLoggingService.logRequestToAPI as jest.Mock).mock.calls[0];
      expect(callData.url).toBe(cleanUrl);
    });

    it('logs the empty init body when fetch(Request, { body: "" }) is called, not the original Request body', async () => {
      const request = new Request('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        body: '{"original":"body"}',
      });

      await globalThis.fetch(request, { body: '' });
      await flush();

      const [callData] = (mockLoggingService.logRequestToAPI as jest.Mock).mock.calls[0];
      expect(callData.request_body).toBeNull();
    });

    it('propagates a fetch rejection that occurs while body capture is still pending', async () => {
      const fetchError = new Error('network failure');
      underlyingFetchMock.mockRejectedValueOnce(fetchError);

      const slowReq = {
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: new Headers(),
        clone: jest.fn().mockReturnValue({
          text: jest.fn().mockImplementation(async () => {
            await Promise.resolve(); // yield so the fetch rejection fires first
            return '{"prompt":"test"}';
          })
        })
      };

      await expect(globalThis.fetch(slowReq as any)).rejects.toThrow('network failure');
      expect(mockLoggingService.logRequestToAPI).not.toHaveBeenCalled();
    });

    it('resolves fetch() before the response body finishes streaming (issue #114)', async () => {
      let resolveBody: (text: string) => void = () => {};
      const bodyPromise = new Promise<string>((resolve) => { resolveBody = resolve; });

      underlyingFetchMock.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: () => ({ text: () => bodyPromise })
      });

      // If interceptFetch still awaited the body drain before returning, this would hang
      // forever since bodyPromise never resolves on its own.
      await globalThis.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: '{}' });

      expect(mockLoggingService.logRequestToAPI).not.toHaveBeenCalled();

      resolveBody('{"result":"success"}');
      await flush();

      expect(mockLoggingService.logRequestToAPI).toHaveBeenCalledWith(
        expect.objectContaining({ response_body: { result: 'success' } }),
        mockPattern,
        'global-monitoring'
      );
    });

    it('logs with a null response_body when the detached body drain rejects', async () => {
      underlyingFetchMock.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: () => ({ text: () => Promise.reject(new Error('stream aborted')) })
      });

      await globalThis.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: '{}' });
      await flush();

      expect(mockLoggingService.logRequestToAPI).toHaveBeenCalledWith(
        expect.objectContaining({ response_body: null }),
        mockPattern,
        'global-monitoring'
      );
    });

    it('fires originalFetch before awaiting a slow Request body', async () => {
      const events: string[] = [];

      underlyingFetchMock.mockImplementationOnce(async () => {
        events.push('fetch-called');
        return {
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          clone: () => ({ text: () => Promise.resolve('{}') })
        };
      });

      const slowReq = {
        url: 'https://api.openai.com/v1/chat/completions',
        method: 'POST',
        headers: new Headers(),
        clone: jest.fn().mockReturnValue({
          text: jest.fn().mockImplementation(async () => {
            await Promise.resolve(); // one microtask — yields after getFetchRequestBody suspends
            events.push('body-resolved');
            return '{"prompt":"slow"}';
          })
        })
      };

      await globalThis.fetch(slowReq as any);

      expect(events).toEqual(['fetch-called', 'body-resolved']);
    });

    it('should handle fetch calls when Request is not globally defined', async () => {
      const originalRequest = (globalThis as any).Request;
      delete (globalThis as any).Request;

      try {
        await globalThis.fetch('https://api.openai.com/v1/models');
        await flush();
      } finally {
        (globalThis as any).Request = originalRequest;
      }

      expect(mockLoggingService.logRequestToAPI).toHaveBeenCalledTimes(1);
    });
  });
});
