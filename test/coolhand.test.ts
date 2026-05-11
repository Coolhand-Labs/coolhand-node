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

    it('should use custom baseUrl when provided', () => {
      const monitor = new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'https://feedback.example.com'
      });
      expect(monitor.getStats().apiEndpoint).toBe(
        'https://feedback.example.com/api/v2/llm_request_logs'
      );
    });

    it('should normalize trailing slash in baseUrl', () => {
      const monitor = new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'https://feedback.example.com/'
      });
      expect(monitor.getStats().apiEndpoint).toBe(
        'https://feedback.example.com/api/v2/llm_request_logs'
      );
    });

    it('should allow http://localhost for local dev', () => {
      expect(() => new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'http://localhost:3000'
      })).not.toThrow();
    });

    it('should allow http://127.0.0.1 for local dev', () => {
      const monitor = new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'http://127.0.0.1:3000'
      });
      expect(monitor.getStats().apiEndpoint).toBe(
        'http://127.0.0.1:3000/api/v2/llm_request_logs'
      );
    });

    it('should strip multiple trailing slashes from baseUrl', () => {
      const monitor = new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'https://feedback.example.com//'
      });
      expect(monitor.getStats().apiEndpoint).toBe(
        'https://feedback.example.com/api/v2/llm_request_logs'
      );
    });

    it('should use default endpoint when baseUrl is undefined', () => {
      const monitor = new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: undefined
      });
      expect(monitor.getStats().apiEndpoint).toBe(
        'https://coolhandlabs.com/api/v2/llm_request_logs'
      );
    });

    it('should POST feedback to the custom baseUrl (HTTP-layer)', async () => {
      const originalFetch = (global as any).fetch;
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 1, like: true, created_at: '', updated_at: '' }),
          text: jest.fn().mockResolvedValue('')
        };
      });

      const monitor = new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'https://self-hosted.example.com'
      });

      await monitor.createFeedback({ like: true });
      expect(capturedUrl).toBe(
        'https://self-hosted.example.com/api/v2/llm_request_log_feedbacks'
      );
      (global as any).fetch = originalFetch;
    });

    it('should reject non-https non-localhost baseUrl', () => {
      expect(() => new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'http://example.com'
      })).toThrow('baseUrl must use https://');
    });

    it('should reject hosts that only prefix-match localhost', () => {
      expect(() => new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'http://localhost.evil.com'
      })).toThrow('baseUrl must use https://');

      expect(() => new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'http://127.0.0.1.attacker.com'
      })).toThrow('baseUrl must use https://');
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
    });
  });
});