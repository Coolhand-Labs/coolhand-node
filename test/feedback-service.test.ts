// test/feedback-service.test.ts - Comprehensive tests for FeedbackService

import { FeedbackService, FeedbackServiceConfig } from '../src/services/FeedbackService';
import { LLMRequestLogFeedback, LLMRequestLogFeedbackResponse } from '../src/types';

console.log('🧪 Running FeedbackService tests...\n');

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

async function runAllTests() {
  // Test 1: Constructor validation and initialization
  await runTest('Constructor validation and initialization', () => {
    const config: FeedbackServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new FeedbackService(config);

    if (service.getApiEndpoint() !== 'http://localhost:3000/api/v2/llm_request_log_feedbacks') {
      throw new Error('Local environment endpoint not set correctly');
    }

    if (service.getEnvironment() !== 'local') {
      throw new Error('Environment not set correctly');
    }
  });

  // Test 2: Production environment configuration
  await runTest('Production environment configuration', () => {
    const config: FeedbackServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'production',
      silent: true
    };

    const service = new FeedbackService(config);

    if (service.getApiEndpoint() !== 'https://coolhand.io/api/v2/llm_request_log_feedbacks') {
      throw new Error('Production environment endpoint not set correctly');
    }

    if (service.getEnvironment() !== 'production') {
      throw new Error('Environment not set correctly');
    }
  });

  // Test 3: Successful feedback creation
  await runTest('Successful feedback creation', async () => {
    // Mock successful response
    const mockResponse: LLMRequestLogFeedbackResponse = {
      id: 123,
      client_id: 1,
      llm_request_log_id: 456,
      like: true,
      explanation: 'Great response!',
      created_at: '2023-01-01T00:00:00Z',
      updated_at: '2023-01-01T00:00:00Z'
    };

    // Replace global fetch with mock
    (global as any).fetch = createMockFetch(mockResponse);

    const config: FeedbackServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new FeedbackService(config);

    const feedback: LLMRequestLogFeedback = {
      llm_request_log_id: 456,
      like: true,
      explanation: 'Great response!'
    };

    const result = await service.createFeedback(feedback);

    if (!result) {
      throw new Error('Expected successful response but got null');
    }

    if (result.id !== 123) {
      throw new Error(`Expected id 123 but got ${result.id}`);
    }

    if (result.like !== true) {
      throw new Error(`Expected like to be true but got ${result.like}`);
    }

    if (result.explanation !== 'Great response!') {
      throw new Error(`Expected explanation 'Great response!' but got '${result.explanation}'`);
    }

    // Restore original fetch
    (global as any).fetch = originalFetch;
  });

  // Test 4: Failed API response handling
  await runTest('Failed API response handling', async () => {
    // Mock failed response
    (global as any).fetch = async () => ({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
      json: async () => ({ error: 'Bad Request' })
    });

    const config: FeedbackServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new FeedbackService(config);

    const feedback: LLMRequestLogFeedback = {
      llm_request_log_id: 456,
      like: true
    };

    const result = await service.createFeedback(feedback);

    if (result !== null) {
      throw new Error('Expected null response for failed API call');
    }

    // Restore original fetch
    (global as any).fetch = originalFetch;
  });

  // Test 5: Network error handling
  await runTest('Network error handling', async () => {
    // Mock network error
    (global as any).fetch = async () => {
      throw new Error('Network error');
    };

    const config: FeedbackServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new FeedbackService(config);

    const feedback: LLMRequestLogFeedback = {
      llm_request_log_id: 456,
      like: false,
      explanation: 'Poor response'
    };

    const result = await service.createFeedback(feedback);

    if (result !== null) {
      throw new Error('Expected null response for network error');
    }

    // Restore original fetch
    (global as any).fetch = originalFetch;
  });

  // Test 6: Fetch not available handling
  await runTest('Fetch not available handling', async () => {
    // Remove fetch temporarily
    const originalFetch = (global as any).fetch;
    delete (global as any).fetch;

    const config: FeedbackServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new FeedbackService(config);

    const feedback: LLMRequestLogFeedback = {
      llm_request_log_id: 456,
      like: true
    };

    const result = await service.createFeedback(feedback);

    if (result !== null) {
      throw new Error('Expected null response when fetch is not available');
    }

    // Restore fetch
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
        json: async () => ({ id: 123, like: true }),
        text: async () => JSON.stringify({ id: 123, like: true })
      };
    };

    const config: FeedbackServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new FeedbackService(config);

    const feedback: LLMRequestLogFeedback = {
      llm_request_log_id: 456,
      like: true,
      explanation: 'Test explanation',
      revised_output: 'Revised output',
      llm_provider_unique_id: 'provider-123',
      original_output: 'Original output',
      client_unique_id: 'client-456'
    };

    await service.createFeedback(feedback);

    if (!capturedRequestBody.llm_request_log_feedback) {
      throw new Error('Payload missing llm_request_log_feedback wrapper');
    }

    const capturedFeedback = capturedRequestBody.llm_request_log_feedback;

    if (capturedFeedback.llm_request_log_id !== 456) {
      throw new Error('Incorrect llm_request_log_id in payload');
    }

    if (capturedFeedback.like !== true) {
      throw new Error('Incorrect like value in payload');
    }

    if (capturedFeedback.explanation !== 'Test explanation') {
      throw new Error('Incorrect explanation in payload');
    }

    if (capturedFeedback.revised_output !== 'Revised output') {
      throw new Error('Incorrect revised_output in payload');
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
        json: async () => ({ id: 123, like: true }),
        text: async () => JSON.stringify({ id: 123, like: true })
      };
    };

    const config: FeedbackServiceConfig = {
      apiKey: 'secret-api-key',
      environment: 'local',
      silent: true
    };

    const service = new FeedbackService(config);

    const feedback: LLMRequestLogFeedback = {
      llm_request_log_id: 456,
      like: true
    };

    await service.createFeedback(feedback);

    if (capturedHeaders['Content-Type'] !== 'application/json') {
      throw new Error('Incorrect Content-Type header');
    }

    if (capturedHeaders['X-API-Key'] !== 'secret-api-key') {
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
    (global as any).fetch = createMockFetch({ id: 123, like: true });

    const config: FeedbackServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: true
    };

    const service = new FeedbackService(config);

    const feedback: LLMRequestLogFeedback = {
      llm_request_log_id: 456,
      like: true,
      explanation: 'Test explanation'
    };

    await service.createFeedback(feedback);

    // Restore console
    console.log = originalConsoleLog;
    console.error = originalConsoleError;

    // In silent mode, no logging should appear at all
    const hasVerboseLogging = logMessages.some(msg => msg.includes('📝 CREATING FEEDBACK'));
    const hasSuccessLog = logMessages.some(msg => msg.includes('✅ Successfully created feedback'));

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
    (global as any).fetch = createMockFetch({ id: 123, like: true });

    const config: FeedbackServiceConfig = {
      apiKey: 'test-api-key',
      environment: 'local',
      silent: false
    };

    const service = new FeedbackService(config);

    const feedback: LLMRequestLogFeedback = {
      llm_request_log_id: 456,
      like: true,
      explanation: 'Test explanation'
    };

    await service.createFeedback(feedback);

    // Restore console
    console.log = originalConsoleLog;

    // In non-silent mode, should show verbose logging
    const hasVerboseLogging = logMessages.some(msg => msg.includes('📝 CREATING FEEDBACK'));
    const hasLikeInfo = logMessages.some(msg => msg.includes('👍/👎 Like: true'));
    const hasExplanationInfo = logMessages.some(msg => msg.includes('💭 Explanation:'));
    const hasEndpointInfo = logMessages.some(msg => msg.includes('📤 Sending to:'));
    const hasSuccessLog = logMessages.some(msg => msg.includes('✅ Successfully created feedback'));

    if (!hasVerboseLogging) {
      throw new Error('Non-silent mode should show verbose logging');
    }

    if (!hasLikeInfo) {
      throw new Error('Non-silent mode should show like information');
    }

    if (!hasExplanationInfo) {
      throw new Error('Non-silent mode should show explanation information');
    }

    if (!hasEndpointInfo) {
      throw new Error('Non-silent mode should show endpoint information');
    }

    if (!hasSuccessLog) {
      throw new Error('Non-silent mode should show success message');
    }

    // Restore original fetch
    (global as any).fetch = originalFetch;
  });

  console.log('\n🎉 FeedbackService test summary:');
  console.log(`Total tests: ${testCount}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${failedTests}`);

  if (failedTests === 0) {
    console.log('✅ All FeedbackService tests passed!');
  } else {
    console.log('❌ Some FeedbackService tests failed.');
  }
}

// Run all tests
runAllTests().catch(console.error);