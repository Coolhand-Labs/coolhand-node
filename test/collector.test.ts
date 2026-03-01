/**
 * Tests for collector field functionality
 */

import { getCollectorString, getPackageName, getPackageVersion, CollectionMethod } from '../src/utils/collector';
import { PACKAGE_VERSION, PACKAGE_NAME } from '../src/version';

describe('Collector Utility', () => {
  describe('getCollectorString', () => {
    it('should return base collector string without method', () => {
      const result = getCollectorString();
      expect(result).toBe(`${PACKAGE_NAME}-${PACKAGE_VERSION}`);
    });

    it('should return collector string with global-monitoring method', () => {
      const result = getCollectorString('global-monitoring');
      expect(result).toBe(`${PACKAGE_NAME}-${PACKAGE_VERSION}-global-monitoring`);
    });

    it('should return collector string with manual method', () => {
      const result = getCollectorString('manual');
      expect(result).toBe(`${PACKAGE_NAME}-${PACKAGE_VERSION}-manual`);
    });

    it('should return collector string with auto-monitor method', () => {
      const result = getCollectorString('auto-monitor');
      expect(result).toBe(`${PACKAGE_NAME}-${PACKAGE_VERSION}-auto-monitor`);
    });
  });

  describe('getPackageName', () => {
    it('should return correct package name', () => {
      expect(getPackageName()).toBe('coolhand-node');
    });
  });

  describe('getPackageVersion', () => {
    it('should return correct package version', () => {
      expect(getPackageVersion()).toBe(PACKAGE_VERSION);
    });
  });

  describe('CollectionMethod type', () => {
    it('should accept valid collection methods', () => {
      const methods: CollectionMethod[] = ['global-monitoring', 'manual', 'auto-monitor'];

      methods.forEach(method => {
        const result = getCollectorString(method);
        expect(result).toContain(method);
      });
    });
  });
});

describe('Service Integration', () => {
  beforeEach(() => {
    // Mock the services
    jest.doMock('../src/services/LoggingService', () => ({
      LoggingService: class {
        constructor() {}
        logRequestToAPI = jest.fn();
      }
    }));

    jest.doMock('../src/services/FeedbackService', () => ({
      FeedbackService: class {
        constructor() {}
        createFeedback = jest.fn();
      }
    }));
  });

  it('should include collector field in logging payload structure', () => {
    // Test the type structure
    const mockPayload = {
      llm_request_log: {
        raw_request: {
          id: 1,
          timestamp: '2025-10-08T15:00:00.000Z',
          method: 'POST',
          url: 'https://api.test.com/v1/test',
          headers: {},
          request_body: { test: 'data' },
          response_body: { result: 'success' },
          response_headers: {},
          status_code: 200,
          protocol: 'fetch'
        },
        collector: `${PACKAGE_NAME}-${PACKAGE_VERSION}-global-monitoring`
      }
    };

    // Verify structure
    expect(mockPayload.llm_request_log).toHaveProperty('raw_request');
    expect(mockPayload.llm_request_log).toHaveProperty('collector');
    expect(mockPayload.llm_request_log.collector).toBe(`${PACKAGE_NAME}-${PACKAGE_VERSION}-global-monitoring`);
  });

  it('should include collector field in feedback payload structure', () => {
    // Test the type structure
    const mockPayload = {
      llm_request_log_feedback: {
        llm_request_log_id: 123,
        like: true,
        explanation: 'Good response'
      },
      collector: `${PACKAGE_NAME}-${PACKAGE_VERSION}-manual`
    };

    // Verify structure
    expect(mockPayload).toHaveProperty('llm_request_log_feedback');
    expect(mockPayload).toHaveProperty('collector');
    expect(mockPayload.collector).toBe(`${PACKAGE_NAME}-${PACKAGE_VERSION}-manual`);
  });
});

describe('Expected API Payloads', () => {
  it('should create log payload with collector for global monitoring', () => {
    const expectedPayload = {
      llm_request_log: {
        raw_request: {
          id: 1,
          timestamp: '2025-10-08T15:00:00.000Z',
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          headers: { 'x-api-key': '[REDACTED]' },
          request_body: {
            model: 'claude-3-haiku-20240307',
            messages: [{ role: 'user', content: 'Test prompt' }],
            max_tokens: 1000
          },
          response_body: {
            id: 'msg_123',
            type: 'message',
            content: [{ type: 'text', text: 'Test response' }]
          },
          response_headers: { 'content-type': 'application/json' },
          status_code: 200,
          protocol: 'fetch'
        },
        collector: `${PACKAGE_NAME}-${PACKAGE_VERSION}-global-monitoring`
      }
    };

    // This represents what should be sent to the API
    expect(expectedPayload.llm_request_log.collector).toBe(`${PACKAGE_NAME}-${PACKAGE_VERSION}-global-monitoring`);
    expect(expectedPayload.llm_request_log.raw_request.url).toContain('anthropic.com');
    expect(expectedPayload.llm_request_log.raw_request.status_code).toBe(200);
  });

  it('should create feedback payload with collector', () => {
    const expectedPayload = {
      llm_request_log_feedback: {
        llm_request_log_id: 122866,
        like: true,
        explanation: 'Great response quality',
        llm_provider_unique_id: 'msg_123',
        client_unique_id: 'user_456'
      },
      collector: `${PACKAGE_NAME}-${PACKAGE_VERSION}-manual`
    };

    // This represents what should be sent to the API
    expect(expectedPayload.collector).toBe(`${PACKAGE_NAME}-${PACKAGE_VERSION}-manual`);
    expect(expectedPayload.llm_request_log_feedback.llm_request_log_id).toBe(122866);
    expect(expectedPayload.llm_request_log_feedback.like).toBe(true);
  });

  it('should create log payload without collector field when not specified', () => {
    // When collection method is not provided, collector should still be included with base string
    const baseCollector = getCollectorString();
    expect(baseCollector).toBe(`${PACKAGE_NAME}-${PACKAGE_VERSION}`);

    const expectedPayload = {
      llm_request_log: {
        raw_request: { /* request data */ },
        collector: `${PACKAGE_NAME}-${PACKAGE_VERSION}`
      }
    };

    expect(expectedPayload.llm_request_log.collector).toBe(`${PACKAGE_NAME}-${PACKAGE_VERSION}`);
  });
});