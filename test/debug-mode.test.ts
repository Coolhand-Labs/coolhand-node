import { Coolhand } from '../src/coolhand.js';
import { FeedbackService } from '../src/services/FeedbackService.js';
import { LoggingService } from '../src/services/LoggingService.js';

// Mock the pattern matching service to prevent file system operations
jest.mock('../src/services/PatternMatchingService.js', () => {
  return {
    PatternMatchingService: jest.fn().mockImplementation(() => ({
      getPatternsCount: jest.fn().mockReturnValue(5),
      getPatternsCountSync: jest.fn().mockReturnValue(5),
      sanitizeHeaders: jest.fn().mockReturnValue({}),
    }))
  };
});

// Mock the request monitoring service
jest.mock('../src/services/RequestMonitoringService.js', () => {
  return {
    RequestMonitoringService: jest.fn().mockImplementation(() => ({
      setupMonitoring: jest.fn(),
      getStats: jest.fn().mockReturnValue({
        totalRequests: 0,
        interceptedCalls: 0
      }),
      onRequestComplete: null
    }))
  };
});

describe('Debug/DryRun Mode', () => {
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Coolhand initialization', () => {
    it('should show dry run indicator when dryRun=true', () => {
      new Coolhand({ apiKey: mockApiKey, silent: false, dryRun: true });
      expect(console.log).toHaveBeenCalledWith(
        '🚫 DRY RUN MODE: API calls will be skipped — no data will be submitted'
      );
    });

    it('should show debug verbose indicator when debug=true', () => {
      new Coolhand({ apiKey: mockApiKey, silent: false, debug: true });
      expect(console.log).toHaveBeenCalledWith('🔬 DEBUG MODE: Verbose logging enabled');
    });

    it('should not show dry run indicator when dryRun=false', () => {
      new Coolhand({ apiKey: mockApiKey, silent: false, dryRun: false });
      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('DRY RUN MODE')
      );
    });

    it('should not show dry run indicator when dryRun is undefined', () => {
      new Coolhand({ apiKey: mockApiKey, silent: false });
      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('DRY RUN MODE')
      );
    });

    it('should emit deprecation warning exactly once when debug=true without dryRun', () => {
      new Coolhand({ apiKey: mockApiKey, silent: true, debug: true });
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('DEPRECATION WARNING')
      );
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('dryRun')
      );
    });

    it('should not emit deprecation warning when debug=true and dryRun=true', () => {
      new Coolhand({ apiKey: mockApiKey, silent: true, debug: true, dryRun: true });
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should not emit deprecation warning when debug is not set', () => {
      new Coolhand({ apiKey: mockApiKey, silent: true });
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe('FeedbackService dryRun mode', () => {
    it('should return null when in dryRun mode', async () => {
      const feedbackService = new FeedbackService({
        apiKey: mockApiKey,
        silent: true,
        dryRun: true
      });

      const result = await feedbackService.createFeedback({ like: true, explanation: 'Test feedback' });
      expect(result).toBeNull();
    });

    it('should log dry run messages when dryRun=true and not silent', async () => {
      const feedbackService = new FeedbackService({
        apiKey: mockApiKey,
        silent: false,
        dryRun: true
      });

      await feedbackService.createFeedback({ like: true, explanation: 'Test feedback' });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('DRY RUN: Skipping API call')
      );
    });

    it('should call fetch when debug=true but dryRun is not set', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 1, like: true })
      });
      global.fetch = mockFetch;

      const feedbackService = new FeedbackService({
        apiKey: mockApiKey,
        silent: true,
        debug: true
      });

      await feedbackService.createFeedback({ like: true });
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('LoggingService dryRun mode', () => {
    const sampleCallData = {
      id: 1,
      timestamp: '2023-01-01T00:00:00Z',
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {},
      request_body: { model: 'gpt-3.5-turbo' },
      response_body: { choices: [] },
      response_headers: {},
      status_code: 200,
      protocol: 'https'
    };

    it('should skip API call when in dryRun mode', async () => {
      const loggingService = new LoggingService({
        apiKey: mockApiKey,
        silent: true,
        dryRun: true
      });

      await expect(loggingService.logRequestToAPI(sampleCallData)).resolves.toBeNull();
    });

    it('should log dry run messages when dryRun=true and not silent', async () => {
      const loggingService = new LoggingService({
        apiKey: mockApiKey,
        silent: false,
        dryRun: true
      });

      await loggingService.logRequestToAPI(sampleCallData);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('DRY RUN: Skipping API call')
      );
    });
  });

  describe('BaseService dryRun behavioral tests', () => {
    it('should not call fetch when dryRun=true', async () => {
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const feedbackService = new FeedbackService({
        apiKey: mockApiKey,
        silent: true,
        dryRun: true
      });

      await feedbackService.createFeedback({ like: true });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should call fetch when debug=true and dryRun is not set', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 1, like: true })
      });
      global.fetch = mockFetch;

      const feedbackService = new FeedbackService({
        apiKey: mockApiKey,
        silent: true,
        debug: true
      });

      await feedbackService.createFeedback({ like: true });
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should not emit deprecation warn when using services directly with debug=true', () => {
      // Warning is emitted at the Coolhand / initializeGlobalMonitoring layer, not BaseService
      new FeedbackService({ apiKey: mockApiKey, silent: true, debug: true });
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe('debug as verbosity-only', () => {
    it('should emit extra log lines before the call when debug=true and not silent', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 1, like: true })
      });
      global.fetch = mockFetch;

      const feedbackService = new FeedbackService({
        apiKey: mockApiKey,
        silent: false,
        debug: true
      });

      await feedbackService.createFeedback({ like: true });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('DEBUG: Sending to')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('DEBUG: Payload size')
      );
    });

    it('should NOT emit verbose debug logs when silent=true', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 1, like: true })
      });
      global.fetch = mockFetch;

      const feedbackService = new FeedbackService({
        apiKey: mockApiKey,
        silent: true,
        debug: true
      });

      await feedbackService.createFeedback({ like: true });

      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('DEBUG: Sending to')
      );
    });
  });
});
