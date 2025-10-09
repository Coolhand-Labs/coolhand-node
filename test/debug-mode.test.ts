import { Coolhand } from '../src/coolhand.js';
import { FeedbackService } from '../src/services/FeedbackService.js';
import { LoggingService } from '../src/services/LoggingService.js';

// Mock the pattern matching service to prevent file system operations
jest.mock('../src/services/PatternMatchingService.js', () => {
  return {
    PatternMatchingService: jest.fn().mockImplementation(() => ({
      getPatternsCount: jest.fn().mockReturnValue(5),
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

describe('Debug Mode', () => {
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    // Clear console mocks
    jest.clearAllMocks();

    // Mock console.log to avoid output during tests
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Coolhand initialization with debug mode', () => {
    it('should show debug mode indicator when debug is true', () => {
      new Coolhand({
        apiKey: mockApiKey,
        silent: false,
        debug: true
      });

      expect(console.log).toHaveBeenCalledWith('🐛 DEBUG MODE: API calls will be mocked');
    });

    it('should not show debug mode indicator when debug is false', () => {
      new Coolhand({
        apiKey: mockApiKey,
        silent: false,
        debug: false
      });

      expect(console.log).not.toHaveBeenCalledWith('🐛 DEBUG MODE: API calls will be mocked');
    });

    it('should not show debug mode indicator when debug is undefined', () => {
      new Coolhand({
        apiKey: mockApiKey,
        silent: false
      });

      expect(console.log).not.toHaveBeenCalledWith('🐛 DEBUG MODE: API calls will be mocked');
    });
  });

  describe('FeedbackService debug mode', () => {
    let feedbackService: FeedbackService;

    beforeEach(() => {
      feedbackService = new FeedbackService({
        apiKey: mockApiKey,
        silent: true,
        debug: true
      });
    });

    it('should return null when in debug mode', async () => {
      const feedback = {
        like: true,
        explanation: 'Test feedback'
      };

      const result = await feedbackService.createFeedback(feedback);
      expect(result).toBeNull();
    });

    it('should log debug messages when debug mode is enabled and not silent', async () => {
      const feedbackService = new FeedbackService({
        apiKey: mockApiKey,
        silent: false,
        debug: true
      });

      const feedback = {
        like: true,
        explanation: 'Test feedback'
      };

      await feedbackService.createFeedback(feedback);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('🐛 DEBUG MODE: Skipping API call')
      );
    });
  });

  describe('LoggingService debug mode', () => {
    let loggingService: LoggingService;

    beforeEach(() => {
      loggingService = new LoggingService({
        apiKey: mockApiKey,
        silent: true,
        debug: true
      });
    });

    it('should skip API call when in debug mode', async () => {
      const callData = {
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

      // This should not throw and should complete without making actual API calls
      await expect(loggingService.logRequestToAPI(callData)).resolves.toBeUndefined();
    });

    it('should log debug messages when debug mode is enabled and not silent', async () => {
      const loggingService = new LoggingService({
        apiKey: mockApiKey,
        silent: false,
        debug: true
      });

      const callData = {
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

      await loggingService.logRequestToAPI(callData);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('🐛 DEBUG MODE: Skipping API call')
      );
    });
  });

  describe('BaseService debug mode behavior', () => {
    it('should not make actual HTTP requests when in debug mode', async () => {
      const feedbackService = new FeedbackService({
        apiKey: mockApiKey,
        silent: true,
        debug: true
      });

      // Mock fetch to ensure it's not called
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      const feedback = {
        like: true,
        explanation: 'Test feedback'
      };

      await feedbackService.createFeedback(feedback);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});