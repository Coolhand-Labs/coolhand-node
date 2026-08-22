import * as zlib from 'zlib';
import { RequestMonitoringService } from '../src/services/RequestMonitoringService';
import { MAX_DECOMPRESSED_BYTES } from '../src/utils/decompress';
import { PatternMatchingService } from '../src/services/PatternMatchingService';
import { CoolhandMatchedPattern, CoolhandAPIPattern } from '../src/types';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

// https/http are no longer statically imported by RequestMonitoringService (see issue #161)
// — it loads them via createRequire, which bypasses jest.mock() entirely and returns Node's
// real module objects. jest.mock('https')/jest.mock('http') would have no effect here.
jest.mock('fs');

// Because the source now patches the REAL https/http module objects instead of a jest.mock()
// stand-in, every test that calls setupMonitoring() overwrites the process-wide request/get
// functions. Capture pristine references once at import time — before any test has a chance
// to patch them — and restore them after every test so patching doesn't leak across tests (or
// across other test files sharing this Jest worker). This must use require(), not `import * as
// https`: this test file is transpiled to ESM (see jest.config.js's ts-jest ESM preset), and an
// ESM namespace object's properties are always non-configurable, which would make the
// Object.defineProperty restore below throw — the same non-configurability issue the source fix
// works around via createRequire.
const nodeHttps = require('https');
const nodeHttp = require('http');

const originalHttpsRequest = nodeHttps.request;
const originalHttpsGet = nodeHttps.get;
const originalHttpRequest = nodeHttp.request;
const originalHttpGet = nodeHttp.get;

const restoreHttpModules = () => {
  Object.defineProperty(nodeHttps, 'request', { value: originalHttpsRequest, writable: true, configurable: true });
  Object.defineProperty(nodeHttps, 'get', { value: originalHttpsGet, writable: true, configurable: true });
  Object.defineProperty(nodeHttp, 'request', { value: originalHttpRequest, writable: true, configurable: true });
  Object.defineProperty(nodeHttp, 'get', { value: originalHttpGet, writable: true, configurable: true });
};

// The fetch interception drains and logs the response body in a detached promise chain
// (see issue #114) so callers of fetch() no longer wait on it; tests need to flush the
// microtask queue after awaiting fetch() before asserting on onRequestComplete.
const flush = () => new Promise((resolve) => setImmediate(resolve));

// A single flush() tick is enough to drain a small mocked body, but a many-chunk stream
// (e.g. the MAX_DECOMPRESSED_BYTES truncation tests) can take more scheduler ticks to fully
// drain on some Node versions' stream implementations than on others — poll instead of
// asserting after exactly one tick.
async function waitForMockCall(mockFn: jest.Mock, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (mockFn.mock.calls.length === 0) {
    if (Date.now() - start > timeoutMs) { return; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('RequestMonitoringService', () => {
  let service: RequestMonitoringService;
  let mockPatternMatchingService: jest.Mocked<PatternMatchingService>;
  let onRequestCompleteMock: jest.Mock;

  // Mock pattern for testing
  const mockPattern: CoolhandAPIPattern = {
    name: 'TestAPI',
    domains: ['api.test.com'],
    paths: ['/v1/test'],
    headers: {
      'authorization': '[REDACTED]'
    }
  };

  const mockMatchedPattern: CoolhandMatchedPattern = {
    pattern: mockPattern,
    matchType: 'domain',
    matchValue: 'api.test.com'
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console methods
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Create mock pattern matching service
    mockPatternMatchingService = {
      matchesAPIPattern: jest.fn(),
      matchesAPIPatternFromURL: jest.fn(),
      sanitizeHeaders: jest.fn(),
      sanitizeURL: jest.fn(),
      getLoadedPatterns: jest.fn(),
      getPatternsCount: jest.fn(),
      loadAPIPatterns: jest.fn()
    } as any;

    // Mock sanitizeHeaders to return the same headers for simplicity
    mockPatternMatchingService.sanitizeHeaders.mockImplementation((headers) => ({ ...headers }));
    // Mock sanitizeURL to return the URL unchanged
    mockPatternMatchingService.sanitizeURL.mockImplementation((url: string) => url);

    // Create service instance
    service = new RequestMonitoringService(mockPatternMatchingService, true); // silent mode

    // Mock the callback
    onRequestCompleteMock = jest.fn();
    service.onRequestComplete = onRequestCompleteMock;

    // Reset the static activeOwner
    (RequestMonitoringService as any).activeOwner = null;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    restoreHttpModules();
  });

  describe('Constructor and Setup', () => {
    it('should initialize with correct dependencies', () => {
      expect(service).toBeInstanceOf(RequestMonitoringService);
      expect(service.getStats()).toEqual({
        totalRequests: 0,
        interceptedCalls: 0
      });
    });

    it('should setup monitoring only once', () => {
      const setupSpy = jest.spyOn(service as any, 'patchHTTPS');
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      service.setupMonitoring();
      service.setupMonitoring();

      expect(setupSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should log monitoring setup in non-silent mode', () => {
      const nonSilentService = new RequestMonitoringService(mockPatternMatchingService, false);
      (RequestMonitoringService as any).activeOwner = null;

      nonSilentService.setupMonitoring();

      expect(console.log).toHaveBeenCalledWith('📡 Monitoring all outbound requests...');
    });

    describe('multi-instance ownership warning', () => {
      it('warns and does not patch again when a second instance calls setupMonitoring() while another instance owns interception', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
        const secondService = new RequestMonitoringService(mockPatternMatchingService, true);
        const patchHTTPSSpy = jest.spyOn(secondService as any, 'patchHTTPS');

        service.setupMonitoring(); // becomes the owner
        secondService.setupMonitoring(); // should not patch again, should warn

        expect(patchHTTPSSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Another Coolhand instance already owns'));
        expect((RequestMonitoringService as any).activeOwner).toBe(service);
      });

      it('does not warn when the owning instance calls setupMonitoring() again', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        service.setupMonitoring();
        service.setupMonitoring();

        expect(warnSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('HTTPS Patching', () => {
    beforeEach(() => {

      // Mock Object.getOwnPropertyDescriptor to return configurable properties
      jest.spyOn(Object, 'getOwnPropertyDescriptor').mockReturnValue({
        configurable: true,
        writable: true,
        enumerable: true,
        value: jest.fn()
      });

      // Mock Object.defineProperty
      jest.spyOn(Object, 'defineProperty').mockImplementation((obj, prop, descriptor) => {
        (obj as any)[prop] = descriptor.value;
        return obj;
      });
    });

    it('should patch https.request successfully', () => {
      service.setupMonitoring();

      // https/http are now loaded via createRequire (see issue #161), which returns
      // Node's real module objects rather than this file's jest.mock('https') stand-in
      // — so the target object can no longer be asserted by reference, only shape.
      expect(Object.defineProperty).toHaveBeenCalledWith(
        expect.anything(),
        'request',
        expect.objectContaining({
          value: expect.any(Function),
          writable: true,
          configurable: true
        })
      );
    });

    it('should intercept matching HTTPS requests', () => {
      mockPatternMatchingService.matchesAPIPattern.mockResolvedValue(mockMatchedPattern);

      service.setupMonitoring();

      // Test that the patching happened
      expect(Object.defineProperty).toHaveBeenCalledWith(
        expect.anything(),
        'request',
        expect.objectContaining({
          value: expect.any(Function)
        })
      );
    });

    it('should not intercept non-matching requests', () => {
      mockPatternMatchingService.matchesAPIPattern.mockResolvedValue(null);

      service.setupMonitoring();

      // Just test that the setup completed without errors
      expect(service.getStats().interceptedCalls).toBe(0);
    });

    it('should handle https.get patching', () => {
      service.setupMonitoring();

      expect(Object.defineProperty).toHaveBeenCalledWith(
        expect.anything(),
        'get',
        expect.objectContaining({
          value: expect.any(Function),
          writable: true,
          configurable: true
        })
      );
    });

    it('completes an intercepted https.get() call without the caller needing to call req.end() (regression)', () => {
      // Regression test: the https.get() patch used to hand interceptRequest() the
      // `https.request` reference instead of `https.get`. interceptRequest() never calls
      // req.end() itself (callers of .request() are expected to end the request themselves),
      // but callers of .get() never call .end() either — that's .get()'s whole contract, since
      // the real https.get() ends the request for you. Passing the wrong original meant every
      // intercepted https.get() call to a matched API pattern hung forever.
      const mockReq = new EventEmitter() as any;
      mockReq.write = jest.fn();
      // Captured separately from mockReq.end: interceptRequest() overwrites the
      // req.end property with its own wrapper once it gets a hold of the request
      // object, so asserting on mockReq.end after the fact would inspect that
      // wrapper instead of the original — capture the original mock fn up front.
      const mockEndFn = jest.fn();
      mockReq.end = mockEndFn;

      // Stand in for the real https.request/https.get pair: mimic Node's actual
      // https.get(), which delegates to https.request() and then calls req.end().
      nodeHttps.request = jest.fn().mockReturnValue(mockReq);
      nodeHttps.get = jest.fn((options: any, callback?: any) => {
        const req = nodeHttps.request(options, callback);
        req.end();
        return req;
      });

      (mockPatternMatchingService as any).matchesAPIPatternSync = jest.fn().mockReturnValue(mockMatchedPattern);

      service.setupMonitoring();

      nodeHttps.get({ hostname: 'api.test.com', path: '/v1/test' }, jest.fn());

      expect(mockEndFn).toHaveBeenCalled();
    });

    it('should handle patching errors gracefully', () => {
      Object.getOwnPropertyDescriptor = jest.fn().mockReturnValue({
        configurable: false
      });

      expect(() => service.setupMonitoring()).not.toThrow();
    });
  });

  describe('HTTP Patching', () => {
    it('should patch http.request and http.get', () => {
      // Just test that setup completes without error
      expect(() => service.setupMonitoring()).not.toThrow();
    });
  });

  // Regression tests for issue #161: the four patch guards previously had no `else`
  // branch at all, so a non-configurable property (e.g. from a bundler-wrapped or
  // ESM-namespace https/http module) failed silently, with zero indication anywhere
  // that HTTP/HTTPS interception was never actually applied.
  describe('Non-configurable property warnings (issue #161)', () => {
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    it('warns for https.request, https.get, http.request, and http.get when non-configurable', () => {
      jest.spyOn(Object, 'getOwnPropertyDescriptor').mockReturnValue({
        configurable: false,
        writable: false,
        enumerable: true,
        value: jest.fn()
      });

      service.setupMonitoring();

      const warnCalls = consoleWarnSpy.mock.calls.map((c) => c[0]);
      const patchWarnings = warnCalls.filter(
        (msg): msg is string => typeof msg === 'string' && msg.includes('non-configurable')
      );
      expect(patchWarnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('https.request'),
          expect.stringContaining('https.get'),
          expect.stringContaining('http.request'),
          expect.stringContaining('http.get')
        ])
      );
      expect(patchWarnings).toHaveLength(4);
    });

    it('does not warn about non-configurable properties when they are configurable', () => {
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

      service.setupMonitoring();

      const warnCalls = consoleWarnSpy.mock.calls.map((c) => c[0]);
      const patchWarnings = warnCalls.filter(
        (msg): msg is string => typeof msg === 'string' && msg.includes('non-configurable')
      );
      expect(patchWarnings).toHaveLength(0);
    });

    it('falls back to fetch-only and warns when createRequire is unavailable (native ESM)', async () => {
      jest.resetModules();
      jest.doMock('module', () => ({ createRequire: undefined }));

      try {
        const { RequestMonitoringService: FreshRequestMonitoringService } =
          await import('../src/services/RequestMonitoringService');
        const freshService = new FreshRequestMonitoringService(mockPatternMatchingService, true);
        const patchHTTPSSpy = jest.spyOn(freshService as any, 'patchHTTPS');
        const patchFetchSpy = jest.spyOn(freshService as any, 'patchFetch');

        freshService.setupMonitoring();

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('HTTP modules not available')
        );
        expect(patchHTTPSSpy).not.toHaveBeenCalled();
        expect(patchFetchSpy).toHaveBeenCalled();
      } finally {
        jest.dontMock('module');
        jest.resetModules();
      }
    });
  });

  describe('Fetch Patching', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should patch fetch when available', () => {
      const mockFetch = jest.fn();
      globalThis.fetch = mockFetch;

      service.setupMonitoring();

      expect(globalThis.fetch).not.toBe(mockFetch);
    });

    it('should not patch fetch when not available', () => {
      delete (globalThis as any).fetch;

      expect(() => service.setupMonitoring()).not.toThrow();
    });

    it('should intercept matching fetch requests', async () => {
      const mockResponse = {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: jest.fn().mockReturnValue({
          text: jest.fn().mockResolvedValue('{"result": "success"}')
        })
      };

      const originalFetch = jest.fn().mockResolvedValue(mockResponse);
      globalThis.fetch = originalFetch;

      mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue(mockMatchedPattern);

      service.setupMonitoring();

      const url = 'https://api.test.com/v1/test';
      const options = { method: 'POST', body: '{"test": true}' };

      await globalThis.fetch(url, options);
      await flush();

      expect(mockPatternMatchingService.matchesAPIPatternFromURL).toHaveBeenCalledWith(url);
      expect(onRequestCompleteMock).toHaveBeenCalled();
    });

    it('should sanitize response headers on the fetch path', async () => {
      const mockResponse = {
        status: 200,
        headers: new Headers({ 'set-cookie': 'session=secret', 'content-type': 'application/json' }),
        clone: jest.fn().mockReturnValue({
          text: jest.fn().mockResolvedValue('{"result": "success"}')
        })
      };

      const originalFetch = jest.fn().mockResolvedValue(mockResponse);
      globalThis.fetch = originalFetch;

      mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue(mockMatchedPattern);
      mockPatternMatchingService.sanitizeHeaders.mockImplementation((headers: any) => (
        'set-cookie' in headers ? { ...headers, 'set-cookie': '[REDACTED]' } : { ...headers }
      ));

      service.setupMonitoring();

      await globalThis.fetch('https://api.test.com/v1/test', { method: 'GET' });
      await flush();

      const [callData] = onRequestCompleteMock.mock.calls[0];
      expect(callData.response_headers).toEqual(expect.objectContaining({ 'set-cookie': '[REDACTED]' }));
    });

    it('resolves fetch() before the response body finishes streaming (issue #114)', async () => {
      let resolveBody: (text: string) => void = () => {};
      const bodyPromise = new Promise<string>((resolve) => { resolveBody = resolve; });

      const mockResponse = {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: jest.fn().mockReturnValue({
          text: jest.fn().mockReturnValue(bodyPromise)
        })
      };

      const originalFetch = jest.fn().mockResolvedValue(mockResponse);
      globalThis.fetch = originalFetch;

      mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue(mockMatchedPattern);

      service.setupMonitoring();

      // If interceptFetch still awaited the body drain before returning, this would hang
      // forever since bodyPromise never resolves on its own.
      await globalThis.fetch('https://api.test.com/v1/test', { method: 'POST', body: '{"test": true}' });

      expect(onRequestCompleteMock).not.toHaveBeenCalled();

      resolveBody('{"result": "success"}');
      await flush();

      expect(onRequestCompleteMock).toHaveBeenCalledWith(
        expect.objectContaining({ response_body: { result: 'success' } }),
        mockMatchedPattern
      );
    });

    it('logs with a null response_body when the detached body drain rejects', async () => {
      const mockResponse = {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: jest.fn().mockReturnValue({
          text: jest.fn().mockReturnValue(Promise.reject(new Error('stream aborted')))
        })
      };

      const originalFetch = jest.fn().mockResolvedValue(mockResponse);
      globalThis.fetch = originalFetch;

      mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue(mockMatchedPattern);

      service.setupMonitoring();

      await globalThis.fetch('https://api.test.com/v1/test', { method: 'POST', body: '{"test": true}' });
      await flush();

      expect(onRequestCompleteMock).toHaveBeenCalledWith(
        expect.objectContaining({ response_body: null }),
        mockMatchedPattern
      );
    });

    it('should handle fetch errors', async () => {
      const error = new Error('Network error');
      const originalFetch = jest.fn().mockRejectedValue(error);
      globalThis.fetch = originalFetch;

      mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue(mockMatchedPattern);

      service.setupMonitoring();

      await expect(globalThis.fetch('https://api.test.com/test')).rejects.toThrow('Network error');
    });

    it('should truncate the fetch response body once it exceeds MAX_DECOMPRESSED_BYTES (issue #171)', async () => {
      // Uses a real Response/ReadableStream (unlike the other fetch tests' plain-object clone()
      // mocks) so the capped-reader path in readCappedResponseText is actually exercised instead
      // of falling back to response.text().
      const chunkSize = 1024 * 1024; // 1 MB
      const chunkCount = Math.ceil(MAX_DECOMPRESSED_BYTES / chunkSize) + 2;
      let sent = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (sent++ < chunkCount) {
            controller.enqueue(new Uint8Array(chunkSize).fill(97));
          } else {
            controller.close();
          }
        }
      });

      const originalFetch = jest.fn().mockResolvedValue(
        new Response(stream, { status: 200, headers: { 'content-type': 'text/plain' } })
      );
      globalThis.fetch = originalFetch;

      mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue(mockMatchedPattern);

      service.setupMonitoring();

      await globalThis.fetch('https://api.test.com/v1/test');
      await waitForMockCall(onRequestCompleteMock);

      expect(onRequestCompleteMock).toHaveBeenCalled();
      const [callData] = onRequestCompleteMock.mock.calls[0];
      expect(typeof callData.response_body).toBe('string');
      expect((callData.response_body as string).length).toBeLessThanOrEqual(MAX_DECOMPRESSED_BYTES);
    }, 20000);
  });

  describe('Request Interception', () => {
    let mockReq: any;
    let mockRes: any;

    beforeEach(() => {
      mockReq = new EventEmitter();
      mockReq.write = jest.fn().mockReturnValue(true);
      mockReq.end = jest.fn();

      mockRes = new EventEmitter();
      mockRes.statusCode = 200;
      mockRes.headers = { 'content-type': 'application/json' };
      // A real http.IncomingMessage always has .destroy() (inherited from stream.Readable) —
      // the tee's 'close' handler relies on it to tear down `res` once the tee closes.
      mockRes.destroyed = false;
      mockRes.destroy = jest.fn();
    });

    it('should create CallData for intercepted requests', () => {
      const originalRequest = jest.fn().mockReturnValue(mockReq);

      const options = {
        hostname: 'api.test.com',
        path: '/v1/test',
        method: 'POST',
        headers: { 'authorization': 'Bearer token' }
      };

      const result = (service as any).interceptRequest(
        originalRequest,
        options,
        jest.fn(),
        'https',
        mockMatchedPattern
      );

      expect(result).toBe(mockReq);
      expect(service.getStats().interceptedCalls).toBe(1);
    });

    it('should handle request body collection', () => {
      const mockReq = new EventEmitter() as any;
      mockReq.write = jest.fn().mockReturnValue(true);
      mockReq.end = jest.fn();

      const originalRequest = jest.fn().mockReturnValue(mockReq);

      const options = { hostname: 'api.test.com', path: '/test' };

      const result = (service as any).interceptRequest(
        originalRequest,
        options,
        jest.fn(),
        'https',
        mockMatchedPattern
      );

      // Just verify the intercept function was called and returned a request object
      expect(result).toBeDefined();
      expect(service.getStats().interceptedCalls).toBe(1);
    });

    it('should handle response collection', (done) => {
      const originalRequest = jest.fn().mockImplementation(() => {
        setTimeout(() => mockReq.emit('response', mockRes), 0);
        return mockReq;
      });

      const options = { hostname: 'api.test.com', path: '/test' };

      (service as any).interceptRequest(
        originalRequest,
        options,
        jest.fn(),
        'https',
        mockMatchedPattern
      );

      // Simulate response data
      setTimeout(() => {
        mockRes.emit('data', '{"result":');
        mockRes.emit('data', ' "success"}');
        mockRes.emit('end');

        setTimeout(() => {
          expect(onRequestCompleteMock).toHaveBeenCalledWith(
            expect.objectContaining({
              id: 1,
              method: 'GET',
              url: 'https://api.test.com/test',
              status_code: 200,
              response_body: { result: 'success' }
            }),
            mockMatchedPattern
          );
          done();
        }, 10);
      }, 10);
    });

    it('should not starve a host callback that attaches its data listener asynchronously', (done) => {
      // Regression test for #115: a real Readable (not EventEmitter) is required here because
      // only a real stream reproduces Node's flowing-mode race — an EventEmitter never "drops"
      // emitted events regardless of listener attach order, so it can't reproduce this bug.
      const realRes = new Readable({ read() {} }) as any;
      realRes.statusCode = 200;
      realRes.headers = { 'content-type': 'application/json' };

      const originalRequest = jest.fn().mockImplementation(() => {
        // Deferred (not synchronous): patchResponseEmit only wraps `req.emit` after
        // originalRequest(options) returns, matching real Node — a response can never arrive
        // synchronously inside .request() itself.
        setImmediate(() => {
          mockReq.emit('response', realRes);
          realRes.push('{"ok":true}');
          realRes.push(null);
        });
        return mockReq;
      });

      const options = { hostname: 'api.test.com', path: '/test' };

      let hostReceived = '';
      const hostCallback = async (res: any) => {
        try {
          // Simulate host code that does something async (e.g. an awaited DB call) before
          // touching the response. A macrotask gap (setImmediate) is used rather than a
          // microtask (Promise.resolve()) because it deterministically runs after any
          // stream flow already scheduled via process.nextTick, reliably reproducing the race.
          await new Promise((resolve) => setImmediate(resolve));
          // Also confirms the tee carries IncomingMessage-shaped metadata, not just body bytes.
          expect(res.statusCode).toBe(200);
          expect(res.headers).toEqual({ 'content-type': 'application/json' });
          res.on('data', (chunk: any) => { hostReceived += chunk.toString(); });
          res.on('end', () => {
            try {
              expect(hostReceived).toBe('{"ok":true}');
              done();
            } catch (e) {
              done(e);
            }
          });
        } catch (e) {
          done(e);
        }
      };

      (service as any).interceptRequest(
        originalRequest,
        options,
        hostCallback,
        'https',
        mockMatchedPattern
      );
    });

    it('protects a host using req.on("response", ...) with no callback passed to interceptRequest (regression for tee/req.on gap)', (done) => {
      const originalRequest = jest.fn().mockImplementation(() => {
        setImmediate(() => {
          mockReq.emit('response', mockRes);
          mockRes.emit('data', '{"ok":true}');
          mockRes.emit('end');
        });
        return mockReq;
      });

      const options = { hostname: 'api.test.com', path: '/test' };

      // No callback passed (undefined) — the host instead attaches via req.on('response', ...)
      // on the returned request, exactly like the documented Node calling convention this fix covers.
      const req = (service as any).interceptRequest(
        originalRequest,
        options,
        undefined,
        'https',
        mockMatchedPattern
      );

      let hostReceived = '';
      let hostStatusCode: number | undefined;
      req.on('response', (res: any) => {
        hostStatusCode = res.statusCode;
        res.on('data', (chunk: any) => { hostReceived += chunk.toString(); });
      });

      setTimeout(() => {
        try {
          expect(hostStatusCode).toBe(200);
          expect(hostReceived).toBe('{"ok":true}');
          // The interceptor's own capture must still have fired independently of the host listener.
          expect(onRequestCompleteMock).toHaveBeenCalled();
          done();
        } catch (e) {
          done(e);
        }
      }, 20);
    });

    it('delivers the same substituted response object to multiple req.on("response", ...) listeners', (done) => {
      const originalRequest = jest.fn().mockImplementation(() => {
        setImmediate(() => {
          mockReq.emit('response', mockRes);
          mockRes.emit('end');
        });
        return mockReq;
      });

      const options = { hostname: 'api.test.com', path: '/test' };

      const req = (service as any).interceptRequest(
        originalRequest,
        options,
        undefined,
        'https',
        mockMatchedPattern
      );

      let first: any;
      let second: any;
      req.on('response', (res: any) => { first = res; });
      req.on('response', (res: any) => { second = res; });

      setTimeout(() => {
        try {
          expect(first).toBeDefined();
          expect(first).toBe(second);
          done();
        } catch (e) {
          done(e);
        }
      }, 20);
    });

    it('should handle request errors', () => {
      const originalRequest = jest.fn().mockReturnValue(mockReq);

      const options = { hostname: 'api.test.com', path: '/test' };

      (service as any).interceptRequest(
        originalRequest,
        options,
        jest.fn(),
        'https',
        mockMatchedPattern
      );

      const error = new Error('Request error');
      mockReq.emit('error', error);

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('3-arg request(url, options, callback) form (regression for #160)', () => {
    it('preserves method/headers and invokes the real callback through the live patched https.request', async () => {
      const fakeReq: any = new EventEmitter();
      fakeReq.write = jest.fn();
      fakeReq.end = jest.fn();

      const fakeRes: any = new EventEmitter();
      fakeRes.statusCode = 200;
      fakeRes.headers = { 'content-type': 'application/json' };

      // Stand in for the real https.request: this becomes patchHTTPS's `originalRequest`
      // closure variable, i.e. the "real" underlying request the wrapper must forward to correctly.
      // No callback arg is forwarded to this mock anymore (see interceptRequest's patchResponseEmit
      // restructuring) — the response is delivered via `fakeReq.emit('response', ...)` instead.
      nodeHttps.request = jest.fn((options: any) => {
        // The real options (method/headers) must reach the underlying request untouched —
        // previously they were dropped and the request silently went out as a bare GET.
        expect(options).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } });

        queueMicrotask(() => {
          fakeReq.emit('response', fakeRes);
          fakeRes.emit('end');
        });

        return fakeReq;
      });

      (mockPatternMatchingService as any).matchesAPIPatternSync = jest.fn().mockReturnValue(mockMatchedPattern);

      service.setupMonitoring();

      const hostCallback = jest.fn();

      // Previously this threw "callback is not a function" synchronously, since the real
      // options object was misassigned into the callback parameter slot.
      expect(() => {
        nodeHttps.request(
          'https://api.test.com/v1/chat/completions',
          { method: 'POST', headers: { 'content-type': 'application/json' } },
          hostCallback
        );
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(hostCallback).toHaveBeenCalledTimes(1);
      expect(hostCallback.mock.calls[0][0].statusCode).toBe(200);
    });
  });

  describe('URL Building', () => {
    it('should build URL from string', () => {
      const url = (service as any).buildURL('https://api.test.com/test', 'https');
      expect(url).toBe('https://api.test.com/test');
    });

    it('should build URL from URL object', () => {
      const urlObj = new URL('https://api.test.com/test');
      const url = (service as any).buildURL(urlObj, 'https');
      expect(url).toBe('https://api.test.com/test');
    });

    it('should build URL from RequestOptions with href', () => {
      const options = { href: 'https://api.test.com/test' };
      const url = (service as any).buildURL(options, 'https');
      expect(url).toBe('https://api.test.com/test');
    });

    it('should build URL from RequestOptions components', () => {
      const options = {
        hostname: 'api.test.com',
        path: '/test',
        port: 443
      };
      const url = (service as any).buildURL(options, 'https');
      expect(url).toBe('https://api.test.com:443/test');
    });

    it('should handle missing components gracefully', () => {
      const options = {};
      const url = (service as any).buildURL(options, 'https');
      expect(url).toBe('https://unknown/');
    });
  });

  describe('Debug and Logging', () => {
    it('should debug requests and increment counter', () => {
      const options = { hostname: 'api.test.com' };

      (service as any).debugRequest('TEST', options);

      expect(service.getStats().totalRequests).toBe(1);
    });

    it('should handle different option types in debugging', () => {
      (service as any).debugRequest('TEST', 'https://api.test.com');
      (service as any).debugRequest('TEST', new URL('https://api.test.com'));
      (service as any).debugRequest('TEST', { url: 'https://api.test.com' });

      expect(service.getStats().totalRequests).toBe(3);
    });

    it('should not log in silent mode', () => {
      (service as any).log('test message');
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should log in non-silent mode', () => {
      const nonSilentService = new RequestMonitoringService(mockPatternMatchingService, false);
      (nonSilentService as any).log('test message');
      expect(console.log).toHaveBeenCalledWith('test message');
    });
  });

  describe('Statistics', () => {
    it('should track request statistics correctly', () => {
      // Simulate some requests
      (service as any).debugRequest('TEST', { hostname: 'test1.com' });
      (service as any).debugRequest('TEST', { hostname: 'test2.com' });

      // Simulate some interceptions
      (service as any).interceptedCalls = 1;

      const stats = service.getStats();

      expect(stats).toEqual({
        totalRequests: 2,
        interceptedCalls: 1
      });
    });
  });

  describe('Gzip response decompression', () => {
    const jsonPayload = '{"model":"gpt-4","choices":[{"message":{"content":"hello"}}]}';

    function runInterceptWithResponse(
      headers: Record<string, string>,
      chunks: Array<Buffer | string>,
      done: jest.DoneCallback,
      assertion: () => void
    ) {
      const mockReq = new EventEmitter() as any;
      mockReq.write = jest.fn().mockReturnValue(true);
      mockReq.end = jest.fn();

      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.headers = headers;
      mockRes.destroyed = false;
      mockRes.destroy = jest.fn();

      const originalRequest = jest.fn().mockImplementation(() => {
        setTimeout(() => {
          mockReq.emit('response', mockRes);
          for (const chunk of chunks) { mockRes.emit('data', chunk); }
          mockRes.emit('end');
        }, 0);
        return mockReq;
      });

      // Hook into onRequestComplete rather than using a fixed-delay timer.
      // A hardcoded 50 ms was flaky on Node 22 where libuv schedules
      // zlib.gunzip callbacks differently, causing done() to never fire.
      onRequestCompleteMock.mockImplementationOnce(() => {
        try {
          assertion();
          done();
        } catch (e: any) {
          done(e);
        }
      });

      (service as any).interceptRequest(
        originalRequest,
        { hostname: 'api.test.com', path: '/test' },
        jest.fn(),
        'https',
        mockMatchedPattern
      );
    }

    it('should handle plain text responses', (done) => {
      runInterceptWithResponse(
        { 'content-type': 'application/json' },
        [jsonPayload],
        done,
        () => {
          expect(onRequestCompleteMock).toHaveBeenCalledWith(
            expect.objectContaining({ response_body: expect.objectContaining({ model: 'gpt-4' }) }),
            mockMatchedPattern
          );
        }
      );
    });

    it('should decompress gzip-encoded responses', (done) => {
      const compressed = zlib.gzipSync(Buffer.from(jsonPayload));
      runInterceptWithResponse(
        { 'content-type': 'application/json', 'content-encoding': 'gzip' },
        [compressed],
        done,
        () => {
          expect(onRequestCompleteMock).toHaveBeenCalledWith(
            expect.objectContaining({ response_body: expect.objectContaining({ model: 'gpt-4' }) }),
            mockMatchedPattern
          );
        }
      );
    });

    it('should decompress deflate-encoded responses (RFC 1950 zlib-wrapped)', (done) => {
      const compressed = zlib.deflateSync(Buffer.from(jsonPayload));
      runInterceptWithResponse(
        { 'content-encoding': 'deflate' },
        [compressed],
        done,
        () => {
          expect(onRequestCompleteMock).toHaveBeenCalledWith(
            expect.objectContaining({ response_body: expect.objectContaining({ model: 'gpt-4' }) }),
            mockMatchedPattern
          );
        }
      );
    });

    it('should decompress deflate-encoded responses (RFC 1951 raw deflate fallback)', (done) => {
      // deflateRawSync produces raw deflate without the zlib wrapper — what older IIS/some
      // load balancers send despite advertising content-encoding: deflate.
      const compressed = zlib.deflateRawSync(Buffer.from(jsonPayload));
      runInterceptWithResponse(
        { 'content-encoding': 'deflate' },
        [compressed],
        done,
        () => {
          expect(onRequestCompleteMock).toHaveBeenCalledWith(
            expect.objectContaining({ response_body: expect.objectContaining({ model: 'gpt-4' }) }),
            mockMatchedPattern
          );
        }
      );
    });

    it('should decompress brotli-encoded responses', (done) => {
      const compressed = zlib.brotliCompressSync(Buffer.from(jsonPayload));
      runInterceptWithResponse(
        { 'content-encoding': 'br' },
        [compressed],
        done,
        () => {
          expect(onRequestCompleteMock).toHaveBeenCalledWith(
            expect.objectContaining({ response_body: expect.objectContaining({ model: 'gpt-4' }) }),
            mockMatchedPattern
          );
        }
      );
    });

    it('should pass through unrecognized content-encoding as plain text', (done) => {
      runInterceptWithResponse(
        { 'content-encoding': 'identity' },
        [jsonPayload],
        done,
        () => {
          expect(onRequestCompleteMock).toHaveBeenCalledWith(
            expect.objectContaining({ response_body: expect.objectContaining({ model: 'gpt-4' }) }),
            mockMatchedPattern
          );
        }
      );
    });

    it('should handle multi-chunk gzip responses', (done) => {
      const compressed = zlib.gzipSync(Buffer.from(jsonPayload));
      const half = Math.floor(compressed.length / 2);
      runInterceptWithResponse(
        { 'content-encoding': 'gzip' },
        [compressed.slice(0, half), compressed.slice(half)],
        done,
        () => {
          expect(onRequestCompleteMock).toHaveBeenCalledWith(
            expect.objectContaining({ response_body: expect.objectContaining({ model: 'gpt-4' }) }),
            mockMatchedPattern
          );
        }
      );
    });

    it('should fall back gracefully when decompression fails', (done) => {
      const notGzip = Buffer.from('this is not gzip data');
      runInterceptWithResponse(
        { 'content-encoding': 'gzip' },
        [notGzip],
        done,
        () => {
          // Should have called onRequestComplete without throwing
          expect(onRequestCompleteMock).toHaveBeenCalled();
          const callData = onRequestCompleteMock.mock.calls[0][0];
          // Falls back to raw utf-8 string (which won't parse as JSON → string body)
          expect(callData).toBeDefined();
        }
      );
    });

    it('should truncate raw response buffering once it exceeds MAX_DECOMPRESSED_BYTES', (done) => {
      // Feed more chunk bytes than the cap allows; the interceptor should stop
      // accumulating rather than growing responseChunks unbounded, and still
      // complete the call instead of hanging or crashing.
      const chunkSize = 1024 * 1024; // 1 MB
      const chunkCount = Math.ceil(MAX_DECOMPRESSED_BYTES / chunkSize) + 2;
      const chunks = Array.from({ length: chunkCount }, () => Buffer.alloc(chunkSize, 'a'));

      runInterceptWithResponse(
        { 'content-type': 'text/plain' },
        chunks,
        done,
        () => {
          expect(onRequestCompleteMock).toHaveBeenCalled();
        }
      );
    }, 20000);
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle undefined options in pattern matching', () => {
      expect(() => {
        (service as any).debugRequest('TEST', { hostname: 'test.com' });
      }).not.toThrow();
    });

    it('should handle complex nested request scenarios', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        clone: () => ({
          text: () => Promise.resolve('{}')
        })
      });

      globalThis.fetch = mockFetch;
      mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue(null);

      service.setupMonitoring();

      await globalThis.fetch('https://non-matching.com/test');

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle response without status code', (done) => {
      const mockReq = new EventEmitter() as any;
      mockReq.write = jest.fn().mockReturnValue(true);
      mockReq.end = jest.fn();

      const originalRequest = jest.fn().mockImplementation(() => {
        const res = new EventEmitter() as any;
        res.headers = {};
        res.destroyed = false;
        res.destroy = jest.fn();
        // No statusCode set

        setTimeout(() => {
          mockReq.emit('response', res);
          res.emit('data', '{}');
          res.emit('end');
        }, 0);

        return mockReq;
      });

      (service as any).interceptRequest(
        originalRequest,
        { hostname: 'test.com' },
        jest.fn(),
        'https',
        mockMatchedPattern
      );

      setTimeout(() => {
        expect(onRequestCompleteMock).toHaveBeenCalledWith(
          expect.objectContaining({
            status_code: null
          }),
          mockMatchedPattern
        );
        done();
      }, 50);
    });
  });
});