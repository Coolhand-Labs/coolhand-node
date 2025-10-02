import * as fs from 'fs';
import * as path from 'path';
import { APIPatterns, APIPattern, MatchedPattern, RequestOptions } from '../types';

export class PatternMatchingService {
  private apiPatterns: APIPattern[] = [];

  constructor(customPatternsFile?: string) {
    this.loadAPIPatterns(customPatternsFile);
  }

  private loadAPIPatterns(customPatternsFile?: string): void {
    try {
      let patternsFile: string;

      if (customPatternsFile) {
        // Use custom patterns file if provided
        patternsFile = path.resolve(customPatternsFile);
      } else {
        // Use default patterns file
        patternsFile = path.join(__dirname, '..', 'api-patterns.json');
      }

      if (fs.existsSync(patternsFile)) {
        const fileContent = fs.readFileSync(patternsFile, 'utf-8');
        const patternsData: APIPatterns = JSON.parse(fileContent);
        this.apiPatterns = patternsData.patterns;
      } else {
        console.warn(`⚠️  API patterns file not found: ${patternsFile}. Using empty patterns list.`);
        this.apiPatterns = [];
      }
    } catch (error) {
      console.error(`❌ Error loading API patterns:`, (error as Error).message);
      this.apiPatterns = [];
    }
  }

  public matchesAPIPattern(options: RequestOptions | string | URL): MatchedPattern | null {
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

  public matchesAPIPatternFromURL(url: string): MatchedPattern | null {
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

  public sanitizeHeaders(headers: any, pattern?: APIPattern): Record<string, any> {
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

  public getLoadedPatterns(): APIPattern[] {
    return [...this.apiPatterns];
  }

  public getPatternsCount(): number {
    return this.apiPatterns.length;
  }
}