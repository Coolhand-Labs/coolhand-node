import * as fs from 'fs';
import * as path from 'path';
import { PatternMatchingService } from '../src/services/PatternMatchingService';
import { APIPattern } from '../src/types';

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
      expect(service.getPatternsCount()).toBe(3);
    });

    it('should load custom patterns file when specified', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));

      service = new PatternMatchingService('./custom-patterns.json');

      expect(mockPath.resolve).toHaveBeenCalledWith('./custom-patterns.json');
      expect(mockFs.existsSync).toHaveBeenCalledWith('/resolved/./custom-patterns.json');
      expect(service.getPatternsCount()).toBe(3);
    });

    it('should handle missing patterns file gracefully', () => {
      mockFs.existsSync.mockReturnValue(false);

      service = new PatternMatchingService();

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('API patterns file not found')
      );
      expect(service.getPatternsCount()).toBe(0);
    });

    it('should handle invalid JSON in patterns file', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      service = new PatternMatchingService();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error loading API patterns'),
        expect.any(String)
      );
      expect(service.getPatternsCount()).toBe(0);
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
      expect(service.getPatternsCount()).toBe(0);
    });
  });

  describe('Domain Pattern Matching', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockPatterns));
      service = new PatternMatchingService();
    });

    it('should match URL string by domain', () => {
      const result = service.matchesAPIPattern('https://api.openai.com/v1/chat/completions');

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });

    it('should match URL object by domain', () => {
      const url = new URL('https://api.anthropic.com/v1/messages');
      const result = service.matchesAPIPattern(url);

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

      const result = service.matchesAPIPattern(options);

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

      const result = service.matchesAPIPattern(options);

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Anthropic' }),
        matchType: 'domain',
        matchValue: 'api.anthropic.com'
      });
    });

    it('should match partial domain names', () => {
      const result = service.matchesAPIPattern('https://subdomain.api.openai.com/test');

      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'OpenAI' }),
        matchType: 'domain',
        matchValue: 'openai.com'
      });
    });

    it('should return null for non-matching domains', () => {
      const result = service.matchesAPIPattern('https://unknown-api.com/endpoint');

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

      const pattern: APIPattern = {
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

      const pattern: APIPattern = {
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
      const patterns = service.getLoadedPatterns();

      expect(patterns).toHaveLength(3);
      expect(patterns[0]).toMatchObject({
        name: 'OpenAI',
        domains: ['openai.com', 'api.openai.com']
      });
    });

    it('should return a copy of patterns to prevent mutation', () => {
      const patterns = service.getLoadedPatterns();
      patterns.push({
        name: 'Modified',
        domains: ['modified.com']
      });

      expect(service.getPatternsCount()).toBe(3);
    });

    it('should return correct patterns count', () => {
      expect(service.getPatternsCount()).toBe(3);
    });

    it('should return zero count when no patterns loaded', () => {
      mockFs.existsSync.mockReturnValue(false);
      const emptyService = new PatternMatchingService();

      expect(emptyService.getPatternsCount()).toBe(0);
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

      const result = service.matchesAPIPattern(options);
      expect(result).toBeNull();
    });

    it('should handle empty URL string', () => {
      const result = service.matchesAPIPattern('');
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

      const result = emptyService.matchesAPIPattern('https://any.com/test');
      expect(result).toMatchObject({
        pattern: expect.objectContaining({ name: 'Empty' }),
        matchType: 'path',
        matchValue: '/test'
      });
    });
  });
});