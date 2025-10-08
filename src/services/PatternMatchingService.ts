import { CoolhandAPIPatterns, CoolhandAPIPattern, CoolhandMatchedPattern, CoolhandRequestOptions } from '../types';

// Use eval to access these dynamically to avoid TypeScript issues in test environments

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
        // Use custom patterns file if provided - use regular require for test compatibility
        try {
          const path = require('path');
          patternsFile = path.resolve(customPatternsFile);
        } catch {
          // Fallback for ES modules
          patternsFile = customPatternsFile;
        }
      } else {
        // Calculate the path to api-patterns.json relative to this file
        try {
          // Try regular require first (works with Jest mocks)
          const path = require('path');
          patternsFile = path.join(__dirname, '..', 'api-patterns.json');
        } catch {
          // Fallback for ES modules when require isn't available
          try {
            const path = eval('require')('path');
            const url = eval('require')('url');
            const { createRequire } = eval('require')('module');
            const importMeta = eval('typeof import.meta !== "undefined" ? import.meta : undefined');

            if (importMeta && importMeta.url) {
              const require = createRequire(importMeta.url);
              const __filename = url.fileURLToPath(importMeta.url);
              const __dirname = path.dirname(__filename);
              patternsFile = path.join(__dirname, '..', 'api-patterns.json');
            } else {
              patternsFile = '../api-patterns.json';
            }
          } catch {
            patternsFile = '../api-patterns.json';
          }
        }
      }

      // Read the file - try different approaches
      let fs: any;
      try {
        // Try regular require first (works with Jest mocks)
        fs = require('fs');
      } catch {
        try {
          // Try eval require for ES modules
          fs = eval('require')('fs');
        } catch {
          // If require completely fails, handle gracefully
          console.warn(`⚠️ Could not load fs module. Using empty patterns list.`);
          this.apiPatterns = [];
          return;
        }
      }

      if (!fs.existsSync(patternsFile)) {
        console.warn(`⚠️ API patterns file not found: ${patternsFile}. Using empty patterns list.`);
        this.apiPatterns = [];
        return;
      }

      const fileContent = fs.readFileSync(patternsFile, 'utf-8');
      const patternsData: CoolhandAPIPatterns = JSON.parse(fileContent);
      this.apiPatterns = patternsData.patterns || [];

      console.log(`📋 Loaded ${this.apiPatterns.length} API patterns from file`);
    } catch (error) {
      console.error(`❌ Error loading API patterns:`, (error as Error).message);
      // Handle gracefully instead of throwing - set empty patterns
      this.apiPatterns = [];
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