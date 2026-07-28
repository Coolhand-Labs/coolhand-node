import { Coolhand, CoolhandOptions } from '../src/index';

describe('Coolhand Node Monitor', () => {
  describe('Constructor validation', () => {
    it('should throw error for missing API key', () => {
      expect(() => {
        new Coolhand({} as CoolhandOptions);
      }).toThrow('API key is required');
    });

    it('should initialize successfully with valid options', () => {
      const monitor = new Coolhand({
        apiKey: 'test-key',
        silent: true
      });

      const stats = monitor.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.interceptedCalls).toBe(0);
    });
  });

  describe('API configuration', () => {
    it('should use production endpoint', () => {
      const monitor = new Coolhand({
        apiKey: 'test-key',
        silent: true
      });

      const stats = monitor.getStats();
      expect(stats.apiEndpoint).toBe('https://coolhandlabs.com/api/v2/llm_request_logs');
    });
  });

  describe('Header sanitization', () => {
    let monitor: Coolhand;

    beforeEach(() => {
      monitor = new Coolhand({
        apiKey: 'test-key',
        silent: true
      });
    });

    it('should sanitize headers with pattern-based redaction', () => {
      const openaiPattern = {
        name: "OpenAI",
        domains: ["openai.com", "api.openai.com"],
        paths: ["/v1/chat/completions", "/v1/completions", "/v1/embeddings"],
        headers: {
          "authorization": "[REDACTED]",
          "openai-api-key": "[REDACTED]"
        }
      };

      const sanitized = monitor.sanitizeHeaders({
        'authorization': 'Bearer sk-abc123xyz',
        'openai-api-key': 'sk-secret',
        'x-api-key': 'anthropic-key-123',
        'content-type': 'application/json'
      }, openaiPattern);

      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized['openai-api-key']).toBe('[REDACTED]');
      expect(sanitized['content-type']).toBe('application/json');
    });
  });

  describe('API Pattern loading', () => {
    it('should load API patterns successfully', () => {
      expect(() => {
        new Coolhand({
          apiKey: 'test-key',
          silent: true
        });
      }).not.toThrow();
    });

    it('should handle missing custom patterns file gracefully', () => {
      expect(() => {
        new Coolhand({
          apiKey: 'test-key',
          silent: true,
          patternsFile: './non-existent-file.json'
        });
      }).not.toThrow();
    });
  });

  describe('FeedbackService integration', () => {
    it('should integrate FeedbackService functionality', () => {
      const monitor = new Coolhand({
        apiKey: 'test-key',
        silent: true
      });

      expect(typeof monitor.createFeedback).toBe('function');
      expect(typeof monitor.searchFeedback).toBe('function');
      expect(typeof monitor.getFeedback).toBe('function');
    });
  });

  describe('searchFeedback / getFeedback', () => {
    const savedFetch = (global as any).fetch;

    afterEach(() => {
      (global as any).fetch = savedFetch;
    });

    it('delegates searchFeedback to FeedbackService with the configured private key', async () => {
      let capturedUrl: string | undefined;
      let capturedOptions: any;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string, options: any) => {
        capturedUrl = url;
        capturedOptions = options;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify({ feedback: [], pagination: {} })) };
      });

      const monitor = new Coolhand({ apiKey: 'private-key-123', silent: true });
      const result = await monitor.searchFeedback({ sentiment_eq: 2, page: 1 });

      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('q[sentiment_eq]')).toBe('2');
      expect(url.searchParams.get('page')).toBe('1');
      expect(capturedOptions.headers['X-API-Key']).toBe('private-key-123');
      expect(result).toEqual({ feedback: [], pagination: {} });
    });

    it('delegates getFeedback to FeedbackService with the configured private key', async () => {
      let capturedUrl: string | undefined;
      let capturedOptions: any;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string, options: any) => {
        capturedUrl = url;
        capturedOptions = options;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify({ id: '42' })) };
      });

      const monitor = new Coolhand({ apiKey: 'private-key-123', silent: true });
      const result = await monitor.getFeedback('42');

      expect(capturedUrl).toBe('https://coolhandlabs.com/api/v2/llm_request_log_feedbacks/42');
      expect(capturedOptions.headers['X-API-Key']).toBe('private-key-123');
      expect(result).toEqual({ id: '42' });
    });
  });

  describe('logRequest', () => {
    const savedFetch = (global as any).fetch;

    afterEach(() => {
      (global as any).fetch = savedFetch;
    });

    function buildRawRequest() {
      return {
        id: 1,
        timestamp: '2026-06-02T00:00:00Z',
        method: 'POST',
        url: 'claudecode://session/abc/req_123',
        headers: {},
        request_body: { model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'Hi' }] },
        response_body: {
          id: 'req_123',
          model: 'claude-opus-4-8',
          content: [{ type: 'text', text: 'Hello' }],
          usage: { input_tokens: 5, output_tokens: 2 }
        },
        response_headers: null,
        status_code: 200,
        protocol: 'claudecode'
      };
    }

    function mockFetch(capture: { body?: any }, response: any) {
      (global as any).fetch = jest.fn().mockImplementation(async (_input: any, options: any) => {
        capture.body = JSON.parse(options.body);
        return {
          ok: true,
          status: 201,
          json: jest.fn().mockResolvedValue(response),
          text: jest.fn().mockResolvedValue('')
        };
      });
    }

    it('submits the raw request and returns the API response', async () => {
      const capture: { body?: any } = {};
      mockFetch(capture, { id: 42, source_api: 'claude_code', warnings: [] });

      const monitor = new Coolhand({ apiKey: 'test-key', silent: true });
      const result = await monitor.logRequest(buildRawRequest() as any);

      expect(capture.body.llm_request_log.raw_request.url).toBe('claudecode://session/abc/req_123');
      expect(result).toEqual({ id: 42, source_api: 'claude_code', warnings: [] });
    });

    it('uses an explicit collector when provided', async () => {
      const capture: { body?: any } = {};
      mockFetch(capture, { id: 1 });

      const monitor = new Coolhand({ apiKey: 'test-key', silent: true });
      await monitor.logRequest(buildRawRequest() as any, { collector: 'coolhand-cli/claude-code' });

      expect(capture.body.llm_request_log.collector).toBe('coolhand-cli/claude-code');
    });

    it('defaults the collector to the SDK string when none is given', async () => {
      const capture: { body?: any } = {};
      mockFetch(capture, { id: 1 });

      const monitor = new Coolhand({ apiKey: 'test-key', silent: true });
      await monitor.logRequest(buildRawRequest() as any);

      expect(capture.body.llm_request_log.collector).toContain('coolhand-node');
      expect(capture.body.llm_request_log.collector).toContain('manual');
    });
  });
});