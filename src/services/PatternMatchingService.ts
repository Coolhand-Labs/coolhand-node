import { CoolhandAPIPatterns, CoolhandAPIPattern, CoolhandMatchedPattern, CoolhandRequestOptions } from '../types';

// Import the module to get dynamic import and createRequire support
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Runtime detection
const isEdgeRuntime = (): boolean => {
  return (typeof (globalThis as any).EdgeRuntime !== 'undefined') ||
    process.env.NEXT_RUNTIME === 'edge' ||
    (typeof (globalThis as any).window !== 'undefined');
};

export class PatternMatchingService {
  private apiPatterns: CoolhandAPIPattern[] = [];

  constructor(customPatternsFile?: string) {
    this.loadAPIPatterns(customPatternsFile);
  }

  private loadAPIPatterns(customPatternsFile?: string): void {
    try {
      let patternsFile: string;

      if (customPatternsFile) {
        // Use custom patterns file if provided
        patternsFile = customPatternsFile;
      } else {
        // Calculate the path to api-patterns.json relative to this file
        try {
          // For ES modules, use import.meta.url to get the current file path
          const __filename = fileURLToPath(import.meta.url);
          const __dirname = dirname(__filename);
          patternsFile = join(__dirname, '..', 'api-patterns.json');
        } catch {
          // Fallback for environments where import.meta.url isn't available
          const require = createRequire(import.meta.url);
          patternsFile = require.resolve('../api-patterns.json');
        }
      }

      // Read the file using createRequire for ES modules
      const require = createRequire(import.meta.url);
      const fs = require('fs');

      const fileContent = fs.readFileSync(patternsFile, 'utf-8');
      const patternsData: CoolhandAPIPatterns = JSON.parse(fileContent);
      this.apiPatterns = patternsData.patterns;

      console.log(`📋 Loaded ${this.apiPatterns.length} API patterns from file`);
    } catch (error) {
      console.error(`❌ Error loading API patterns:`, (error as Error).message);
      console.error(`   Pattern file path attempted: ${customPatternsFile || 'default api-patterns.json'}`);
      throw new Error(`Failed to load API patterns: ${(error as Error).message}`);
    }
  }

  public matchesAPIPattern(options: CoolhandRequestOptions | string | URL): CoolhandMatchedPattern | null {
    if (typeof options === 'string') {
      return this.matchesAPIPatternFromURL(options);
    }

    if (options instanceof URL) {
      return this.matchesAPIPatternFromURL(options.toString());
    }

    // Construct URL from options
    const hostname = options.hostname || options.host || '';

    // Check domain matches
    for (const pattern of this.apiPatterns) {
      for (const domain of pattern.domains) {
        if (hostname.includes(domain)) {
          return {
            pattern,
            matchType: 'domain',
            matchValue: domain
          };
        }
      }
    }

    return null;
  }

  public matchesAPIPatternFromURL(url: string): CoolhandMatchedPattern | null {
    try {
      const urlObj = new URL(url);

      // Check domain matches
      for (const pattern of this.apiPatterns) {
        for (const domain of pattern.domains) {
          if (urlObj.hostname.includes(domain)) {
            return {
              pattern,
              matchType: 'domain',
              matchValue: domain
            };
          }
        }
      }

      // Check path matches
      for (const pattern of this.apiPatterns) {
        if (pattern.paths) {
          for (const pathPattern of pattern.paths) {
            if (urlObj.pathname.includes(pathPattern)) {
              return {
                pattern,
                matchType: 'path',
                matchValue: pathPattern
              };
            }
          }
        }
      }
    } catch {
      // If URL parsing fails, fall back to simple string matching
      for (const pattern of this.apiPatterns) {
        for (const domain of pattern.domains) {
          if (url.includes(domain)) {
            return {
              pattern,
              matchType: 'domain',
              matchValue: domain
            };
          }
        }
      }
    }

    return null;
  }

  public sanitizeHeaders(headers: any, pattern?: CoolhandAPIPattern): Record<string, any> {
    const sanitized = { ...headers };

    // Default sanitization rules
    if (sanitized.authorization) {
      sanitized.authorization = (sanitized.authorization as string).replace(/Bearer .+/, 'Bearer [REDACTED]');
    }
    if (sanitized['api-key']) {
      sanitized['api-key'] = '[REDACTED]';
    }

    // Pattern-specific sanitization
    if (pattern?.headers) {
      for (const [headerKey, redactionValue] of Object.entries(pattern.headers)) {
        if (sanitized[headerKey]) {
          sanitized[headerKey] = redactionValue;
        }
        // Also check lowercase version
        const lowerKey = headerKey.toLowerCase();
        if (sanitized[lowerKey]) {
          sanitized[lowerKey] = redactionValue;
        }
      }
    }

    return sanitized;
  }

  public getLoadedPatterns(): CoolhandAPIPattern[] {
    return [...this.apiPatterns];
  }

  public getPatternsCount(): number {
    return this.apiPatterns.length;
  }
}