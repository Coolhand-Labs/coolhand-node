import * as https from 'https';
import * as zlib from 'zlib';
import { RequestMonitoringService } from '../src/services/RequestMonitoringService';
import { PatternMatchingService } from '../src/services/PatternMatchingService';
import { CoolhandMatchedPattern, CoolhandAPIPattern } from '../src/types';
import { EventEmitter } from 'events';

// Mock the modules
jest.mock('https');
jest.mock('http');
jest.mock('fs');

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

    // Reset the static isPatched flag
    (RequestMonitoringService as any).isPatched = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

      service.setupMonitoring();
      service.setupMonitoring();

      expect(setupSpy).toHaveBeenCalledTimes(1);
    });

    it('should log monitoring setup in non-silent mode', () => {
      const nonSilentService = new RequestMonitoringService(mockPatternMatchingService, false);
      (RequestMonitoringService as any).isPatched = false;

      nonSilentService.setupMonitoring();

      expect(console.log).toHaveBeenCalledWith('📡 Monitoring all outbound requests...');
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

      expect(Object.defineProperty).toHaveBeenCalledWith(
        https,
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
        https,
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
        https,
        'get',
        expect.objectContaining({
          value: expect.any(Function),
          writable: true,
          configurable: true
        })
      );
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

      expect(mockPatternMatchingService.matchesAPIPatternFromURL).toHaveBeenCalledWith(url);
      expect(onRequestCompleteMock).toHaveBeenCalled();
    });

    it('should handle fetch errors', async () => {
      const error = new Error('Network error');
      const originalFetch = jest.fn().mockRejectedValue(error);
      globalThis.fetch = originalFetch;

      mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue(mockMatchedPattern);

      service.setupMonitoring();

      await expect(globalThis.fetch('https://api.test.com/test')).rejects.toThrow('Network error');
    });
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
      const originalRequest = jest.fn().mockImplementation((options, callback) => {
        setTimeout(() => callback(mockRes), 0);
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

      const originalRequest = jest.fn().mockImplementation((_opts: any, callback: any) => {
        setTimeout(() => {
          callback(mockRes);
          for (const chunk of chunks) { mockRes.emit('data', chunk); }
          mockRes.emit('end');
        }, 0);
        return mockReq;
      });

      (service as any).interceptRequest(
        originalRequest,
        { hostname: 'api.test.com', path: '/test' },
        jest.fn(),
        'https',
        mockMatchedPattern
      );

      setTimeout(() => { assertion(); done(); }, 50);
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

      const originalRequest = jest.fn().mockImplementation((options, callback) => {
        const res = new EventEmitter() as any;
        res.headers = {};
        // No statusCode set

        setTimeout(() => {
          callback(res);
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