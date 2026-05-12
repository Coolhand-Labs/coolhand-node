import { DEFAULT_EXCLUDE_API_PATTERNS } from '../src/default-exclude-api-patterns';
import { RequestMonitoringService } from '../src/services/RequestMonitoringService';
import { PatternMatchingService } from '../src/services/PatternMatchingService';
import { CoolhandMatchedPattern, CoolhandAPIPattern } from '../src/types';

jest.mock('https');
jest.mock('http');
jest.mock('fs');

describe('DEFAULT_EXCLUDE_API_PATTERNS', () => {
  it('contains /batchPredictionJobs/', () => {
    expect(DEFAULT_EXCLUDE_API_PATTERNS).toContain('/batchPredictionJobs/');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DEFAULT_EXCLUDE_API_PATTERNS)).toBe(true);
  });

  it('is a non-empty array', () => {
    expect(Array.isArray(DEFAULT_EXCLUDE_API_PATTERNS)).toBe(true);
    expect(DEFAULT_EXCLUDE_API_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe('RequestMonitoringService excludeApiPatterns', () => {
  let service: RequestMonitoringService;
  let mockPatternMatchingService: jest.Mocked<PatternMatchingService>;

  const mockPattern: CoolhandAPIPattern = {
    name: 'Google AI Platform',
    domains: ['aiplatform.googleapis.com'],
    headers: { 'authorization': '[REDACTED]' }
  };

  const mockMatchedPattern: CoolhandMatchedPattern = {
    pattern: mockPattern,
    matchType: 'domain',
    matchValue: 'aiplatform.googleapis.com'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();

    mockPatternMatchingService = {
      matchesAPIPattern: jest.fn(),
      matchesAPIPatternSync: jest.fn(),
      matchesAPIPatternFromURL: jest.fn(),
      sanitizeHeaders: jest.fn().mockImplementation((headers: any) => ({ ...headers })),
      sanitizeURL: jest.fn().mockImplementation((url: string) => url),
      getLoadedPatterns: jest.fn(),
      getPatternsCount: jest.fn(),
      getPatternsCountSync: jest.fn().mockReturnValue(1),
    } as any;

    service = new RequestMonitoringService(mockPatternMatchingService, true);
    service.onRequestComplete = jest.fn();
    (RequestMonitoringService as any).isPatched = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('initializes with an empty excludeApiPatterns array', () => {
    expect(service.excludeApiPatterns).toEqual([]);
  });

  it('allows setting excludeApiPatterns', () => {
    service.excludeApiPatterns = ['/batchPredictionJobs/'];
    expect(service.excludeApiPatterns).toEqual(['/batchPredictionJobs/']);
  });

  it('allows pushing to excludeApiPatterns', () => {
    service.excludeApiPatterns = ['/batchPredictionJobs/'];
    service.excludeApiPatterns.push('/myOperationalEndpoint/');
    expect(service.excludeApiPatterns).toContain('/myOperationalEndpoint/');
    expect(service.excludeApiPatterns).toContain('/batchPredictionJobs/');
  });

  it('allows clearing excludeApiPatterns', () => {
    service.excludeApiPatterns = ['/batchPredictionJobs/'];
    service.excludeApiPatterns = [];
    expect(service.excludeApiPatterns).toEqual([]);
  });

  describe('isExcluded logic', () => {
    const batchJobUrl = 'https://aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/batchPredictionJobs/123';
    const inferenceUrl = 'https://aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models/gemini-pro:generateContent';
    const tuningJobUrl = 'https://aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/tuningJobs/456';

    function isExcluded(svc: RequestMonitoringService, url: string): boolean {
      return (svc as any).isExcluded({ href: url }, 'https');
    }

    it('returns true when URL contains an exclude pattern', () => {
      service.excludeApiPatterns = ['/batchPredictionJobs/'];
      expect(isExcluded(service, batchJobUrl)).toBe(true);
    });

    it('returns false when URL does not contain any exclude pattern', () => {
      service.excludeApiPatterns = ['/batchPredictionJobs/'];
      expect(isExcluded(service, inferenceUrl)).toBe(false);
    });

    it('returns false when excludeApiPatterns is empty', () => {
      service.excludeApiPatterns = [];
      expect(isExcluded(service, batchJobUrl)).toBe(false);
    });

    it('returns true after pushing a new pattern that matches', () => {
      service.excludeApiPatterns = [];
      service.excludeApiPatterns.push('/batchPredictionJobs/');
      expect(isExcluded(service, batchJobUrl)).toBe(true);
    });

    it('returns false after replacing patterns that no longer match the URL', () => {
      service.excludeApiPatterns = ['/batchPredictionJobs/'];
      service.excludeApiPatterns = ['/tuningJobs/'];
      expect(isExcluded(service, batchJobUrl)).toBe(false);
    });

    it('returns true for the newly assigned pattern', () => {
      service.excludeApiPatterns = ['/batchPredictionJobs/'];
      service.excludeApiPatterns = ['/tuningJobs/'];
      expect(isExcluded(service, tuningJobUrl)).toBe(true);
    });

    it('checks all patterns in the list', () => {
      service.excludeApiPatterns = ['/batchPredictionJobs/', '/tuningJobs/'];
      expect(isExcluded(service, batchJobUrl)).toBe(true);
      expect(isExcluded(service, tuningJobUrl)).toBe(true);
      expect(isExcluded(service, inferenceUrl)).toBe(false);
    });
  });

  describe('HTTPS interception with exclude patterns', () => {
    beforeEach(() => {
      const httpsModule = require('https');
      const fakeReq = { write: jest.fn(), end: jest.fn(), on: jest.fn() };
      httpsModule.request = jest.fn().mockReturnValue(fakeReq);
      httpsModule.get = jest.fn().mockReturnValue(fakeReq);

      mockPatternMatchingService.matchesAPIPatternSync.mockImplementation((options: any) => {
        const host = typeof options === 'string' ? options :
                     options instanceof URL ? options.hostname :
                     (options as any).hostname || (options as any).host || '';
        return host.includes('aiplatform.googleapis.com') ? mockMatchedPattern : null;
      });
    });

    it('does NOT intercept when URL path matches an exclude pattern', () => {
      service.excludeApiPatterns = ['/batchPredictionJobs/'];
      service.setupMonitoring();

      const httpsModule = require('https');
      httpsModule.request({
        hostname: 'aiplatform.googleapis.com',
        path: '/v1/projects/my-project/locations/us-central1/batchPredictionJobs/123',
        method: 'GET',
      }, jest.fn());

      expect(service.getStats().interceptedCalls).toBe(0);
    });

    it('does NOT intercept when URL path matches a custom-pushed pattern', () => {
      service.excludeApiPatterns = [];
      service.excludeApiPatterns.push('/batchPredictionJobs/');
      service.setupMonitoring();

      const httpsModule = require('https');
      httpsModule.request({
        hostname: 'aiplatform.googleapis.com',
        path: '/v1/projects/my-project/locations/us-central1/batchPredictionJobs/123',
        method: 'GET',
      }, jest.fn());

      expect(service.getStats().interceptedCalls).toBe(0);
    });
  });

  describe('fetch interception with exclude patterns', () => {
    it('does NOT intercept fetch when URL matches an exclude pattern', () => {
      mockPatternMatchingService.matchesAPIPatternFromURL.mockImplementation((url: string) => {
        return url.includes('aiplatform.googleapis.com') ? mockMatchedPattern : null;
      });

      service.excludeApiPatterns = ['/batchPredictionJobs/'];
      (RequestMonitoringService as any).isPatched = false;

      const originalFetch = jest.fn().mockResolvedValue(new Response('{}'));
      globalThis.fetch = originalFetch;

      service.setupMonitoring();

      const url = 'https://aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/batchPredictionJobs/123';
      globalThis.fetch(url);

      expect(service.getStats().interceptedCalls).toBe(0);

      delete (globalThis as any).fetch;
    });

    it('DOES intercept fetch when URL is on allow-list but not excluded', () => {
      mockPatternMatchingService.matchesAPIPatternFromURL.mockImplementation((url: string) => {
        return url.includes('aiplatform.googleapis.com') ? mockMatchedPattern : null;
      });

      service.excludeApiPatterns = ['/batchPredictionJobs/'];
      (RequestMonitoringService as any).isPatched = false;

      const originalFetch = jest.fn().mockResolvedValue(new Response('{}'));
      globalThis.fetch = originalFetch;

      service.setupMonitoring();

      const url = 'https://aiplatform.googleapis.com/v1/projects/my-project/publishers/google/models/gemini-pro:generateContent';
      globalThis.fetch(url);

      expect(service.getStats().interceptedCalls).toBe(1);

      delete (globalThis as any).fetch;
    });
  });
});
