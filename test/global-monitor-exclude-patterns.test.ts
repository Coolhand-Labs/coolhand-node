import { PatternMatchingService } from '../src/services/PatternMatchingService';
import { LoggingService } from '../src/services/LoggingService';
import { DEFAULT_EXCLUDE_API_PATTERNS } from '../src/default-exclude-api-patterns';

// Isolated from test/global-monitor.test.ts: this file gets its own module registry and
// globalThis (Jest sandboxes each test file), so the module-level `__coolhand_node_v1__` state
// global-monitor.ts stores on globalThis starts fresh here and won't leak between the two files.
jest.mock('https');
jest.mock('http');
jest.mock('fs');
jest.mock('../src/services/PatternMatchingService');
jest.mock('../src/services/LoggingService');

describe('Global Monitor — excludeApiPatterns and self-endpoint exclusion', () => {
  let mockPatternMatchingService: jest.Mocked<PatternMatchingService>;
  let mockLoggingService: jest.Mocked<LoggingService>;
  let globalMonitor: any;
  let underlyingHttpsRequestMock: jest.Mock;
  let underlyingHttpsGetMock: jest.Mock;

  beforeAll(async () => {
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
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    globalMonitor._resetGlobalState();
    // Each test re-initializes global monitoring (via _resetGlobalState above), which re-patches
    // https.request/.get. Object.defineProperty is mocked to just reassign the property (see
    // above), so without restoring the pristine mock first, patchHTTPS() would capture the
    // *previous* test's already-patched wrapper as "original" and double-wrap it, double-counting
    // intercepted calls across tests.
    require('https').request = underlyingHttpsRequestMock;
    require('https').get = underlyingHttpsGetMock;
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

  describe('self-endpoint exclusion', () => {
    it('never intercepts a request to the configured baseUrl host+port, even with no excludeApiPatterns configured', async () => {
      mockPatternMatchingService.matchesAPIPatternSync.mockReturnValue({
        pattern: { name: 'Local', domains: ['localhost'] },
        matchType: 'domain',
        matchValue: 'localhost'
      } as any);
      mockHttpsResponse();

      await globalMonitor.initializeGlobalMonitoring({ apiKey: 'test-key', baseUrl: 'http://localhost:3000', silent: true });

      const https = require('https');
      https.request({ hostname: 'localhost', port: 3000, path: '/api/v2/llm_request_logs', method: 'POST' }, jest.fn());

      expect(globalMonitor.getGlobalStats().interceptedCalls).toBe(0);
    });

    it('still intercepts a matched request to the same hostname on a different port (e.g. a local Ollama proxy)', async () => {
      mockPatternMatchingService.matchesAPIPatternSync.mockReturnValue({
        pattern: { name: 'Local', domains: ['localhost'] },
        matchType: 'domain',
        matchValue: 'localhost'
      } as any);
      mockHttpsResponse();

      await globalMonitor.initializeGlobalMonitoring({ apiKey: 'test-key', baseUrl: 'http://localhost:3000', silent: true });

      const https = require('https');
      https.request({ hostname: 'localhost', port: 11434, path: '/api/generate', method: 'POST' }, jest.fn());

      expect(globalMonitor.getGlobalStats().interceptedCalls).toBe(1);
    });
  });

  describe('excludeApiPatterns', () => {
    it('applies DEFAULT_EXCLUDE_API_PATTERNS when none is configured', async () => {
      mockPatternMatchingService.matchesAPIPatternSync.mockReturnValue({
        pattern: { name: 'Vertex', domains: ['aiplatform.googleapis.com'] },
        matchType: 'domain',
        matchValue: 'aiplatform.googleapis.com'
      } as any);
      mockHttpsResponse();

      await globalMonitor.initializeGlobalMonitoring({ apiKey: 'test-key', silent: true });

      expect(DEFAULT_EXCLUDE_API_PATTERNS).toContain('/batchPredictionJobs/');

      const https = require('https');
      https.request({
        hostname: 'aiplatform.googleapis.com',
        path: '/v1/projects/p/locations/us-central1/batchPredictionJobs/123',
        method: 'GET'
      }, jest.fn());

      expect(globalMonitor.getGlobalStats().interceptedCalls).toBe(0);
    });

    it('suppresses interception for a custom excludeApiPatterns entry on the https.request path', async () => {
      mockPatternMatchingService.matchesAPIPatternSync.mockReturnValue({
        pattern: { name: 'Test API', domains: ['api.test.com'] },
        matchType: 'domain',
        matchValue: 'api.test.com'
      } as any);
      mockHttpsResponse();

      await globalMonitor.initializeGlobalMonitoring({
        apiKey: 'test-key',
        silent: true,
        excludeApiPatterns: ['/internal/']
      });

      const https = require('https');
      https.request({ hostname: 'api.test.com', path: '/internal/health', method: 'GET' }, jest.fn());

      expect(globalMonitor.getGlobalStats().interceptedCalls).toBe(0);
    });

    it('suppresses interception for a custom excludeApiPatterns entry on the fetch path', async () => {
      const originalFetch = jest.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        clone: () => ({ text: () => Promise.resolve('{}') })
      });
      globalThis.fetch = originalFetch as any;

      mockPatternMatchingService.matchesAPIPatternFromURL.mockReturnValue({
        pattern: { name: 'Test API', domains: ['api.test.com'] },
        matchType: 'domain',
        matchValue: 'api.test.com'
      } as any);

      await globalMonitor.initializeGlobalMonitoring({
        apiKey: 'test-key',
        silent: true,
        excludeApiPatterns: ['/internal/']
      });

      await globalThis.fetch('https://api.test.com/internal/health');

      expect(globalMonitor.getGlobalStats().interceptedCalls).toBe(0);

      delete (globalThis as any).fetch;
    });
  });
});
