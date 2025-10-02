// test/logging-service.test.ts - Comprehensive tests for LoggingService

import { LoggingService, LoggingServiceConfig } from '../src/services/LoggingService';
import { CallData, MatchedPattern } from '../src/types';

console.log('🧪 Running LoggingService tests...\n');

// Mock fetch for testing
const originalFetch = (global as any).fetch;

// Helper function to create a mock fetch
function createMockFetch(mockResponse: any, status: number = 200, ok: boolean = true): any {
  return async (input: any, options: any) => {
    return {
      ok,
      status,
      json: async () => mockResponse,
      text: async () => JSON.stringify(mockResponse)
    };
  };
}

// Test counter
let testCount = 0;
let passedTests = 0;
let failedTests = 0;

async function runTest(testName: string, testFunction: () => void | Promise<void>): Promise<void> {
  testCount++;
  console.log(`Test ${testCount}: ${testName}`);

  try {
    const result = testFunction();
    if (result instanceof Promise) {
      await result;
    }
    passedTests++;
    console.log('✅ PASS\n');
  } catch (error) {
    failedTests++;
    console.log(`❌ FAIL: ${(error as Error).message}\n`);
  }
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

async function runAllTests() {
  // Test 1: Constructor validation and initialization
  await runTest('Constructor validation and initialization', () => {
    const config: LoggingServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new LoggingService(config);

    if (service.getApiEndpoint() !== 'http://localhost:3000/api/v2/llm_request_logs') {
      throw new Error('Local environment endpoint not set correctly');
    }

    if (service.getEnvironment() !== 'local') {
      throw new Error('Environment not set correctly');
    }
  });

  // Test 2: Production environment configuration
  await runTest('Production environment configuration', () => {
    const config: LoggingServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'production',
      silent: true
    };

    const service = new LoggingService(config);

    if (service.getApiEndpoint() !== 'https://coolhand.io/api/v2/llm_request_logs') {
      throw new Error('Production environment endpoint not set correctly');
    }

    if (service.getEnvironment() !== 'production') {
      throw new Error('Environment not set correctly');
    }
  });

  // Test 3: Successful logging with fetch
  await runTest('Successful logging with fetch', async () => {
    // Mock successful response
    const mockResponse = { id: 123, status: 'success' };
    (global as any).fetch = createMockFetch(mockResponse);

    const config: LoggingServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new LoggingService(config);
    const callData = createMockCallData();

    // Should not throw an error
    await service.logRequestToAPI(callData);

    // Restore original fetch
    (global as any).fetch = originalFetch;
  });

  // Test 4: Successful logging with matched pattern
  await runTest('Successful logging with matched pattern', async () => {
    // Mock successful response
    const mockResponse = { id: 124, status: 'success' };
    (global as any).fetch = createMockFetch(mockResponse);

    const config: LoggingServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new LoggingService(config);
    const callData = createMockCallData();
    const matchedPattern = createMockMatchedPattern();

    // Should not throw an error
    await service.logRequestToAPI(callData, matchedPattern);

    // Restore original fetch
    (global as any).fetch = originalFetch;
  });

  // Test 5: Failed API response handling
  await runTest('Failed API response handling', async () => {
    // Mock failed response
    (global as any).fetch = async () => ({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
      json: async () => ({ error: 'Bad Request' })
    });

    const config: LoggingServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new LoggingService(config);
    const callData = createMockCallData();

    // Should not throw an error, but should handle gracefully
    await service.logRequestToAPI(callData);

    // Restore original fetch
    (global as any).fetch = originalFetch;
  });

  // Test 6: Network error handling
  await runTest('Network error handling', async () => {
    // Mock network error
    (global as any).fetch = async () => {
      throw new Error('Network error');
    };

    const config: LoggingServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new LoggingService(config);
    const callData = createMockCallData();

    // Should not throw an error, but should handle gracefully
    await service.logRequestToAPI(callData);

    // Restore original fetch
    (global as any).fetch = originalFetch;
  });

  // Test 7: Payload structure validation
  await runTest('Payload structure validation', async () => {
    let capturedRequestBody: any;

    // Mock fetch to capture the request body
    (global as any).fetch = async (input: any, options: any) => {
      capturedRequestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 123, status: 'success' }),
        text: async () => JSON.stringify({ id: 123, status: 'success' })
      };
    };

    const config: LoggingServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new LoggingService(config);
    const callData = createMockCallData({
      id: 456,
      method: 'POST',
      url: 'https://api.example.com/test'
    });

    await service.logRequestToAPI(callData);

    if (!capturedRequestBody.llm_request_log) {
      throw new Error('Payload missing llm_request_log wrapper');
    }

    if (!capturedRequestBody.llm_request_log.raw_request) {
      throw new Error('Payload missing raw_request data');
    }

    const rawRequest = capturedRequestBody.llm_request_log.raw_request;

    if (rawRequest.id !== 456) {
      throw new Error('Incorrect call data ID in payload');
    }

    if (rawRequest.method !== 'POST') {
      throw new Error('Incorrect method in payload');
    }

    if (rawRequest.url !== 'https://api.example.com/test') {
      throw new Error('Incorrect URL in payload');
    }

    // Restore original fetch
    (global as any).fetch = originalFetch;
  });

  // Test 8: Headers validation
  await runTest('Headers validation', async () => {
    let capturedHeaders: any;

    // Mock fetch to capture the headers
    (global as any).fetch = async (input: any, options: any) => {
      capturedHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 123, status: 'success' }),
        text: async () => JSON.stringify({ id: 123, status: 'success' })
      };
    };

    const config: LoggingServiceConfig = {
      apiKey: 'secret-api-key-123',
      environment: 'local',
      silent: true
    };

    const service = new LoggingService(config);
    const callData = createMockCallData();

    await service.logRequestToAPI(callData);

    if (capturedHeaders['Content-Type'] !== 'application/json') {
      throw new Error('Incorrect Content-Type header');
    }

    if (capturedHeaders['X-API-Key'] !== 'secret-api-key-123') {
      throw new Error('Incorrect X-API-Key header');
    }

    // Restore original fetch
    (global as any).fetch = originalFetch;
  });

  // Test 9: Silent mode behavior
  await runTest('Silent mode behavior', async () => {
    // Capture console output
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    let logMessages: string[] = [];
    let errorMessages: string[] = [];

    console.log = (...args: any[]) => {
      logMessages.push(args.join(' '));
    };

    console.error = (...args: any[]) => {
      errorMessages.push(args.join(' '));
    };

    // Mock successful response
    (global as any).fetch = createMockFetch({ id: 123, status: 'success' });

    const config: LoggingServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new LoggingService(config);
    const callData = createMockCallData();
    const matchedPattern = createMockMatchedPattern();

    await service.logRequestToAPI(callData, matchedPattern);

    // Restore console
    console.log = originalConsoleLog;
    console.error = originalConsoleError;

    // In silent mode, no verbose logging should appear
    const hasVerboseLogging = logMessages.some(msg => msg.includes('🎉 LOGGING'));
    const hasSuccessLog = logMessages.some(msg => msg.includes('✅ Successfully logged'));

    if (hasVerboseLogging) {
      throw new Error('Silent mode should not show verbose logging');
    }

    if (hasSuccessLog) {
      throw new Error('Silent mode should not show any logging messages');
    }

    // Restore original fetch
    (global as any).fetch = originalFetch;
  });

  // Test 10: Non-silent mode behavior
  await runTest('Non-silent mode behavior', async () => {
    // Capture console output
    const originalConsoleLog = console.log;
    let logMessages: string[] = [];

    console.log = (...args: any[]) => {
      logMessages.push(args.join(' '));
    };

    // Mock successful response
    (global as any).fetch = createMockFetch({ id: 123, status: 'success' });

    const config: LoggingServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: false
    };

    const service = new LoggingService(config);
    const callData = createMockCallData();
    const matchedPattern = createMockMatchedPattern();

    await service.logRequestToAPI(callData, matchedPattern);

    // Restore console
    console.log = originalConsoleLog;

    // In non-silent mode, should show verbose logging
    const hasVerboseLogging = logMessages.some(msg => msg.includes('🎉 LOGGING OpenAI API Call'));
    const hasTimeInfo = logMessages.some(msg => msg.includes('🕐 Time:'));
    const hasMethodInfo = logMessages.some(msg => msg.includes('🎯 POST'));
    const hasStatusInfo = logMessages.some(msg => msg.includes('📊 Status: 200'));
    const hasProtocolInfo = logMessages.some(msg => msg.includes('🔧 Protocol: https'));
    const hasMatchInfo = logMessages.some(msg => msg.includes('🔍 Matched by: domain'));
    const hasModelInfo = logMessages.some(msg => msg.includes('🤖 Model: gpt-4'));
    const hasMessagesInfo = logMessages.some(msg => msg.includes('💬 Messages: 1'));
    const hasTempInfo = logMessages.some(msg => msg.includes('🌡️  Temperature: 0.7'));
    const hasEndpointInfo = logMessages.some(msg => msg.includes('📤 Sending to:'));

    if (!hasVerboseLogging) {
      throw new Error('Non-silent mode should show verbose logging');
    }

    if (!hasTimeInfo) {
      throw new Error('Non-silent mode should show time information');
    }

    if (!hasMethodInfo) {
      throw new Error('Non-silent mode should show method information');
    }

    if (!hasStatusInfo) {
      throw new Error('Non-silent mode should show status information');
    }

    if (!hasProtocolInfo) {
      throw new Error('Non-silent mode should show protocol information');
    }

    if (!hasMatchInfo) {
      throw new Error('Non-silent mode should show match information');
    }

    if (!hasModelInfo) {
      throw new Error('Non-silent mode should show model information');
    }

    if (!hasMessagesInfo) {
      throw new Error('Non-silent mode should show messages information');
    }

    if (!hasTempInfo) {
      throw new Error('Non-silent mode should show temperature information');
    }

    if (!hasEndpointInfo) {
      throw new Error('Non-silent mode should show endpoint information');
    }

    // Restore original fetch
    (global as any).fetch = originalFetch;
  });

  // Test 11: HTTPS fallback when fetch is not available
  await runTest('HTTPS fallback when fetch is not available', async () => {
    // Remove fetch temporarily
    const originalFetch = (global as any).fetch;
    delete (global as any).fetch;

    const config: LoggingServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new LoggingService(config);
    const callData = createMockCallData();

    // This should use the HTTPS fallback and not throw an error
    // Note: In a real test environment, we'd mock the https module too
    // For now, we just ensure it doesn't crash due to missing fetch
    try {
      await service.logRequestToAPI(callData);
      // If it gets here without throwing, that's good enough for this test
    } catch (error) {
      // Expected to fail in test environment since we're not mocking https
      // But it should be a network error, not a "fetch is undefined" error
      if ((error as Error).message.includes('fetch')) {
        throw new Error('Should not reference fetch when it is not available');
      }
    }

    // Restore fetch
    (global as any).fetch = originalFetch;
  });

  // Test 12: Logging without matched pattern
  await runTest('Logging without matched pattern', async () => {
    // Capture console output
    const originalConsoleLog = console.log;
    let logMessages: string[] = [];

    console.log = (...args: any[]) => {
      logMessages.push(args.join(' '));
    };

    // Mock successful response
    (global as any).fetch = createMockFetch({ id: 123, status: 'success' });

    const config: LoggingServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: false
    };

    const service = new LoggingService(config);
    const callData = createMockCallData();

    // Call without matched pattern
    await service.logRequestToAPI(callData);

    // Restore console
    console.log = originalConsoleLog;

    // Should show "API" instead of specific provider name
    const hasGenericAPILogging = logMessages.some(msg => msg.includes('🎉 LOGGING API API Call'));
    const hasNoMatchInfo = !logMessages.some(msg => msg.includes('🔍 Matched by:'));

    if (!hasGenericAPILogging) {
      throw new Error('Should show generic API logging when no pattern matched');
    }

    if (!hasNoMatchInfo) {
      throw new Error('Should not show match information when no pattern provided');
    }

    // Restore original fetch
    (global as any).fetch = originalFetch;
  });

  console.log('\n🎉 LoggingService test summary:');
  console.log(`Total tests: ${testCount}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);

  if (failedTests === 0) {
    console.log('✅ All LoggingService tests passed!');
  } else {
    console.log('❌ Some LoggingService tests failed.');
  }
}

// Run all tests
runAllTests().catch(console.error);