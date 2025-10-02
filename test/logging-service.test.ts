import { LoggingService, LoggingServiceConfig } from '../src/services/LoggingService';
import { CallData, MatchedPattern } from '../src/types';

// Mock fetch for testing
const originalFetch = (global as any).fetch;

// Helper function to create a mock fetch
function createMockFetch(mockResponse: any, status: number = 200, ok: boolean = true): any {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: jest.fn().mockResolvedValue(mockResponse),
    text: jest.fn().mockResolvedValue(JSON.stringify(mockResponse))
  });
}

// Helper function to create mock call data
function createMockCallData(overrides: Partial<CallData> = {}): CallData {
  return {
    id: 1,
    timestamp: '2023-01-01T00:00:00Z',
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { 'Content-Type': 'application/json', 'Authorization': '[REDACTED]' },
    request_body: {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7
    },
    response_body: { choices: [{ message: { content: 'Hi there!' } }] },
    response_headers: { 'Content-Type': 'application/json' },
    status_code: 200,
    protocol: 'https',
    ...overrides
  };
}

// Helper function to create mock matched pattern
function createMockMatchedPattern(): MatchedPattern {
  return {
    pattern: {
      name: 'OpenAI',
      domains: ['api.openai.com'],
      paths: ['/v1/chat/completions'],
      headers: { 'Authorization': '[REDACTED]' }
    },
    matchType: 'domain',
    matchValue: 'api.openai.com'
  };
}

describe('LoggingService', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  describe('Constructor validation and initialization', () => {
    it('should configure with production endpoint', () => {
      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);

      expect(service.getApiEndpoint()).toBe('https://coolhand.io/api/v2/llm_request_logs');
    });
  });

  describe('API Logging', () => {
    it('should successfully log with fetch', async () => {
      const mockResponse = { id: 123, status: 'success' };
      (global as any).fetch = createMockFetch(mockResponse);

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      await expect(service.logRequestToAPI(callData)).resolves.not.toThrow();
    });

    it('should successfully log with matched pattern', async () => {
      const mockResponse = { id: 124, status: 'success' };
      (global as any).fetch = createMockFetch(mockResponse);

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();
      const matchedPattern = createMockMatchedPattern();

      await expect(service.logRequestToAPI(callData, matchedPattern)).resolves.not.toThrow();
    });

    it('should handle failed API response gracefully', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue('Bad Request'),
        json: jest.fn().mockResolvedValue({ error: 'Bad Request' })
      });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      await expect(service.logRequestToAPI(callData)).resolves.not.toThrow();
    });

    it('should handle network errors gracefully', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      await expect(service.logRequestToAPI(callData)).resolves.not.toThrow();
    });

    it('should structure payload correctly', async () => {
      let capturedRequestBody: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, status: 'success' }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, status: 'success' }))
        };
      });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData({
        id: 456,
        method: 'POST',
        url: 'https://api.example.com/test'
      });

      await service.logRequestToAPI(callData);

      expect(capturedRequestBody.llm_request_log).toBeDefined();
      expect(capturedRequestBody.llm_request_log.raw_request).toBeDefined();

      const rawRequest = capturedRequestBody.llm_request_log.raw_request;
      expect(rawRequest.id).toBe(456);
      expect(rawRequest.method).toBe('POST');
      expect(rawRequest.url).toBe('https://api.example.com/test');
    });

    it('should set correct headers', async () => {
      let capturedHeaders: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedHeaders = options.headers;
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, status: 'success' }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, status: 'success' }))
        };
      });

      const config: LoggingServiceConfig = {
        apiKey: 'secret-api-key-123',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      await service.logRequestToAPI(callData);

      expect(capturedHeaders['Content-Type']).toBe('application/json');
      expect(capturedHeaders['X-API-Key']).toBe('secret-api-key-123');
    });
  });

  describe('Logging behavior', () => {
    it('should not output logs in silent mode', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      (global as any).fetch = createMockFetch({ id: 123, status: 'success' });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();
      const matchedPattern = createMockMatchedPattern();

      await service.logRequestToAPI(callData, matchedPattern);

      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).not.toContain('🎉 LOGGING');
      expect(logCalls).not.toContain('✅ Successfully logged');

      consoleSpy.mockRestore();
    });

    it('should output verbose logs in non-silent mode', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      (global as any).fetch = createMockFetch({ id: 123, status: 'success' });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: false
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();
      const matchedPattern = createMockMatchedPattern();

      await service.logRequestToAPI(callData, matchedPattern);

      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('🎉 LOGGING OpenAI API Call');
      expect(logCalls).toContain('🕐 Time:');
      expect(logCalls).toContain('🎯 POST');
      expect(logCalls).toContain('📊 Status: 200');
      expect(logCalls).toContain('🔧 Protocol: https');
      expect(logCalls).toContain('🔍 Matched by: domain');
      expect(logCalls).toContain('🤖 Model: gpt-4');
      expect(logCalls).toContain('💬 Messages: 1');
      expect(logCalls).toContain('🌡️  Temperature: 0.7');
      expect(logCalls).toContain('📤 Sending to:');

      consoleSpy.mockRestore();
    });

    it('should use HTTPS fallback when fetch is not available', async () => {
      const originalFetch = (global as any).fetch;
      delete (global as any).fetch;

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      try {
        await service.logRequestToAPI(callData);
      } catch (error) {
        expect((error as Error).message).not.toContain('fetch');
      }

      (global as any).fetch = originalFetch;
    });

    it('should handle logging without matched pattern', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      (global as any).fetch = createMockFetch({ id: 123, status: 'success' });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: false
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      await service.logRequestToAPI(callData);

      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('🎉 LOGGING API API Call');
      expect(logCalls).not.toContain('🔍 Matched by:');

      consoleSpy.mockRestore();
    });
  });
});

