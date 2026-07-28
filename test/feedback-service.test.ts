import { FeedbackService, FeedbackServiceConfig } from '../src/services/FeedbackService';
import { HttpError } from '../src/services/BaseService';
import { LLMRequestLogFeedback, LLMRequestLogFeedbackResponse, SearchFeedbackResponse, LLMRequestLogFeedbackDetail } from '../src/types';

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

// Helper for GET-based reads (searchFeedback/getFeedback), which only read the `text()` body.
function mockGetFetch(bodyObj: any, { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}): any {
  const text = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  return jest.fn().mockResolvedValue({ ok, status, text: jest.fn().mockResolvedValue(text) });
}

describe('FeedbackService', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  describe('Constructor validation and initialization', () => {
    it('should configure with production endpoint', () => {
      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new FeedbackService(config);

      expect(service.getApiEndpoint()).toBe('https://coolhandlabs.com/api/v2/llm_request_log_feedbacks');
    });
  });

  describe('Feedback creation', () => {
    it('should successfully create feedback', async () => {
      const mockResponse: LLMRequestLogFeedbackResponse = {
        id: '123',
        llm_request_log_id: 456,
        like: true,
        explanation: 'Great response!',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z'
      };

      (global as any).fetch = createMockFetch(mockResponse);

      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new FeedbackService(config);

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        like: true,
        explanation: 'Great response!'
      };

      const result = await service.createFeedback(feedback);

      expect(result).not.toBeNull();
      expect(result!.id).toBe('123');
      expect(result!.like).toBe(true);
      expect(result!.explanation).toBe('Great response!');
    });

    it('should handle failed API response gracefully', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue('Bad Request'),
        json: jest.fn().mockResolvedValue({ error: 'Bad Request' })
      });

      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new FeedbackService(config);

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        like: true
      };

      const result = await service.createFeedback(feedback);

      expect(result).toBeNull();
    });

    it('should handle network errors gracefully', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new FeedbackService(config);

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        like: false,
        explanation: 'Poor response'
      };

      const result = await service.createFeedback(feedback);

      expect(result).toBeNull();
    });

    it('should handle missing fetch gracefully', async () => {
      const originalFetch = (global as any).fetch;
      delete (global as any).fetch;

      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new FeedbackService(config);

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        like: true
      };

      const result = await service.createFeedback(feedback);

      expect(result).toBeNull();

      (global as any).fetch = originalFetch;
    });

    it('should structure payload correctly', async () => {
      let capturedRequestBody: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, like: true }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, like: true }))
        };
      });

      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
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

      expect(capturedRequestBody.llm_request_log_feedback).toBeDefined();

      const capturedFeedback = capturedRequestBody.llm_request_log_feedback;
      expect(capturedFeedback.llm_request_log_id).toBe(456);
      expect(capturedFeedback.sentiment).toBe('like');
      expect(capturedFeedback).not.toHaveProperty('like');
      expect(capturedFeedback.explanation).toBe('Test explanation');
      expect(capturedFeedback.revised_output).toBe('Revised output');
    });

    it('sends creator_type when provided', async () => {
      let capturedRequestBody: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, like: true }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, like: true }))
        };
      });

      const service = new FeedbackService({ apiKey: 'test-api-key', silent: true });

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        explanation: 'Capability missing',
        creator_type: 'agent'
      };

      await service.createFeedback(feedback);

      expect(capturedRequestBody.llm_request_log_feedback.creator_type).toBe('agent');
    });

    it('should set correct headers', async () => {
      let capturedHeaders: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedHeaders = options.headers;
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, like: true }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, like: true }))
        };
      });

      const config: FeedbackServiceConfig = {
        apiKey: 'secret-api-key',
        silent: true
      };

      const service = new FeedbackService(config);

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        like: true
      };

      await service.createFeedback(feedback);

      expect(capturedHeaders['Content-Type']).toBe('application/json');
      expect(capturedHeaders['X-API-Key']).toBe('secret-api-key');
    });
  });

  describe('Collector field behavior', () => {
    it('should include collector field with default collection method', async () => {
      let capturedRequestBody: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, like: true }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, like: true }))
        };
      });

      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new FeedbackService(config);

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        like: true
      };

      await service.createFeedback(feedback);

      expect(capturedRequestBody.llm_request_log_feedback.collector).toBeDefined();
      expect(capturedRequestBody.llm_request_log_feedback.collector).toMatch(/^coolhand-node-/);
    });

    it('should include collector field with manual collection method', async () => {
      let capturedRequestBody: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, like: true }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, like: true }))
        };
      });

      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new FeedbackService(config);

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        like: true
      };

      await service.createFeedback(feedback, 'manual');

      expect(capturedRequestBody.llm_request_log_feedback.collector).toBeDefined();
      expect(capturedRequestBody.llm_request_log_feedback.collector).toMatch(/^coolhand-node-.*-manual$/);
    });

    it('should include collector field with global-monitoring collection method', async () => {
      let capturedRequestBody: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, like: true }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, like: true }))
        };
      });

      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new FeedbackService(config);

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        like: true
      };

      await service.createFeedback(feedback, 'global-monitoring');

      expect(capturedRequestBody.llm_request_log_feedback.collector).toBeDefined();
      expect(capturedRequestBody.llm_request_log_feedback.collector).toMatch(/^coolhand-node-.*-global-monitoring$/);
    });

    it('should include collector field with auto-monitor collection method', async () => {
      let capturedRequestBody: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, like: true }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, like: true }))
        };
      });

      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new FeedbackService(config);

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        like: true
      };

      await service.createFeedback(feedback, 'auto-monitor');

      expect(capturedRequestBody.llm_request_log_feedback.collector).toBeDefined();
      expect(capturedRequestBody.llm_request_log_feedback.collector).toMatch(/^coolhand-node-.*-auto-monitor$/);
    });

    it('should not override existing collector field in feedback', async () => {
      let capturedRequestBody: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, like: true }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, like: true }))
        };
      });

      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new FeedbackService(config);

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        like: true,
        collector: 'existing-collector-value'
      };

      await service.createFeedback(feedback, 'manual');

      // The addCollectorToData method should override the existing collector field
      expect(capturedRequestBody.llm_request_log_feedback.collector).toBeDefined();
      expect(capturedRequestBody.llm_request_log_feedback.collector).toMatch(/^coolhand-node-.*-manual$/);
      expect(capturedRequestBody.llm_request_log_feedback.collector).not.toBe('existing-collector-value');
    });

    it('should ensure collector field is in llm_request_log_feedback object, not at payload root', async () => {
      let capturedRequestBody: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, like: true }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, like: true }))
        };
      });

      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new FeedbackService(config);

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        like: true
      };

      await service.createFeedback(feedback, 'manual');

      // Ensure collector is in the feedback object
      expect(capturedRequestBody.llm_request_log_feedback.collector).toBeDefined();

      // Ensure collector is NOT at the payload root level
      expect(capturedRequestBody.collector).toBeUndefined();

      // Ensure payload structure is correct
      expect(capturedRequestBody).toHaveProperty('llm_request_log_feedback');
      expect(Object.keys(capturedRequestBody)).toEqual(['llm_request_log_feedback']);
    });
  });

  describe('Logging behavior', () => {
    it('should not output logs in silent mode', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      (global as any).fetch = createMockFetch({ id: 123, like: true });

      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new FeedbackService(config);

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        like: true,
        explanation: 'Test explanation'
      };

      await service.createFeedback(feedback);

      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).not.toContain('📝 CREATING FEEDBACK');
      expect(logCalls).not.toContain('✅ Successfully created feedback');

      consoleSpy.mockRestore();
    });

    it('should output verbose logs in non-silent mode', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      (global as any).fetch = createMockFetch({ id: 123, like: true });

      const config: FeedbackServiceConfig = {
        apiKey: 'test-api-key',
        silent: false
      };

      const service = new FeedbackService(config);

      const feedback: LLMRequestLogFeedback = {
        llm_request_log_id: 456,
        like: true,
        explanation: 'Test explanation'
      };

      await service.createFeedback(feedback);

      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('📝 CREATING FEEDBACK');
      expect(logCalls).toContain('🎭 Sentiment: like');
      expect(logCalls).toContain('💭 Explanation:');
      expect(logCalls).toContain('📤 Sending to:');
      expect(logCalls).toContain('✅ Successfully created feedback');

      consoleSpy.mockRestore();
    });
  });

  describe('like → sentiment normalization', () => {
    let capturedRequestBody: any;
    let service: FeedbackService;

    beforeEach(() => {
      (global as any).fetch = jest.fn().mockImplementation(async (_input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 1, like: true }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 1, like: true }))
        };
      });
      service = new FeedbackService({ apiKey: 'test-key', silent: true });
    });

    it('converts like:true to sentiment:"like" and strips like from payload', async () => {
      await service.createFeedback({ like: true });
      const sent = capturedRequestBody.llm_request_log_feedback;
      expect(sent.sentiment).toBe('like');
      expect(sent).not.toHaveProperty('like');
    });

    it('converts like:false to sentiment:"dislike" and strips like from payload', async () => {
      await service.createFeedback({ like: false });
      const sent = capturedRequestBody.llm_request_log_feedback;
      expect(sent.sentiment).toBe('dislike');
      expect(sent).not.toHaveProperty('like');
    });

    it('does not overwrite an explicit sentiment when like is also provided', async () => {
      await service.createFeedback({ like: false, sentiment: 'neutral' });
      expect(capturedRequestBody.llm_request_log_feedback.sentiment).toBe('neutral');
    });

    it('leaves sentiment undefined when neither like nor sentiment is provided', async () => {
      await service.createFeedback({ llm_request_log_id: 1 });
      expect(capturedRequestBody.llm_request_log_feedback.sentiment).toBeUndefined();
    });
  });

  describe('searchFeedback', () => {
    it('builds q[...] predicates, sort, and pagination as query params', async () => {
      let capturedUrl: string | undefined;
      let capturedOptions: any;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string, options: any) => {
        capturedUrl = url;
        capturedOptions = options;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify({ feedback: [], pagination: {} })) };
      });

      const service = new FeedbackService({ apiKey: 'private-key-123', silent: true });
      await service.searchFeedback({ sentiment_eq: 2, explanation_cont: 'tone', s: 'created_at desc', page: 2, per: 10 });

      const url = new URL(capturedUrl!);
      expect(url.origin + url.pathname).toBe('https://coolhandlabs.com/api/v2/llm_request_log_feedbacks');
      expect(url.searchParams.get('q[sentiment_eq]')).toBe('2');
      expect(url.searchParams.get('q[explanation_cont]')).toBe('tone');
      expect(url.searchParams.get('q[s]')).toBe('created_at desc');
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.get('per')).toBe('10');
      expect(capturedOptions.method).toBe('GET');
      expect(capturedOptions.headers['X-API-Key']).toBe('private-key-123');
    });

    it('returns the parsed feedback list and pagination on success', async () => {
      const mockResponse: SearchFeedbackResponse = {
        feedback: [{ id: '1', llm_request_log_id: 10, sentiment: 'like', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }],
        pagination: { current_page: 1, per_page: 25, total_count: 1, total_pages: 1, has_next_page: false, has_prev_page: false }
      };
      (global as any).fetch = mockGetFetch(mockResponse);

      const service = new FeedbackService({ apiKey: 'private-key-123', silent: true });
      const result = await service.searchFeedback({ page: 1 });

      expect(result).toEqual(mockResponse);
    });

    it('throws with the HTTP status on a non-ok response', async () => {
      (global as any).fetch = mockGetFetch('Key rejected', { ok: false, status: 401 });

      const service = new FeedbackService({ apiKey: 'public-key-used-by-mistake', silent: true });
      await expect(service.searchFeedback()).rejects.toMatchObject({
        status: 401,
        message: expect.stringContaining('Feedback request failed (401)')
      });
      await expect(service.searchFeedback()).rejects.toBeInstanceOf(HttpError);
    });

    it('throws a plain error on network failure', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const service = new FeedbackService({ apiKey: 'private-key-123', silent: true });
      await expect(service.searchFeedback()).rejects.toThrow('Feedback request failed: ECONNREFUSED');
    });

    it('throws when the body is not valid JSON', async () => {
      (global as any).fetch = mockGetFetch('<html>not json</html>');

      const service = new FeedbackService({ apiKey: 'private-key-123', silent: true });
      await expect(service.searchFeedback()).rejects.toThrow('Feedback response was not valid JSON');
    });
  });

  describe('getFeedback', () => {
    it('GETs the record by id with the private key as X-API-Key', async () => {
      let capturedUrl: string | undefined;
      let capturedOptions: any;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string, options: any) => {
        capturedUrl = url;
        capturedOptions = options;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify({ id: 42 })) };
      });

      const service = new FeedbackService({ apiKey: 'private-key-123', silent: true });
      await service.getFeedback('42');

      expect(capturedUrl).toBe('https://coolhandlabs.com/api/v2/llm_request_log_feedbacks/42');
      expect(capturedOptions.method).toBe('GET');
      expect(capturedOptions.headers['X-API-Key']).toBe('private-key-123');
    });

    it('returns the full record including feedback_partials on success', async () => {
      const mockResponse: LLMRequestLogFeedbackDetail = {
        id: '42',
        llm_request_log_id: 10,
        sentiment: 'like',
        original_output: 'original',
        revised_output: 'revised',
        feedback_partials: [{
          id: 'p1',
          llm_request_log_feedback_id: '42',
          client_id: 7,
          sentiment: 'like',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z'
        }],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      };
      (global as any).fetch = mockGetFetch(mockResponse);

      const service = new FeedbackService({ apiKey: 'private-key-123', silent: true });
      const result = await service.getFeedback('42');

      expect(result).toEqual(mockResponse);
    });

    it('throws with a 404 status when the record is not found', async () => {
      (global as any).fetch = mockGetFetch('Not found', { ok: false, status: 404 });

      const service = new FeedbackService({ apiKey: 'private-key-123', silent: true });
      await expect(service.getFeedback('missing')).rejects.toMatchObject({
        status: 404,
        message: expect.stringContaining('Feedback request failed (404)')
      });
    });
  });
});

