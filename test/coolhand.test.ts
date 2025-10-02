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
      expect(stats.apiEndpoint).toBe('https://coolhand.io/api/v2/llm_request_logs');
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

  describe('JSON parsing', () => {
    let monitor: Coolhand;

    beforeEach(() => {
      monitor = new Coolhand({
        apiKey: 'test-key',
        silent: true
      });
    });

    it('should parse valid JSON correctly', () => {
      const result = monitor.parseJSON('{"test": "value"}');
      expect(result).toEqual({ test: "value" });
    });

    it('should return original string for invalid JSON', () => {
      const result = monitor.parseJSON('invalid json');
      expect(result).toBe('invalid json');
    });

    it('should handle null input', () => {
      const result = monitor.parseJSON(null);
      expect(result).toBe(null);
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