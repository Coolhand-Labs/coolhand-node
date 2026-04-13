import { CoolhandAPIPatterns, CoolhandAPIPattern, CoolhandMatchedPattern, CoolhandRequestOptions } from '../types';

// Runtime detection utility
const isEdgeRuntime = () => {
  return (typeof (globalThis as any).EdgeRuntime !== 'undefined') ||
         process.env.NEXT_RUNTIME === 'edge' ||
         (typeof (globalThis as any).window !== 'undefined');
};


// Node.js modules - conditionally imported
let fs: any = null;
let path: any = null;

// Lazy load Node.js modules only when not in Edge runtime
const loadNodeModules = async () => {
  if (isEdgeRuntime()) {return false;}

  try {
    fs = await import('fs');
    path = await import('path');
    return true;
  } catch {
    return false;
  }
};

export interface PatternMatchingServiceOptions {
  customPatternsFile?: string;
  silent?: boolean;
}

export class PatternMatchingService {
  private apiPatterns: CoolhandAPIPattern[] = [];
  private isInitialized: boolean = false;
  private silent: boolean;

  constructor(options?: string | PatternMatchingServiceOptions) {
    if (typeof options === 'string') {
      this.silent = false;
      this.initializePatternsSync(options);
    } else {
      this.silent = options?.silent ?? false;
      this.initializePatternsSync(options?.customPatternsFile);
    }
  }

  private initializePatternsSync(customPatternsFile?: string): void {
    if (this.isInitialized) {return;}

    if (isEdgeRuntime()) {
      // In Edge runtime, use default patterns or skip loading
      this.loadDefaultPatternsForEdge();
    } else {
      // In Node.js runtime, try to load from filesystem synchronously
      try {
        // Check if require is available (CommonJS) or if we need to use dynamic import (ES modules)
        if (typeof require !== 'undefined') {
          const fs = require('fs');
          const path = require('path');
          this.loadAPIPatternsSync(customPatternsFile, fs, path);
        } else {
          // In ES modules, we can't use require synchronously, so fall back to default patterns
          // The async initialization will handle proper loading later
          if (!this.silent) { console.log('📋 ES module environment detected, using default patterns. File system patterns will be loaded asynchronously.'); }
          this.loadDefaultPatternsForEdge();
        }
      } catch {
        if (!this.silent) { console.warn('Could not load fs/path modules, falling back to default patterns'); }
        this.loadDefaultPatternsForEdge();
      }
    }

    this.isInitialized = true;
  }

  // Keep async version for explicit async initialization if needed
  private async initializePatterns(customPatternsFile?: string): Promise<void> {
    if (this.isInitialized) {return;}

    if (isEdgeRuntime()) {
      // In Edge runtime, use default patterns or skip loading
      this.loadDefaultPatternsForEdge();
    } else {
      // In Node.js runtime, load from filesystem
      await this.loadAPIPatterns(customPatternsFile);
    }

    this.isInitialized = true;
  }

  private loadDefaultPatternsForEdge(): void {
    // Default patterns for common AI services that work without filesystem access
    this.apiPatterns = [
      {
        name: 'OpenAI',
        domains: ['api.openai.com'],
        headers: {
          'authorization': 'Bearer [REDACTED]'
        }
      },
      {
        name: 'Anthropic',
        domains: ['api.anthropic.com'],
        headers: {
          'x-api-key': '[REDACTED]'
        }
      },
      {
        name: 'Google AI',
        domains: ['generativelanguage.googleapis.com'],
        headers: {
          'authorization': 'Bearer [REDACTED]'
        }
      }
    ];
    if (!this.silent) { console.log(`📋 Loaded ${this.apiPatterns.length} default API patterns for Edge runtime`); }
  }

  private async loadAPIPatterns(customPatternsFile?: string): Promise<void> {
    // Load Node.js modules first
    const hasNodeModules = await loadNodeModules();
    if (!hasNodeModules) {
      if (!this.silent) { console.warn('⚠️  Node.js modules not available, falling back to default patterns'); }
      this.loadDefaultPatternsForEdge();
      return;
    }

    try {
      let patternsFile: string;

      if (customPatternsFile) {
        // Use custom patterns file if provided
        patternsFile = path.resolve(customPatternsFile);
      } else {
        // Use default patterns file from the package's dist directory
        // Try multiple strategies to find the patterns file reliably
        const possiblePaths: string[] = [];

        // Strategy 1: Use require.resolve
        try {
          const packagePath = require.resolve('coolhand-node/package.json');
          let packageDir = path.dirname(packagePath);

          // If we get a weird Next.js path, try to resolve it
          if (!path.isAbsolute(packageDir) || packageDir.includes('(api)')) {
            // Try following symlinks
            try {
              const realPath = fs.realpathSync(require.resolve('coolhand-node/package.json'));
              packageDir = path.dirname(realPath);
            } catch {
              // Try resolving relative to cwd
              packageDir = path.resolve(process.cwd(), packageDir);
            }
          }

          possiblePaths.push(path.join(packageDir, 'dist', 'api-patterns.json'));
        } catch {
          // Ignore errors when finding package.json
        }

        // Strategy 2: __dirname method
        possiblePaths.push(path.join(__dirname, '..', 'api-patterns.json'));

        // Strategy 3: Common node_modules locations
        possiblePaths.push(path.join(process.cwd(), 'node_modules', 'coolhand-node', 'dist', 'api-patterns.json'));

        // Try each path until we find one that exists
        let foundPath = '';
        for (const candidatePath of possiblePaths) {
          if (fs.existsSync(candidatePath)) {
            foundPath = candidatePath;
            if (!this.silent) { console.log(`🔧 DEBUG: Found patterns file at: ${foundPath}`); }
            break;
          }
        }

        // If we still haven't found it, use the first candidate as fallback
        patternsFile = foundPath || possiblePaths[0] || path.join(__dirname, '..', 'api-patterns.json');
        if (!foundPath) {
          if (!this.silent) { console.log(`🔧 DEBUG: No valid path found, using fallback: ${patternsFile}`); }
        }
      }

      if (fs.existsSync(patternsFile)) {
        const fileContent = fs.readFileSync(patternsFile, 'utf-8');
        const patternsData: CoolhandAPIPatterns = JSON.parse(fileContent);
        this.apiPatterns = patternsData.patterns;
        if (!this.silent) { console.log(`📋 Loaded ${this.apiPatterns.length} API patterns from ${customPatternsFile ? 'custom' : 'default'} patterns file`); }
      } else {
        if (customPatternsFile) {
          if (!this.silent) { console.warn(`⚠️  Custom patterns file not found: ${patternsFile}. Falling back to default patterns.`); }
          // Try to load default patterns file as fallback using the same method
          let defaultPatternsFile: string;
          try {
            const packagePath = require.resolve('coolhand-node/package.json');
            const packageDir = path.dirname(packagePath);
            defaultPatternsFile = path.join(packageDir, 'dist', 'api-patterns.json');
          } catch {
            defaultPatternsFile = path.join(__dirname, '..', 'api-patterns.json');
          }

          if (fs.existsSync(defaultPatternsFile)) {
            const fileContent = fs.readFileSync(defaultPatternsFile, 'utf-8');
            const patternsData: CoolhandAPIPatterns = JSON.parse(fileContent);
            this.apiPatterns = patternsData.patterns;
            if (!this.silent) { console.log(`📋 Loaded ${this.apiPatterns.length} default API patterns as fallback`); }
          } else {
            throw new Error('Default patterns file not found');
          }
        } else {
          throw new Error('Default patterns file not found');
        }
      }
    } catch (error) {
      if (!this.silent) { console.error(`❌ Error loading API patterns:`, (error as Error).message); }
      if (!this.silent) { console.warn(`⚠️  Falling back to default patterns for Edge runtime compatibility`); }
      this.loadDefaultPatternsForEdge();
    }
  }

  private loadAPIPatternsSync(customPatternsFile: string | undefined, fs: any, _path: any): void {
    try {
      let patternsFile: string;

      if (customPatternsFile) {
        patternsFile = _path.resolve(customPatternsFile);
      } else {
        // __dirname is available in CJS but not in ESM. Use eval to access
        // import.meta.url without causing ts-jest compile errors.
        let baseDir: string;
        if (typeof __dirname !== 'undefined') {
          baseDir = __dirname;
        } else {
          try {
            const metaUrl: string = eval('import.meta.url');
            // Use fileURLToPath instead of new URL().pathname to handle
            // Windows paths correctly (e.g. /C:/foo/bar.js → C:\foo\bar.js)
            const { fileURLToPath } = require('url');
            baseDir = _path.dirname(fileURLToPath(metaUrl));
          } catch {
            baseDir = process.cwd();
          }
        }
        patternsFile = _path.join(baseDir, '..', 'api-patterns.json');
      }

      if (fs.existsSync(patternsFile)) {
        const fileContent = fs.readFileSync(patternsFile, 'utf-8');
        const patternsData: CoolhandAPIPatterns = JSON.parse(fileContent);
        this.apiPatterns = patternsData.patterns;
        if (!this.silent) { console.log(`📋 Loaded ${this.apiPatterns.length} API patterns from ${customPatternsFile ? 'custom' : 'default'} patterns file`); }
      } else {
        if (customPatternsFile) {
          if (!this.silent) { console.warn(`⚠️  API patterns file not found: ${patternsFile}`); }
        } else {
          if (!this.silent) { console.warn(`⚠️  API patterns file not found: ${patternsFile}`); }
        }
      }

    } catch (error) {
      if (!this.silent) { console.error(`❌ Error loading API patterns:`, (error as Error).message); }
      this.loadDefaultPatternsForEdge();
    }
  }

  // Ensure patterns are loaded before any operations (now always sync)
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      this.initializePatternsSync();
    }
  }

  public async matchesAPIPattern(options: CoolhandRequestOptions | string | URL): Promise<CoolhandMatchedPattern | null> {
    this.ensureInitialized();

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

  // Synchronous version for backwards compatibility (uses cached patterns)
  public matchesAPIPatternSync(options: CoolhandRequestOptions | string | URL): CoolhandMatchedPattern | null {
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
      const auth = Array.isArray(sanitized.authorization)
        ? sanitized.authorization[0]
        : sanitized.authorization;
      sanitized.authorization = String(auth).replace(/Bearer .+/, 'Bearer [REDACTED]');
    }
    if (sanitized['api-key'] !== undefined) {
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

    // Normalize header arrays to strings
    for (const key of Object.keys(sanitized)) {
      const val = sanitized[key];
      if (Array.isArray(val)) {
        sanitized[key] = val.length === 1 ? val[0] : val.join(', ');
      }
    }

    return sanitized;
  }

  public sanitizeURL(url: string): string {
    try {
      const urlObj = new URL(url);
      if (!urlObj.search) {
        return url;
      }
      const sensitiveParams = new Set(['key', 'api_key', 'apikey', 'token', 'access_token', 'secret']);
      let redacted = false;
      for (const [name] of urlObj.searchParams.entries()) {
        if (sensitiveParams.has(name.toLowerCase())) {
          urlObj.searchParams.set(name, '[REDACTED]');
          redacted = true;
        }
      }
      return redacted ? urlObj.toString() : url;
    } catch {
      return url;
    }
  }

  public async getLoadedPatterns(): Promise<CoolhandAPIPattern[]> {
    this.ensureInitialized();
    return [...this.apiPatterns];
  }

  public async getPatternsCount(): Promise<number> {
    this.ensureInitialized();
    return this.apiPatterns.length;
  }

  // Synchronous versions for backwards compatibility
  public getLoadedPatternsSync(): CoolhandAPIPattern[] {
    return [...this.apiPatterns];
  }

  public getPatternsCountSync(): number {
    return this.apiPatterns.length;
  }
}