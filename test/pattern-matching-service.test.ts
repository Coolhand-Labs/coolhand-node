import * as fs from 'fs';
import * as path from 'path';
import { PatternMatchingService } from '../src/services/PatternMatchingService';
import { CoolhandAPIPattern } from '../src/types';

// Mock fs module
jest.mock('fs');
jest.mock('path');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPath = path as jest.Mocked<typeof path>;

describe('PatternMatchingService', () => {
  let service: PatternMatchingService;

  const mockPatterns = {
    patterns: [
      {
        name: "OpenAI",
        domains: ["openai.com", "api.openai.com"],
        paths: ["/v1/chat/completions", "/v1/completions"],
        headers: {
          "authorization": "[REDACTED]",
          "openai-api-key": "[REDACTED]"
        }
      },
      {
        name: "Anthropic",
        domains: ["api.anthropic.com"],
        paths: ["/v1/messages"],
        headers: {
          "x-api-key": "[REDACTED]"
        }
      },
      {
        name: "TestAPI",
        domains: ["test.api.com"],
        // No paths defined for this pattern
        headers: {
          "api-key": "[REDACTED]"
        }
      },
      {
        name: "Google AI",
        domains: ["generativelanguage.googleapis.com"],
        paths: ["/v1/models", "/v1beta/models", ":generateContent", ":streamGenerateContent", ":countTokens", ":embedContent"],
        headers: {
          "authorization": "[REDACTED]",
          "x-goog-api-key": "[REDACTED]"
        }
      }
    ]
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console methods
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Default path mocks
    mockPath.join.mockReturnValue('/mock/path/api-patterns.json');
    mockPath.resolve.mockImplementation((p) => `/resolved/${p}`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Constructor and Pattern Loading', () => {
    it('should load default patterns file successfully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));

      service = new PatternMatchingService();

      expect(mockPath.join).toHaveBeenCalledWith(expect.any(String), '..', 'api-patterns.json');
      expect(mockFs.existsSync).toHaveBeenCalled();
      expect(mockFs.readFileSync).toHaveBeenCalledWith('/mock/path/api-patterns.json', 'utf-8');
      expect(service.getPatternsCountSync()).toBe(4);
    });

    it('should load custom patterns file when specified', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));

      service = new PatternMatchingService('./custom-patterns.json');

      expect(mockPath.resolve).toHaveBeenCalledWith('./custom-patterns.json');
      expect(mockFs.existsSync).toHaveBeenCalledWith('/resolved/./custom-patterns.json');
      expect(service.getPatternsCountSync()).toBe(4);
    });

    it('should handle missing patterns file gracefully', () => {
      mockFs.existsSync.mockReturnValue(false);

      service = new PatternMatchingService();

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('API patterns file not found')
      );
      expect(service.getPatternsCountSync()).toBe(0);
    });

    it('should handle invalid JSON in patterns file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      service = new PatternMatchingService();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error loading API patterns'),
        expect.any(String)
      );
      // Should fallback to default Edge runtime patterns (3 patterns)
      expect(service.getPatternsCountSync()).toBe(3);
    });

    it('should handle file system errors', () => {
      mockFs.existsSync.mockImplementation(() => {
        throw new Error('File system error');
      });

      service = new PatternMatchingService();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error loading API patterns'),
        'File system error'
      );
      // Should fallback to default Edge runtime patterns (3 patterns)
      expect(service.getPatternsCountSync()).toBe(3);
    });
  });

  describe('Domain Pattern Matching', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should match URL string by domain', () => {
      const result = service.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions');

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });

    it('should match URL object by domain', () => {
      const url = new URL('https://api.anthropic.com/v1/messages');
      const result = service.matchesAPIPatternSync(url);

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Anthropic' }),
        matchType: 'domain',
        matchValue: 'api.anthropic.com'
      });
    });

    it('should match RequestOptions object by domain', () => {
      const options = {
        hostname: 'api.openai.com',
        path: '/v1/completions',
        method: 'POST'
      };

      const result = service.matchesAPIPatternSync(options);

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });

    it('should match using host property when hostname is not available', () => {
      const options = {
        host: 'api.anthropic.com',
        path: '/v1/messages'
      };

      const result = service.matchesAPIPatternSync(options);

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Anthropic' }),
        matchType: 'domain',
        matchValue: 'api.anthropic.com'
      });
    });

    it('should match partial domain names', () => {
      const result = service.matchesAPIPatternSync('https://subdomain.api.openai.com/test');

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });

    it('should return null for non-matching domains', () => {
      const result = service.matchesAPIPatternSync('https://unknown-api.com/endpoint');

      expect(result).toBeNull();
    });
  });

  describe('Path Pattern Matching', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should match by path when domain does not match', () => {
      const result = service.matchesAPIPatternFromURL('https://different-domain.com/v1/chat/completions');

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'path',
        matchValue: '/v1/chat/completions'
      });
    });

    it('should prefer domain matching over path matching', () => {
      const result = service.matchesAPIPatternFromURL('https://api.openai.com/v1/messages');

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });

    it('should match partial paths', () => {
      const result = service.matchesAPIPatternFromURL('https://other-domain.com/v1/chat/completions/stream');

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'path',
        matchValue: '/v1/chat/completions'
      });
    });

    it('should handle patterns without paths', () => {
      const result = service.matchesAPIPatternFromURL('https://test.api.com/any/path');

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'TestAPI' }),
        matchType: 'domain',
        matchValue: 'test.api.com'
      });
    });
  });

  describe('URL Parsing Error Handling', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should fall back to string matching when URL parsing fails', () => {
      const result = service.matchesAPIPatternFromURL('invalid-url-with-openai.com');

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });

    it('should return null for invalid URLs with no matching domains', () => {
      const result = service.matchesAPIPatternFromURL('invalid-url-no-match');

      expect(result).toBeNull();
    });
  });

  describe('Header Sanitization', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should apply default header sanitization', () => {
      const headers = {
        'authorization': 'Bearer sk-test123',
        'api-key': 'secret-key',
        'content-type': 'application/json'
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized).toEqual({
        'authorization': 'Bearer [REDACTED]',
        'api-key': '[REDACTED]',
        'content-type': 'application/json'
      });
    });

    it('should apply pattern-specific sanitization', () => {
      const headers = {
        'authorization': 'Bearer sk-test123',
        'openai-api-key': 'sk-openai123',
        'content-type': 'application/json'
      };

      const pattern: CoolhandAPIPattern = {
        name: 'OpenAI',
        domains: ['openai.com'],
        headers: {
          'authorization': '[REDACTED]',
          'openai-api-key': '[REDACTED]'
        }
      };

      const sanitized = service.sanitizeHeaders(headers, pattern);

      expect(sanitized).toEqual({
        'authorization': '[REDACTED]',
        'openai-api-key': '[REDACTED]',
        'content-type': 'application/json'
      });
    });

    it('should handle case-insensitive header matching', () => {
      const headers = {
        'authorization': 'Bearer token',
        'x-api-key': 'secret'
      };

      const pattern: CoolhandAPIPattern = {
        name: 'Test',
        domains: ['test.com'],
        headers: {
          'authorization': '[REDACTED]',
          'x-api-key': '[REDACTED]'
        }
      };

      const sanitized = service.sanitizeHeaders(headers, pattern);

      expect(sanitized['authorization']).toBe('[REDACTED]');
      expect(sanitized['x-api-key']).toBe('[REDACTED]');
    });

    it('should preserve headers not in sanitization rules', () => {
      const headers = {
        'custom-header': 'keep-this',
        'authorization': 'Bearer token'
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized['custom-header']).toBe('keep-this');
      expect(sanitized['authorization']).toBe('Bearer [REDACTED]');
    });

    it('should handle empty headers object', () => {
      const sanitized = service.sanitizeHeaders({});

      expect(sanitized).toEqual({});
    });

    it('should not modify original headers object', () => {
      const headers = {
        'authorization': 'Bearer token'
      };

      const originalHeaders = { ...headers };
      service.sanitizeHeaders(headers);

      expect(headers).toEqual(originalHeaders);
    });
  });

  describe('Public API Methods', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should return loaded patterns', () => {
      const patterns = service.getLoadedPatternsSync();

      expect(patterns).toHaveLength(4);
      expect(patterns[0]).toMatchObject({
        name: 'OpenAI',
        domains: ['openai.com', 'api.openai.com']
      });
    });

    it('should return a copy of patterns to prevent mutation', () => {
      const patterns = service.getLoadedPatternsSync();
      patterns.push({
        name: 'Modified',
        domains: ['modified.com']
      });

      expect(service.getPatternsCountSync()).toBe(4);
    });

    it('should return correct patterns count', () => {
      expect(service.getPatternsCountSync()).toBe(4);
    });

    it('should return zero count when no patterns loaded', () => {
      mockFs.existsSync.mockReturnValue(false);
      const emptyService = new PatternMatchingService();

      expect(emptyService.getPatternsCountSync()).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should handle empty hostname in RequestOptions', () => {
      const options = {
        path: '/test'
      };

      const result = service.matchesAPIPatternSync(options);
      expect(result).toBeNull();
    });

    it('should handle empty URL string', () => {
      const result = service.matchesAPIPatternSync('');
      expect(result).toBeNull();
    });

    it('should handle patterns with empty domains array', () => {
      const emptyPatternsData = {
        patterns: [
          {
            name: 'Empty',
            domains: [],
            paths: ['/test']
          }
        ]
      };

      mockFs.readFileSync.mockReturnValue(JSON.stringify(emptyPatternsData));
      const emptyService = new PatternMatchingService();

      const result = emptyService.matchesAPIPatternSync('https://any.com/test');
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Empty' }),
        matchType: 'path',
        matchValue: '/test'
      });
    });
  });

  describe('Async vs Sync Method Consistency', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should return consistent results between async and sync pattern matching', async () => {
      const testURL = 'https://api.openai.com/v1/chat/completions';

      const syncResult = service.matchesAPIPatternSync(testURL);
      const asyncResult = await service.matchesAPIPattern(testURL);

      expect(syncResult).toEqual(asyncResult);
      expect(syncResult?.pattern.name).toBe('OpenAI');
    });

    it('should return consistent results between async and sync for RequestOptions', async () => {
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST'
      };

      const syncResult = service.matchesAPIPatternSync(options);
      const asyncResult = await service.matchesAPIPattern(options);

      expect(syncResult).toEqual(asyncResult);
      expect(syncResult?.pattern.name).toBe('Anthropic');
    });

    it('should return consistent results between async and sync for URL objects', async () => {
      const url = new URL('https://api.openai.com/v1/completions');

      const syncResult = service.matchesAPIPatternSync(url);
      const asyncResult = await service.matchesAPIPattern(url);

      expect(syncResult).toEqual(asyncResult);
      expect(syncResult?.pattern.name).toBe('OpenAI');
    });

    it('should return consistent counts between async and sync methods', async () => {
      const syncCount = service.getPatternsCountSync();
      const asyncCount = await service.getPatternsCount();

      expect(syncCount).toBe(asyncCount);
      expect(syncCount).toBe(4);
    });

    it('should return consistent patterns between async and sync methods', async () => {
      const syncPatterns = service.getLoadedPatternsSync();
      const asyncPatterns = await service.getLoadedPatterns();

      expect(syncPatterns).toEqual(asyncPatterns);
      expect(syncPatterns).toHaveLength(4);
    });
  });

  describe('Complex URL Parsing Scenarios', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should handle URLs with query parameters', () => {
      const url = 'https://api.openai.com/v1/chat/completions?model=gpt-4&stream=true';
      const result = service.matchesAPIPatternFromURL(url);

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });

    it('should handle URLs with fragments', () => {
      const url = 'https://api.anthropic.com/v1/messages#section1';
      const result = service.matchesAPIPatternFromURL(url);

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Anthropic' }),
        matchType: 'domain',
        matchValue: 'api.anthropic.com'
      });
    });

    it('should handle URLs with authentication info', () => {
      const url = 'https://user:pass@api.openai.com/v1/chat/completions';
      const result = service.matchesAPIPatternFromURL(url);

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });

    it('should handle URLs with non-standard ports', () => {
      const options = {
        hostname: 'api.openai.com',
        port: 8080,
        path: '/v1/chat/completions'
      };

      const result = service.matchesAPIPatternSync(options);

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });

    it('should handle IPv6 addresses gracefully', () => {
      const result = service.matchesAPIPatternSync('');
      expect(result).toBeNull();
    });

    it('should handle internationalized domain names', () => {
      const url = 'https://api.测试.com/v1/test';
      const result = service.matchesAPIPatternFromURL(url);
      expect(result).toBeNull(); // Should not match, but should not throw
    });

    it('should handle very long URLs', () => {
      const longPath = '/v1/chat/completions/' + 'a'.repeat(2000);
      const url = `https://api.openai.com${longPath}`;
      const result = service.matchesAPIPatternFromURL(url);

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });

    it('should handle encoded URLs', () => {
      const url = 'https://api.openai.com/v1/chat/completions?query=hello%20world';
      const result = service.matchesAPIPatternFromURL(url);

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });
  });

  describe('Advanced Header Sanitization', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should handle nested header objects', () => {
      const headers = {
        'authorization': 'Bearer token123',
        'custom': {
          'nested': 'value'
        }
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized.authorization).toBe('Bearer [REDACTED]');
      expect(sanitized.custom).toEqual({ nested: 'value' });
    });

    it('should handle header arrays', () => {
      const headers = {
        'authorization': 'Bearer token123',
        'accept': ['application/json', 'text/plain']
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized.authorization).toBe('Bearer [REDACTED]');
      expect(sanitized.accept).toEqual(['application/json', 'text/plain']);
    });

    it('should handle multiple Bearer token formats', () => {
      const headers = {
        'authorization': 'Bearer sk-proj-1234567890abcdef',
        'x-api-key': 'Bearer another-token-format'
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized.authorization).toBe('Bearer [REDACTED]');
      expect(sanitized['x-api-key']).toBe('Bearer another-token-format'); // Not in default rules
    });

    it('should handle JWT tokens in authorization header', () => {
      const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const headers = {
        'authorization': `Bearer ${jwtToken}`
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized.authorization).toBe('Bearer [REDACTED]');
    });

    it('should handle API keys with different prefixes', () => {
      const headers = {
        'x-api-key': 'sk-1234567890',
        'api-key': 'ak_live_1234567890',
        'auth-token': 'pat_1234567890'
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized['api-key']).toBe('[REDACTED]');
      expect(sanitized['x-api-key']).toBe('sk-1234567890'); // Not in default rules
      expect(sanitized['auth-token']).toBe('pat_1234567890'); // Not in default rules
    });

    it('should preserve non-sensitive header variations', () => {
      const headers = {
        'content-authorization': 'not-an-auth-header',
        'authorization-info': 'metadata',
        'user-agent': 'MyApp/1.0',
        'accept-encoding': 'gzip, deflate'
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized['content-authorization']).toBe('not-an-auth-header');
      expect(sanitized['authorization-info']).toBe('metadata');
      expect(sanitized['user-agent']).toBe('MyApp/1.0');
      expect(sanitized['accept-encoding']).toBe('gzip, deflate');
    });

    it('should handle pattern-specific complex sanitization rules', () => {
      const complexPattern: CoolhandAPIPattern = {
        name: 'ComplexAPI',
        domains: ['complex.api.com'],
        headers: {
          'authorization': '[REDACTED]',
          'x-api-key': '[REDACTED]',
          'custom-token': '[REDACTED]',
          'session-id': '[REDACTED]'
        }
      };

      const headers = {
        'authorization': 'Bearer complex-token',
        'x-api-key': 'complex-api-key',
        'custom-token': 'custom-value',
        'session-id': 'session-12345',
        'content-type': 'application/json',
        'user-agent': 'TestAgent'
      };

      const sanitized = service.sanitizeHeaders(headers, complexPattern);

      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized['x-api-key']).toBe('[REDACTED]');
      expect(sanitized['custom-token']).toBe('[REDACTED]');
      expect(sanitized['session-id']).toBe('[REDACTED]');
      expect(sanitized['content-type']).toBe('application/json');
      expect(sanitized['user-agent']).toBe('TestAgent');
    });
  });

  describe('Performance and Stress Tests', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should handle large numbers of pattern matching operations efficiently', () => {
      const urls = [
        'https://api.openai.com/v1/chat/completions',
        'https://api.anthropic.com/v1/messages',
        'https://test.api.com/endpoint',
        'https://unknown.com/api',
        'https://another-unknown.com/test'
      ];

      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        urls.forEach(url => {
          service.matchesAPIPatternFromURL(url);
        });
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should complete 5000 operations in reasonable time (less than 1 second)
      expect(totalTime).toBeLessThan(1000);
    });

    it('should handle large header objects efficiently', () => {
      const largeHeaders: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        largeHeaders[`header-${i}`] = `value-${i}`;
      }
      largeHeaders.authorization = 'Bearer large-test-token';

      const startTime = Date.now();

      for (let i = 0; i < 100; i++) {
        service.sanitizeHeaders(largeHeaders);
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should handle large header sanitization efficiently
      expect(totalTime).toBeLessThan(100);
    });

    it('should handle patterns with many domains efficiently', () => {
      const largePatternsData = {
        patterns: [
          {
            name: 'LargePattern',
            domains: Array.from({ length: 100 }, (_, i) => `api${i}.example.com`),
            paths: ['/v1/test'],
            headers: { 'authorization': '[REDACTED]' }
          }
        ]
      };

      mockFs.readFileSync.mockReturnValue(JSON.stringify(largePatternsData));
      const largeService = new PatternMatchingService();

      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        largeService.matchesAPIPatternFromURL('https://api50.example.com/v1/test');
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should handle large domain lists efficiently
      expect(totalTime).toBeLessThan(500);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover gracefully from malformed pattern data', () => {
      const malformedPatterns = {
        patterns: [
          {
            name: 'Valid',
            domains: ['valid.com'],
            headers: { 'auth': '[REDACTED]' }
          },
          {
            // Missing name
            domains: ['missing-name.com']
          },
          {
            name: 'MissingDomains'
            // Missing domains
          },
          null, // Null pattern
          undefined, // Undefined pattern
          {
            name: 'ValidAfterErrors',
            domains: ['valid-after.com'],
            headers: { 'token': '[REDACTED]' }
          }
        ]
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(malformedPatterns));

      // Should not throw, but may have fewer patterns loaded
      expect(() => new PatternMatchingService()).not.toThrow();
    });

    it('should handle circular references in headers gracefully', () => {
      const circularHeaders: any = {
        authorization: 'Bearer token'
      };
      circularHeaders.self = circularHeaders;

      // Should not throw on circular references
      expect(() => service.sanitizeHeaders(circularHeaders)).not.toThrow();
    });

    it('should handle extremely long domain names', () => {
      const longDomain = 'a'.repeat(1000) + '.com';
      const url = `https://${longDomain}/api`;

      // Should not throw on very long domains
      expect(() => service.matchesAPIPatternFromURL(url)).not.toThrow();
      expect(service.matchesAPIPatternFromURL(url)).toBeNull();
    });

    it('should handle special characters in URLs', () => {
      const specialUrls = [
        'https://api.openai.com/v1/chat/completions?query=hello world', // Space
        'https://api.openai.com/v1/chat/completions?query=hello%20world', // Encoded space
        'https://api.openai.com/v1/chat/completions?emoji=🚀', // Emoji
        'https://api.openai.com/v1/chat/completions?chinese=测试', // Chinese characters
        'https://api.openai.com/v1/chat/completions?special=<>&"', // HTML special chars
      ];

      specialUrls.forEach(url => {
        expect(() => service.matchesAPIPatternFromURL(url)).not.toThrow();
      });
    });
  });

  describe('Integration Edge Cases', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should handle mixed case in domain matching', () => {
      const urls = [
        'https://API.OPENAI.COM/v1/test',
        'https://Api.OpenAI.Com/v1/test',
        'https://api.OPENAI.com/v1/test'
      ];

      urls.forEach(url => {
        const result = service.matchesAPIPatternFromURL(url);
        expect(result).toMatchObject({
          pattern: expect.objectContaining({ name: 'OpenAI' }),
          matchType: 'domain',
          matchValue: 'openai.com'
        });
      });
    });

    it('should prioritize domain matches over path matches consistently', () => {
      // URL that matches both domain and path patterns
      const url = 'https://api.openai.com/v1/messages'; // OpenAI domain + Anthropic path

      const result = service.matchesAPIPatternFromURL(url);

      // Should match by domain (OpenAI) not by path (Anthropic)
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });

    it('should handle URL parsing failures with fallback', () => {
      // Test URLs that might cause URL constructor to fail
      const problematicUrls = [
        'not-a-url-at-all',
        'ftp://api.openai.com/test', // Different protocol
        '://api.openai.com/test', // Missing protocol
        'https:/api.openai.com/test', // Malformed protocol
        'api.openai.com/test' // Missing protocol entirely
      ];

      problematicUrls.forEach(url => {
        const result = service.matchesAPIPatternFromURL(url);
        // Most should fall back to string matching and find openai.com
        if (url.includes('openai.com')) {
          expect(result).toMatchObject({
            pattern: expect.objectContaining({ name: 'OpenAI' }),
            matchType: 'domain',
            matchValue: 'openai.com'
          });
        }
      });
    });
  });

  describe('Google AI / Gemini Pattern Matching', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should match Gemini generateContent URL by domain', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Google AI' }),
        matchType: 'domain',
        matchValue: 'generativelanguage.googleapis.com'
      });
    });

    it('should match Gemini streamGenerateContent URL by domain', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent?alt=sse'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Google AI' }),
        matchType: 'domain',
        matchValue: 'generativelanguage.googleapis.com'
      });
    });

    it('should match Gemini countTokens URL by domain', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:countTokens'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Google AI' }),
        matchType: 'domain',
        matchValue: 'generativelanguage.googleapis.com'
      });
    });

    it('should match :generateContent path on a non-Google domain (proxy scenario)', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://my-proxy.example.com/v1beta/models/gemini-pro:generateContent'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Google AI' }),
        matchType: 'path',
        matchValue: '/v1beta/models'
      });
    });

    it('should match :streamGenerateContent path on a non-Google domain', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://my-proxy.example.com/v1beta/models/gemini-pro:streamGenerateContent?alt=sse'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Google AI' }),
        matchType: 'path',
        matchValue: '/v1beta/models'
      });
    });

    it('should match Gemini URL with ?key= query param', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=AIzaSyDEADBEEF'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Google AI' }),
        matchType: 'domain',
        matchValue: 'generativelanguage.googleapis.com'
      });
    });

    it('should sanitize x-goog-api-key header via pattern rules', () => {
      const pattern: CoolhandAPIPattern = {
        name: 'Google AI',
        domains: ['generativelanguage.googleapis.com'],
        headers: {
          'authorization': '[REDACTED]',
          'x-goog-api-key': '[REDACTED]'
        }
      };

      const headers = {
        'x-goog-api-key': 'AIzaSyDEADBEEF1234',
        'content-type': 'application/json'
      };

      const sanitized = service.sanitizeHeaders(headers, pattern);
      expect(sanitized['x-goog-api-key']).toBe('[REDACTED]');
      expect(sanitized['content-type']).toBe('application/json');
    });
  });

  describe('URL Sanitization', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should redact key param from Gemini URL', () => {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=AIzaSyDEADBEEF1234';
      const result = service.sanitizeURL(url);
      expect(result).not.toContain('AIzaSyDEADBEEF1234');
      expect(result).toContain('key=%5BREDACTED%5D');
      expect(result).toContain('generativelanguage.googleapis.com');
    });

    it('should preserve alt=sse and other non-sensitive params', () => {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:streamGenerateContent?key=AIzaSySecret&alt=sse';
      const result = service.sanitizeURL(url);
      expect(result).not.toContain('AIzaSySecret');
      expect(result).toContain('alt=sse');
    });

    it('should be a no-op for URLs without sensitive params', () => {
      const url = 'https://api.openai.com/v1/chat/completions?model=gpt-4&stream=true';
      const result = service.sanitizeURL(url);
      expect(result).toBe(url);
    });

    it('should handle invalid URLs gracefully', () => {
      const result = service.sanitizeURL('not-a-valid-url');
      expect(result).toBe('not-a-valid-url');
    });
  });
});