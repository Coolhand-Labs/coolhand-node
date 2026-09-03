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
      // Should fall back to default Edge runtime patterns (8 patterns) — see #167
      expect(service.getPatternsCountSync()).toBe(8);

      // The service must remain usable/monitoring must still work after falling back.
      const result = service.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions');
      expect(result).toMatchObject({ pattern: expect.objectContaining({ name: 'OpenAI' }) });
    });

    it('should handle invalid JSON in patterns file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      service = new PatternMatchingService();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error loading API patterns'),
        expect.any(String)
      );
      // Should fallback to default Edge runtime patterns (8 patterns)
      expect(service.getPatternsCountSync()).toBe(8);
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
      // Should fallback to default Edge runtime patterns (8 patterns)
      expect(service.getPatternsCountSync()).toBe(8);
    });
  });

  describe('Patterns File Shape Validation', () => {
    const shapeInvalidCases: Array<[string, unknown]> = [
      ['missing patterns key', {}],
      ['patterns is null', { patterns: null }],
      ['patterns is not an array', { patterns: 'oops' }],
      ['root is a bare array', [{ name: 'OpenAI', domains: ['api.openai.com'] }]],
      ['a pattern entry is missing domains', { patterns: [{ name: 'NoDomains' }] }],
      ['a pattern entry has non-array domains', { patterns: [{ name: 'BadDomains', domains: 'api.openai.com' }] }]
    ];

    it.each(shapeInvalidCases)('falls back to default patterns when %s (default patterns file)', (_label, badData) => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(badData));

      service = new PatternMatchingService();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error loading API patterns'),
        expect.stringContaining('not shaped correctly')
      );
      expect(service.getPatternsCountSync()).toBe(8);

      // The service must remain usable after falling back — no throw on the next request.
      const result = service.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions');
      expect(result).toMatchObject({ pattern: expect.objectContaining({ name: 'OpenAI' }) });
    });

    it.each(shapeInvalidCases)('falls back to default patterns when %s (custom patterns file)', (_label, badData) => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(badData));

      service = new PatternMatchingService('./custom-patterns.json');

      expect(service.getPatternsCountSync()).toBe(8);
      expect(() => service.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions')).not.toThrow();
      expect(() => service.matchesAPIPatternFromURL('https://api.openai.com/v1/chat/completions')).not.toThrow();
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

    it('should not match a hostname where the domain appears as a trailing substring', () => {
      const result = service.matchesAPIPatternSync('https://api.openai.com.attacker.net/health');

      expect(result).toBeNull();
    });

    it('should not match a hostname where the domain appears as a leading substring', () => {
      const result = service.matchesAPIPatternSync('https://my-openai.com.internal/health');

      expect(result).toBeNull();
    });

    it('should not match a hostname that merely contains the domain name without a label boundary', () => {
      const result = service.matchesAPIPatternSync('https://notopenai.com/health');

      expect(result).toBeNull();
    });
  });

  describe('Path Pattern Matching', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should NOT match by path across an unrelated domain by default (#162)', () => {
      const result = service.matchesAPIPatternFromURL('https://different-domain.com/v1/chat/completions');

      expect(result).toBeNull();
    });

    it('should prefer domain matching over path matching', () => {
      const result = service.matchesAPIPatternFromURL('https://api.openai.com/v1/messages');

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });

    it('should NOT match a partial path across an unrelated domain by default (#162)', () => {
      const result = service.matchesAPIPatternFromURL('https://other-domain.com/v1/chat/completions/stream');

      expect(result).toBeNull();
    });

    it('should handle patterns without paths', () => {
      const result = service.matchesAPIPatternFromURL('https://test.api.com/any/path');

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'TestAPI' }),
        matchType: 'domain',
        matchValue: 'test.api.com'
      });
    });

    it('should NOT match unrelated internal/third-party hosts sharing a common path fragment (#162 exploit examples)', () => {
      expect(service.matchesAPIPatternFromURL('https://internal.corp.example.com/v1/messages')).toBeNull();
      expect(service.matchesAPIPatternFromURL('https://billing.example.com/api/v1/chat/completions')).toBeNull();
      expect(service.matchesAPIPatternFromURL('https://api.notanllm.com/v1/models?x=1')).toBeNull();
    });
  });

  describe('Cross-domain path matching (opt-in)', () => {
    const optInPatterns = {
      patterns: [
        {
          name: 'Legit Proxy',
          domains: ['legit.example.com'],
          paths: ['/v1/generate'],
          allowPathMatchAcrossDomains: true
        }
      ]
    };

    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(optInPatterns));
      service = new PatternMatchingService();
    });

    it('should match by path across an unrelated domain when the pattern opts in', () => {
      const result = service.matchesAPIPatternFromURL('https://my-proxy.example.net/v1/generate');

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Legit Proxy' }),
        matchType: 'path',
        matchValue: '/v1/generate'
      });
    });

    it('should still prefer domain matching over path matching when opted in', () => {
      const result = service.matchesAPIPatternFromURL('https://legit.example.com/v1/generate');

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Legit Proxy' }),
        matchType: 'domain',
        matchValue: 'legit.example.com'
      });
    });
  });

  describe('URL Parsing Error Handling', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('returns null when URL parsing fails, even if the raw string contains a known domain', () => {
      // Issue #171: the catch-fallback used to do an unanchored substring match against the raw
      // URL string, reopening the exact bug class #117 fixed for the parseable-URL path. There is
      // no hostname left to safely anchor once URL parsing fails, so this must now return null.
      const result = service.matchesAPIPatternFromURL('invalid-url-with-openai.com');

      expect(result).toBeNull();
    });

    it('should return null for invalid URLs with no matching domains', () => {
      const result = service.matchesAPIPatternFromURL('invalid-url-no-match');

      expect(result).toBeNull();
    });

    it('does not match an unanchored substring resembling a known domain', () => {
      expect(service.matchesAPIPatternFromURL('notopenai.com')).toBeNull();
    });

    it('does not match a known domain embedded elsewhere in a malformed URL', () => {
      expect(service.matchesAPIPatternFromURL('evil.com/openai.com/x')).toBeNull();
    });

    it('does not match on an unparseable Request.toString() fallback value', () => {
      // Request has no custom toString(), so url.toString() on a Request instance yields
      // "[object Request]" — this reaches the catch-fallback on every fetch(new Request(...)) call.
      expect(service.matchesAPIPatternFromURL('[object Request]')).toBeNull();
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
        'authorization': '[REDACTED]',
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

    it('should redact capitalized header keys against default rules (#110)', () => {
      const headers = {
        'Authorization': 'Bearer sk-CAPITALIZED-SECRET',
        'Api-Key': 'secret-key'
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized['authorization']).toBe('[REDACTED]');
      expect(sanitized['api-key']).toBe('[REDACTED]');
    });

    it('should redact credential-bearing headers by default without a pattern (#163)', () => {
      const headers = {
        'x-api-key': 'secret-key',
        'cookie': 'session=abc',
        'set-cookie': 'sid=xyz',
        'proxy-authorization': 'Basic zzz',
        'openai-api-key': 'sk-openai-secret',
        'x-goog-api-key': 'g-key',
        'cf-aig-authorization': 'Bearer gateway-secret',
        'content-type': 'application/json'
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized['x-api-key']).toBe('[REDACTED]');
      expect(sanitized['cookie']).toBe('[REDACTED]');
      expect(sanitized['set-cookie']).toBe('[REDACTED]');
      expect(sanitized['proxy-authorization']).toBe('[REDACTED]');
      expect(sanitized['openai-api-key']).toBe('[REDACTED]');
      expect(sanitized['x-goog-api-key']).toBe('[REDACTED]');
      expect(sanitized['cf-aig-authorization']).toBe('[REDACTED]');
      expect(sanitized['content-type']).toBe('application/json');
    });

    it('should redact credential-bearing headers by default even when a mismatched pattern is passed (#163)', () => {
      const headers = {
        'authorization': 'Bearer sk-test123',
        'x-api-key': 'secret-key',
        'cookie': 'session=abc',
        'set-cookie': 'sid=xyz',
        'proxy-authorization': 'Basic zzz',
        'openai-api-key': 'sk-openai-secret',
        'x-goog-api-key': 'g-key',
        'cf-aig-authorization': 'Bearer gateway-secret'
      };

      // A pattern that doesn't declare these headers must not suppress the default redaction.
      const mismatchedPattern: CoolhandAPIPattern = {
        name: 'OpenAI',
        domains: ['openai.com'],
        headers: {
          'authorization': 'Bearer [REDACTED]'
        }
      };

      const sanitized = service.sanitizeHeaders(headers, mismatchedPattern);

      expect(sanitized['authorization']).toBe('Bearer [REDACTED]');
      expect(sanitized['x-api-key']).toBe('[REDACTED]');
      expect(sanitized['cookie']).toBe('[REDACTED]');
      expect(sanitized['set-cookie']).toBe('[REDACTED]');
      expect(sanitized['proxy-authorization']).toBe('[REDACTED]');
      expect(sanitized['openai-api-key']).toBe('[REDACTED]');
      expect(sanitized['x-goog-api-key']).toBe('[REDACTED]');
      expect(sanitized['cf-aig-authorization']).toBe('[REDACTED]');
    });

    it('should redact mixed-case header keys against lowercase pattern rules (#110)', () => {
      const headers = {
        'X-Api-Key': 'sk-openai123',
        'OpenAI-API-Key': 'sk-openai456'
      };

      const pattern: CoolhandAPIPattern = {
        name: 'OpenAI',
        domains: ['openai.com'],
        headers: {
          'x-api-key': '[REDACTED]',
          'openai-api-key': '[REDACTED]'
        }
      };

      const sanitized = service.sanitizeHeaders(headers, pattern);

      expect(sanitized['x-api-key']).toBe('[REDACTED]');
      expect(sanitized['openai-api-key']).toBe('[REDACTED]');
    });

    it('should preserve headers not in sanitization rules', () => {
      const headers = {
        'custom-header': 'keep-this',
        'authorization': 'Bearer token'
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized['custom-header']).toBe('keep-this');
      expect(sanitized['authorization']).toBe('[REDACTED]');
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

    it('should fall back to default patterns count when patterns file is missing', () => {
      mockFs.existsSync.mockReturnValue(false);
      const fallbackService = new PatternMatchingService();

      expect(fallbackService.getPatternsCountSync()).toBe(8);
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

    it('should NOT match by path for a pattern with an empty domains array and no opt-in (#162)', () => {
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
      expect(result).toBeNull();
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

      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized.custom).toEqual({ nested: 'value' });
    });

    it('should handle header arrays', () => {
      const headers = {
        'authorization': 'Bearer token123',
        'accept': ['application/json', 'text/plain']
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized.accept).toBe('application/json, text/plain');
    });

    it('should unwrap single-element header arrays to string', () => {
      const headers = {
        'content-type': ['application/json']
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized['content-type']).toBe('application/json');
    });

    it('should handle multiple Bearer token formats', () => {
      const headers = {
        'authorization': 'Bearer sk-proj-1234567890abcdef',
        'x-api-key': 'Bearer another-token-format'
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized['x-api-key']).toBe('[REDACTED]'); // In default rules (#163)
    });

    it('should handle JWT tokens in authorization header', () => {
      const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const headers = {
        'authorization': `Bearer ${jwtToken}`
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized.authorization).toBe('[REDACTED]');
    });

    it('should redact non-Bearer authorization schemes', () => {
      const headers = {
        'authorization': 'Basic dXNlcjpwYXNzd29yZA=='
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized.authorization).toBe('[REDACTED]');
    });

    it('should redact lowercase bearer scheme', () => {
      const headers = {
        'authorization': 'bearer sk-lowercase-SECRET'
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized.authorization).toBe('[REDACTED]');
    });

    it('should redact a non-Bearer authorization header under a pattern that only overrides other headers (e.g. Anthropic)', () => {
      const anthropicPattern: CoolhandAPIPattern = {
        name: 'Anthropic',
        domains: ['api.anthropic.com'],
        headers: {
          'x-api-key': '[REDACTED]'
        }
      };

      const headers = {
        'authorization': 'Basic dXNlcjpwYXNzd29yZA==',
        'x-api-key': 'ant-secret-key'
      };

      const sanitized = service.sanitizeHeaders(headers, anthropicPattern);

      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized['x-api-key']).toBe('[REDACTED]');
    });

    it('should handle API keys with different prefixes', () => {
      const headers = {
        'x-api-key': 'sk-1234567890',
        'api-key': 'ak_live_1234567890',
        'auth-token': 'pat_1234567890'
      };

      const sanitized = service.sanitizeHeaders(headers);

      expect(sanitized['api-key']).toBe('[REDACTED]');
      expect(sanitized['x-api-key']).toBe('[REDACTED]'); // In default rules (#163)
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

      // Should handle large header sanitization efficiently (generous budget to
      // stay stable under parallel test-worker CPU contention, not just on a quiet machine)
      expect(totalTime).toBeLessThan(300);
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

      // Should not throw at construction time...
      expect(() => new PatternMatchingService()).not.toThrow();
      service = new PatternMatchingService();

      // ...and since one entry is missing `domains`, the whole file is treated as
      // malformed and the service falls back to the 8 built-in default patterns,
      // rather than silently loading the entries that happen to be well-formed.
      expect(service.getPatternsCountSync()).toBe(8);

      // Nor should the very next request throw — this is the actual crash #116 describes.
      expect(() => service.matchesAPIPatternSync('https://valid.com/test')).not.toThrow();
      expect(() => service.matchesAPIPatternFromURL('https://valid.com/test')).not.toThrow();
      expect(service.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions')).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' })
      });
    });

    it('should degrade to null instead of throwing when apiPatterns is corrupted after load', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));

      service = new PatternMatchingService();
      // Simulate a future bug elsewhere corrupting the cached patterns after a
      // successful, validated load — the matching methods must still not throw.
      (service as unknown as { apiPatterns: unknown }).apiPatterns = [{ name: 'Broken' }];

      expect(service.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions')).toBeNull();
      expect(service.matchesAPIPatternFromURL('https://api.openai.com/v1/chat/completions')).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('pattern matching failed'),
        expect.any(String)
      );
    });

    it('should degrade to null instead of throwing when apiPatterns is not iterable', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));

      service = new PatternMatchingService();
      (service as unknown as { apiPatterns: unknown }).apiPatterns = undefined;

      expect(service.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions')).toBeNull();
      expect(service.matchesAPIPatternFromURL('https://api.openai.com/v1/chat/completions')).toBeNull();
      await expect(service.matchesAPIPattern('https://api.openai.com/v1/chat/completions')).resolves.toBeNull();
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

    it('matches URLs the URL constructor can parse, and returns null for the ones it cannot (no string-matching fallback)', () => {
      // Issue #171: the catch-fallback used to string-match the raw URL, so every one of these
      // matched 'openai.com' regardless of whether it parsed. Now, only entries the WHATWG URL
      // constructor can actually parse go through the anchored try-branch and match; the rest hit
      // the catch block, which returns null rather than falling back to substring matching.
      expect(service.matchesAPIPatternFromURL('ftp://api.openai.com/test')).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
      expect(service.matchesAPIPatternFromURL('https:/api.openai.com/test')).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
      expect(service.matchesAPIPatternFromURL('not-a-url-at-all')).toBeNull();
      expect(service.matchesAPIPatternFromURL('://api.openai.com/test')).toBeNull();
      expect(service.matchesAPIPatternFromURL('api.openai.com/test')).toBeNull();
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

    it('should NOT match :generateContent path on a non-Google domain by default (#162 — was a false-positive "proxy scenario")', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://my-proxy.example.com/v1beta/models/gemini-pro:generateContent'
      );
      expect(result).toBeNull();
    });

    it('should NOT match :streamGenerateContent path on a non-Google domain by default (#162)', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://my-proxy.example.com/v1beta/models/gemini-pro:streamGenerateContent?alt=sse'
      );
      expect(result).toBeNull();
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

  describe('Vertex AI Pattern Matching', () => {
    const mockPatternsWithVertex = {
      patterns: [
        ...mockPatterns.patterns,
        {
          name: 'Vertex AI',
          domains: ['aiplatform.googleapis.com'],
          paths: [':generateContent', ':streamGenerateContent', ':embedContent', ':predict', '/endpoints/openapi/'],
          headers: { authorization: '[REDACTED]' }
        }
      ]
    };

    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatternsWithVertex));
      service = new PatternMatchingService();
    });

    it('should match Vertex AI generateContent URL by domain', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models/gemini-pro:generateContent'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Vertex AI' }),
        matchType: 'domain',
        matchValue: 'aiplatform.googleapis.com'
      });
    });

    it('should match Vertex AI OpenAI-compatible endpoint by domain', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/endpoints/openapi/chat/completions'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Vertex AI' }),
        matchType: 'domain',
        matchValue: 'aiplatform.googleapis.com'
      });
    });

    it('should redact x-goog-api-key header for Vertex AI Express Mode', () => {
      const pattern: CoolhandAPIPattern = {
        name: 'Vertex AI',
        domains: ['aiplatform.googleapis.com'],
        headers: {
          'authorization': '[REDACTED]',
          'x-goog-api-key': '[REDACTED]'
        }
      };
      const headers = {
        'x-goog-api-key': 'AIzaSyVertexSecret',
        'content-type': 'application/json'
      };
      const sanitized = service.sanitizeHeaders(headers, pattern);
      expect(sanitized['x-goog-api-key']).toBe('[REDACTED]');
      expect(sanitized['content-type']).toBe('application/json');
    });

    it('should not confuse Vertex AI with Google AI (generativelanguage domain)', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Google AI' }),
      });
    });
  });

  describe('Cloudflare AI Gateway Pattern Matching', () => {
    const mockPatternsWithCloudflare = {
      patterns: [
        ...mockPatterns.patterns,
        {
          name: 'Cloudflare AI Gateway',
          domains: ['gateway.ai.cloudflare.com'],
          paths: [],
          headers: {
            authorization: '[REDACTED]',
            'cf-aig-authorization': '[REDACTED]',
            'x-api-key': '[REDACTED]',
            'openai-api-key': '[REDACTED]',
            'x-goog-api-key': '[REDACTED]'
          }
        }
      ]
    };

    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatternsWithCloudflare));
      service = new PatternMatchingService();
    });

    it('should match Cloudflare AI Gateway URL by domain', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://gateway.ai.cloudflare.com/v1/acct123/gw1/openai/chat/completions'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Cloudflare AI Gateway' }),
        matchType: 'domain',
        matchValue: 'gateway.ai.cloudflare.com'
      });
    });

    it('should match Cloudflare AI Gateway proxying Anthropic', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://gateway.ai.cloudflare.com/v1/acct123/gw1/anthropic/v1/messages'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Cloudflare AI Gateway' }),
        matchType: 'domain',
        matchValue: 'gateway.ai.cloudflare.com'
      });
    });

    it('should redact proxied-provider auth headers via Cloudflare pattern', () => {
      const pattern: CoolhandAPIPattern = {
        name: 'Cloudflare AI Gateway',
        domains: ['gateway.ai.cloudflare.com'],
        headers: {
          authorization: '[REDACTED]',
          'cf-aig-authorization': '[REDACTED]',
          'x-api-key': '[REDACTED]',
          'openai-api-key': '[REDACTED]',
          'x-goog-api-key': '[REDACTED]'
        }
      };
      const headers = {
        'cf-aig-authorization': 'Bearer gateway-secret',
        'x-api-key': 'sk-ant-secret',
        'openai-api-key': 'sk-openai-secret',
        'x-goog-api-key': 'AIzaSySecret',
        'content-type': 'application/json'
      };
      const sanitized = service.sanitizeHeaders(headers, pattern);
      expect(sanitized['cf-aig-authorization']).toBe('[REDACTED]');
      expect(sanitized['x-api-key']).toBe('[REDACTED]');
      expect(sanitized['openai-api-key']).toBe('[REDACTED]');
      expect(sanitized['x-goog-api-key']).toBe('[REDACTED]');
      expect(sanitized['content-type']).toBe('application/json');
    });
  });

  describe('OpenRouter Pattern Matching', () => {
    const mockPatternsWithOpenRouter = {
      patterns: [
        ...mockPatterns.patterns,
        {
          name: 'OpenRouter',
          domains: ['openrouter.ai'],
          paths: ['/api/v1/chat/completions', '/api/v1/completions', '/api/v1/embeddings'],
          headers: {
            authorization: '[REDACTED]',
            'x-api-key': '[REDACTED]'
          }
        }
      ]
    };

    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatternsWithOpenRouter));
      service = new PatternMatchingService();
    });

    it('should match OpenRouter chat completions URL by domain', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://openrouter.ai/api/v1/chat/completions'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenRouter' }),
        matchType: 'domain',
        matchValue: 'openrouter.ai'
      });
    });

    it('should match OpenRouter embeddings URL by domain', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://openrouter.ai/api/v1/embeddings'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenRouter' }),
        matchType: 'domain',
        matchValue: 'openrouter.ai'
      });
    });

    it('should redact authorization and x-api-key headers for OpenRouter', () => {
      const pattern: CoolhandAPIPattern = {
        name: 'OpenRouter',
        domains: ['openrouter.ai'],
        headers: {
          authorization: '[REDACTED]',
          'x-api-key': '[REDACTED]'
        }
      };
      const headers = {
        authorization: 'Bearer sk-or-secret',
        'x-api-key': 'sk-or-key',
        'content-type': 'application/json'
      };
      const sanitized = service.sanitizeHeaders(headers, pattern);
      expect(sanitized['authorization']).toBe('[REDACTED]');
      expect(sanitized['x-api-key']).toBe('[REDACTED]');
      expect(sanitized['content-type']).toBe('application/json');
    });
  });

  describe('OpenCode Pattern Matching', () => {
    const mockPatternsWithOpenCode = {
      patterns: [
        ...mockPatterns.patterns,
        {
          name: 'OpenCode',
          domains: ['opencode.ai', 'api.opencode.ai'],
          paths: [],
          headers: {
            authorization: '[REDACTED]',
            'x-api-key': '[REDACTED]'
          }
        }
      ]
    };

    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatternsWithOpenCode));
      service = new PatternMatchingService();
    });

    it('should match OpenCode Zen chat completions URL by domain', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://opencode.ai/zen/v1/chat/completions'
      );
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenCode' }),
        matchType: 'domain',
        matchValue: 'opencode.ai'
      });
    });

    it('should match misconfigured api.opencode.ai host by domain', () => {
      const result = service.matchesAPIPatternFromURL(
        'https://api.opencode.ai/v1/chat/completions'
      );
      // api.opencode.ai matches as a subdomain of the first listed domain, opencode.ai
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenCode' }),
        matchType: 'domain',
        matchValue: 'opencode.ai'
      });
    });

    it('should redact authorization and x-api-key headers for OpenCode', () => {
      const pattern: CoolhandAPIPattern = {
        name: 'OpenCode',
        domains: ['opencode.ai', 'api.opencode.ai'],
        headers: {
          authorization: '[REDACTED]',
          'x-api-key': '[REDACTED]'
        }
      };
      const headers = {
        authorization: 'Bearer sk-oc-secret',
        'x-api-key': 'sk-oc-key',
        'content-type': 'application/json'
      };
      const sanitized = service.sanitizeHeaders(headers, pattern);
      expect(sanitized['authorization']).toBe('[REDACTED]');
      expect(sanitized['x-api-key']).toBe('[REDACTED]');
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

    it.each(['password', 'signature', 'sig', 'x-goog-api-key', 'X-Amz-Signature', 'X-Amz-Credential'])(
      'should redact %s param',
      (param) => {
        const url = `https://api.example.com/v1/resource?${param}=super-secret-value`;
        const result = service.sanitizeURL(url);
        expect(result).not.toContain('super-secret-value');
        expect(result).toContain('REDACTED');
      }
    );

    it('should redact sensitive params case-insensitively', () => {
      const url = 'https://api.example.com/v1/resource?SIGNATURE=super-secret-value';
      const result = service.sanitizeURL(url);
      expect(result).not.toContain('super-secret-value');
      expect(result).toContain('REDACTED');
    });
  });
});