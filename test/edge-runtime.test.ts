import { PatternMatchingService } from '../src/services/PatternMatchingService';

// Mock console to avoid output during tests
jest.spyOn(console, 'log').mockImplementation();
jest.spyOn(console, 'warn').mockImplementation();
jest.spyOn(console, 'error').mockImplementation();

describe('Edge Runtime Detection and Loading', () => {
  let originalEdgeRuntime: any;
  let originalWindow: any;
  let originalNextRuntime: string | undefined;

  beforeEach(() => {
    // Save original values
    originalEdgeRuntime = (globalThis as any).EdgeRuntime;
    originalWindow = (globalThis as any).window;
    originalNextRuntime = process.env.NEXT_RUNTIME;
  });

  afterEach(() => {
    // Restore original values
    if (originalEdgeRuntime !== undefined) {
      (globalThis as any).EdgeRuntime = originalEdgeRuntime;
    } else {
      delete (globalThis as any).EdgeRuntime;
    }

    if (originalWindow !== undefined) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }

    if (originalNextRuntime !== undefined) {
      process.env.NEXT_RUNTIME = originalNextRuntime;
    } else {
      delete process.env.NEXT_RUNTIME;
    }

    // Clear console mocks
    jest.clearAllMocks();
  });

  describe('Edge Runtime Detection', () => {
    it('should detect Edge runtime when EdgeRuntime is defined on globalThis', () => {
      // Simulate Edge runtime environment
      (globalThis as any).EdgeRuntime = 'edge';

      const service = new PatternMatchingService();

      // Should use Edge runtime patterns (4 default patterns)
      expect(service.getPatternsCountSync()).toBe(6);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Loaded 7 default API patterns for Edge runtime')
      );
    });

    it('should detect Edge runtime when NEXT_RUNTIME is set to edge', () => {
      // Simulate Next.js Edge runtime environment
      process.env.NEXT_RUNTIME = 'edge';

      const service = new PatternMatchingService();

      // Should use Edge runtime patterns
      expect(service.getPatternsCountSync()).toBe(6);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Loaded 7 default API patterns for Edge runtime')
      );
    });

    it('should detect Edge runtime when window is defined (browser environment)', () => {
      // Simulate browser environment
      (globalThis as any).window = {};

      const service = new PatternMatchingService();

      // Should use Edge runtime patterns
      expect(service.getPatternsCountSync()).toBe(6);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Loaded 7 default API patterns for Edge runtime')
      );
    });

    it('should not detect Edge runtime in normal Node.js environment', () => {
      // Ensure we're in a clean Node.js environment
      delete (globalThis as any).EdgeRuntime;
      delete (globalThis as any).window;
      delete process.env.NEXT_RUNTIME;

      const service = new PatternMatchingService();

      // Should try to load from filesystem and succeed in test environment
      // This will load the actual patterns file with 7 patterns
      expect(service.getPatternsCountSync()).toBe(7);
    });
  });

  describe('Edge Runtime Pattern Loading', () => {
    beforeEach(() => {
      // Force Edge runtime detection
      (globalThis as any).EdgeRuntime = 'edge';
    });

    it('should load default Edge runtime patterns', () => {
      const service = new PatternMatchingService();
      const patterns = service.getLoadedPatternsSync();

      expect(patterns).toHaveLength(7);

      // Check for expected default patterns
      const patternNames = patterns.map(p => p.name);
      expect(patternNames).toContain('OpenAI');
      expect(patternNames).toContain('Anthropic');
      expect(patternNames).toContain('Google AI');
      expect(patternNames).toContain('GitHub Models');
      expect(patternNames).toContain('Vertex AI');
      expect(patternNames).toContain('OpenRouter');
      expect(patternNames).toContain('Cloudflare AI Gateway');
    });

    it('should load OpenAI pattern with correct configuration', () => {
      const service = new PatternMatchingService();
      const patterns = service.getLoadedPatternsSync();

      const openAIPattern = patterns.find(p => p.name === 'OpenAI');
      expect(openAIPattern).toBeDefined();
      expect(openAIPattern?.domains).toContain('api.openai.com');
      expect(openAIPattern?.headers).toHaveProperty('authorization', 'Bearer [REDACTED]');
    });

    it('should load Anthropic pattern with correct configuration', () => {
      const service = new PatternMatchingService();
      const patterns = service.getLoadedPatternsSync();

      const anthropicPattern = patterns.find(p => p.name === 'Anthropic');
      expect(anthropicPattern).toBeDefined();
      expect(anthropicPattern?.domains).toContain('api.anthropic.com');
      expect(anthropicPattern?.headers).toHaveProperty('x-api-key', '[REDACTED]');
    });

    it('should load Google AI pattern with correct configuration', () => {
      const service = new PatternMatchingService();
      const patterns = service.getLoadedPatternsSync();

      const googlePattern = patterns.find(p => p.name === 'Google AI');
      expect(googlePattern).toBeDefined();
      expect(googlePattern?.domains).toContain('generativelanguage.googleapis.com');
      expect(googlePattern?.headers).toHaveProperty('authorization', 'Bearer [REDACTED]');
    });

    it('should load GitHub Models pattern with correct configuration', () => {
      const service = new PatternMatchingService();
      const patterns = service.getLoadedPatternsSync();

      const githubPattern = patterns.find(p => p.name === 'GitHub Models');
      expect(githubPattern).toBeDefined();
      expect(githubPattern?.domains).toContain('models.github.ai');
      expect(githubPattern?.domains).toContain('models.inference.ai.azure.com');
      expect(githubPattern?.headers).toHaveProperty('authorization', 'Bearer [REDACTED]');
    });

    it('should ignore custom patterns file in Edge runtime', () => {
      // Even if we provide a custom patterns file, Edge runtime should ignore it
      const service = new PatternMatchingService('./custom-patterns.json');

      // Should still load default Edge patterns, not attempt to read custom file
      expect(service.getPatternsCountSync()).toBe(7);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Loaded 7 default API patterns for Edge runtime')
      );
    });
  });

  describe('Node.js vs Edge Runtime Behavior', () => {
    it('should use different loading strategies for Node.js vs Edge runtime', () => {
      // Test Edge runtime
      (globalThis as any).EdgeRuntime = 'edge';
      const edgeService = new PatternMatchingService();
      const edgePatterns = edgeService.getLoadedPatternsSync();

      // Clean up for Node.js test
      delete (globalThis as any).EdgeRuntime;
      delete (globalThis as any).window;
      delete process.env.NEXT_RUNTIME;

      // Test Node.js runtime (will load from filesystem with 4 patterns)
      const nodeService = new PatternMatchingService();
      const nodePatterns = nodeService.getLoadedPatternsSync();

      // Edge runtime uses 7 default patterns, Node.js loads 7 from file
      expect(edgePatterns).toHaveLength(7);
      expect(nodePatterns).toHaveLength(7);

      // But the loading paths should be different (check console output)
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Loaded 7 default API patterns for Edge runtime')
      );
    });

    it('should handle mixed runtime environments correctly', () => {
      // Test multiple runtime indicators
      (globalThis as any).EdgeRuntime = 'edge';
      process.env.NEXT_RUNTIME = 'edge';
      (globalThis as any).window = {};

      const service = new PatternMatchingService();

      // Should still work correctly with multiple indicators
      expect(service.getPatternsCountSync()).toBe(6);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Loaded 7 default API patterns for Edge runtime')
      );
    });
  });

  describe('Edge Runtime Fallback Behavior', () => {
    it('should always provide working patterns in Edge runtime', () => {
      (globalThis as any).EdgeRuntime = 'edge';

      const service = new PatternMatchingService();

      // Should never have zero patterns in Edge runtime
      expect(service.getPatternsCountSync()).toBeGreaterThan(0);

      // Should be able to match common AI services
      expect(service.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions')).toBeTruthy();
      expect(service.matchesAPIPatternSync('https://api.anthropic.com/v1/messages')).toBeTruthy();
    });

    it('should provide consistent pattern matching in Edge runtime', () => {
      (globalThis as any).EdgeRuntime = 'edge';

      const service = new PatternMatchingService();

      // Test OpenAI matching
      const openAIMatch = service.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions');
      expect(openAIMatch?.pattern.name).toBe('OpenAI');
      expect(openAIMatch?.matchType).toBe('domain');

      // Test Anthropic matching
      const anthropicMatch = service.matchesAPIPatternSync('https://api.anthropic.com/v1/messages');
      expect(anthropicMatch?.pattern.name).toBe('Anthropic');
      expect(anthropicMatch?.matchType).toBe('domain');

      // Test Google AI matching
      const googleMatch = service.matchesAPIPatternSync('https://generativelanguage.googleapis.com/v1/models');
      expect(googleMatch?.pattern.name).toBe('Google AI');
      expect(googleMatch?.matchType).toBe('domain');
    });

    it('should handle header sanitization correctly in Edge runtime', () => {
      (globalThis as any).EdgeRuntime = 'edge';

      const service = new PatternMatchingService();

      // Test header sanitization with Edge runtime patterns
      const headers = {
        'authorization': 'Bearer sk-1234567890',
        'x-api-key': 'ant-api-key-1234',
        'content-type': 'application/json'
      };

      const openAIMatch = service.matchesAPIPatternSync('https://api.openai.com/v1/chat/completions');
      if (openAIMatch) {
        const sanitized = service.sanitizeHeaders(headers, openAIMatch.pattern);
        expect(sanitized.authorization).toBe('Bearer [REDACTED]');
        expect(sanitized['content-type']).toBe('application/json'); // Should be preserved
      }

      const anthropicMatch = service.matchesAPIPatternSync('https://api.anthropic.com/v1/messages');
      if (anthropicMatch) {
        const sanitized = service.sanitizeHeaders(headers, anthropicMatch.pattern);
        expect(sanitized['x-api-key']).toBe('[REDACTED]');
        expect(sanitized['content-type']).toBe('application/json'); // Should be preserved
      }
    });
  });

  describe('Edge Runtime Initialization States', () => {
    it('should be initialized immediately after construction in Edge runtime', () => {
      (globalThis as any).EdgeRuntime = 'edge';

      const service = new PatternMatchingService();

      // Should be immediately usable
      expect(service.getPatternsCountSync()).toBe(6);
      expect(service.getLoadedPatternsSync()).toHaveLength(6);
    });

    it('should handle multiple initialization calls gracefully', () => {
      (globalThis as any).EdgeRuntime = 'edge';

      const service = new PatternMatchingService();
      const initialCount = service.getPatternsCountSync();

      // Try to trigger re-initialization (should be ignored)
      const secondCount = service.getPatternsCountSync();
      const patterns = service.getLoadedPatternsSync();

      expect(secondCount).toBe(initialCount);
      expect(patterns).toHaveLength(6);
    });
  });
});