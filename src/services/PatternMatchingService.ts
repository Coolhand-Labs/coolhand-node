import { CoolhandAPIPattern, CoolhandMatchedPattern, CoolhandRequestOptions } from '../types';
import { normalizeHostname } from '../utils/self-endpoint.js';

// Credential-bearing headers redacted unconditionally, regardless of which (if any)
// pattern matched — closes the gap where an unmatched/misdetected request or a custom
// patternsFile entry without a `headers` map would otherwise leak these unredacted.
const DEFAULT_REDACTED_HEADERS = [
  'authorization',
  'api-key',
  'x-api-key',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'openai-api-key',
  'x-goog-api-key',
  'cf-aig-authorization',
  'x-amz-security-token',
  'ocp-apim-subscription-key',
  'subscription-key',
  'xi-api-key',
];

// Header names that look credential-bearing even though they aren't in the exact-name list above
// (`x-auth-token`, `cf-access-client-secret`, `x-csrf-token`, ...). Rate-limit telemetry such as
// `anthropic-ratelimit-tokens-remaining` matches "token" but carries no secret and is genuinely
// useful in logs, so it is exempt.
const CREDENTIAL_HEADER_PATTERN = /auth|key|token|secret|cookie|passw|credential|bearer|jwt|signature/;
const CREDENTIAL_HEADER_EXEMPT_PATTERN = /rate-?limit/;

function isCredentialHeaderName(lowerName: string): boolean {
  return CREDENTIAL_HEADER_PATTERN.test(lowerName) && !CREDENTIAL_HEADER_EXEMPT_PATTERN.test(lowerName);
}

// A `domains` entry made only of `*` and `.` (e.g. `*`, `**`, `*.*`) has no label to anchor on and
// would match every host — self-inflicted by a custom patternsFile, but still worth refusing.
function isWildcardOnlyDomain(domain: string): boolean {
  return /^[*.\s]*$/.test(domain);
}

// Canonical path used for `paths`/`requiresPathMatch` matching, so a request can't dodge (or
// spuriously trigger) a match by how its path is spelled. `URL` already normalizes URL-derived
// pathnames but `http.request({ path })` reaches us verbatim, so both go through here: the query
// is dropped, dot-segments are resolved (`/x/../model/` -> `/model/`) and duplicate slashes
// collapsed (`//model/x` -> `/model/x`).
function normalizeMatchPath(path: string): string {
  const raw = path.split(/[?#]/, 1)[0];
  // Leading slashes are stripped before parsing: `//model/x` would otherwise read as a
  // protocol-relative host rather than a path.
  const resolved = raw.replace(/^\/+/, '');
  try {
    return new URL('http://coolhand.invalid/' + resolved).pathname.replace(/\/{2,}/g, '/');
  } catch {
    return '/' + resolved.replace(/\/{2,}/g, '/');
  }
}

// Synchronously resolves a Node built-in from either module format. `require` is preferred where it
// exists (CJS, and Jest — whose `jest.mock('fs')` only intercepts `require`); native ESM has no
// `require`, so it falls back to `process.getBuiltinModule` (Node 20.16+ / 22.3+). Returns null
// where neither is available (old Node in ESM, or non-Node runtimes).
interface NodeBuiltins {
  fs: typeof import('fs');
  path: typeof import('path');
  url: typeof import('url');
}

function getNodeBuiltin<K extends keyof NodeBuiltins>(name: K): NodeBuiltins[K] | null {
  if (typeof require !== 'undefined') {
    // Literal `require` calls (not `require(name)`) so bundlers can statically resolve/externalize
    // them; inside `try` so the ESM build doesn't warn about them. `require()` returns `any`, so
    // the per-key return type needs no cast.
    try {
      switch (name) {
        case 'fs': return require('fs');
        case 'path': return require('path');
        case 'url': return require('url');
      }
    } catch { /* fall through */ }
  }
  try {
    const getBuiltinModule = (process as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
    if (typeof getBuiltinModule === 'function') {
      return (getBuiltinModule.call(process, name) as NodeBuiltins[K] | undefined) ?? null;
    }
  } catch { /* not available */ }
  return null;
}

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
        const fs = getNodeBuiltin('fs');
        const path = getNodeBuiltin('path');
        if (fs && path) {
          this.loadAPIPatternsSync(customPatternsFile, fs, path);
        } else {
          // Native ESM on a Node without process.getBuiltinModule (< 20.16 / 22.3): there is no
          // synchronous way to reach fs from here, so only the built-in patterns are available.
          // A custom patterns file being silently ignored would be a surprise, so say so even in
          // silent mode.
          if (customPatternsFile) {
            console.warn(
              `⚠️  Coolhand: patternsFile "${customPatternsFile}" was NOT loaded — synchronous file loading ` +
              'is unavailable in native ESM on this Node.js version (needs 20.16+ / 22.3+, or use the CommonJS build). ' +
              'Using the built-in patterns instead.'
            );
          } else if (!this.silent) {
            console.log('📋 ES module environment without synchronous fs access detected, using built-in patterns.');
          }
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
      },
      {
        name: 'GitHub Models',
        domains: ['models.github.ai', 'models.inference.ai.azure.com'],
        headers: {
          'authorization': 'Bearer [REDACTED]'
        }
      },
      {
        name: 'Vertex AI',
        domains: ['aiplatform.googleapis.com'],
        headers: {
          'authorization': 'Bearer [REDACTED]',
          'x-goog-api-key': '[REDACTED]'
        }
      },
      {
        name: 'OpenRouter',
        domains: ['openrouter.ai'],
        headers: {
          'authorization': 'Bearer [REDACTED]',
          'x-api-key': '[REDACTED]'
        }
      },
      {
        name: 'OpenCode',
        domains: ['opencode.ai', 'api.opencode.ai'],
        headers: {
          'authorization': 'Bearer [REDACTED]',
          'x-api-key': '[REDACTED]'
        }
      },
      {
        name: 'Cloudflare AI Gateway',
        domains: ['gateway.ai.cloudflare.com'],
        headers: {
          'authorization': 'Bearer [REDACTED]',
          'cf-aig-authorization': '[REDACTED]',
          'x-api-key': '[REDACTED]',
          'openai-api-key': '[REDACTED]',
          'x-goog-api-key': '[REDACTED]'
        }
      },
      {
        name: 'Azure OpenAI',
        domains: ['openai.azure.com', 'openai.azure.us', 'openai.azure.cn'],
        headers: {
          'api-key': '[REDACTED]'
        }
      },
      {
        name: 'Azure AI Services',
        domains: [
          'cognitiveservices.azure.com', 'cognitiveservices.azure.us', 'cognitiveservices.azure.cn',
          'services.ai.azure.com', 'services.ai.azure.us'
        ],
        paths: ['/openai/', '/models/', '/api/projects/'],
        requiresPathMatch: true,
        headers: {
          'api-key': '[REDACTED]',
          'ocp-apim-subscription-key': '[REDACTED]'
        }
      },
      {
        name: 'Azure AI Foundry (Serverless)',
        domains: ['inference.ai.azure.com', 'models.ai.azure.com'],
        headers: {
          'authorization': '[REDACTED]'
        }
      },
      {
        // Azure ML managed online endpoints all score at /score regardless of what's
        // deployed behind them (LLM, tabular, vision, ...) — no path can distinguish an
        // LLM deployment from any other, so this is deliberately unanchored rather than
        // missing LLM traffic. See issue #245.
        name: 'Azure Machine Learning',
        domains: ['inference.ml.azure.com', 'inference.ml.azure.us'],
        headers: {
          'authorization': '[REDACTED]'
        }
      },
      {
        name: 'DeepSeek',
        domains: ['api.deepseek.com'],
        headers: {
          'authorization': '[REDACTED]'
        }
      },
      {
        name: 'Mistral',
        domains: ['api.mistral.ai'],
        headers: {
          'authorization': '[REDACTED]'
        }
      },
      {
        name: 'Perplexity',
        domains: ['api.perplexity.ai'],
        headers: {
          'authorization': '[REDACTED]'
        }
      },
      {
        name: 'xAI',
        domains: ['api.x.ai'],
        headers: {
          'authorization': '[REDACTED]'
        }
      },
      {
        name: 'Cohere',
        domains: ['api.cohere.com', 'api.cohere.ai'],
        paths: ['/v2/chat', '/v1/embed', '/v2/embed'],
        requiresPathMatch: true,
        headers: {
          'authorization': '[REDACTED]'
        }
      },
      {
        name: 'TypeSafe Jev',
        domains: ['api.typesafe.ai'],
        paths: ['/v1/systemone'],
        requiresPathMatch: true,
        headers: {
          'authorization': '[REDACTED]'
        }
      },
      {
        name: 'Ollama',
        domains: ['ollama.com'],
        paths: ['/api/chat', '/api/generate', '/api/embed', '/api/embeddings'],
        ports: [11434],
        requiresPathMatch: true,
        headers: {
          'authorization': '[REDACTED]'
        }
      },
      {
        name: 'Bedrock',
        domains: ['bedrock-runtime.*.amazonaws.com', 'bedrock-runtime-fips.*.amazonaws.com', 'bedrock-runtime.*.amazonaws.com.cn'],
        paths: ['/model/', '/openai/'],
        requiresPathMatch: true,
        headers: {
          'authorization': '[REDACTED]',
          'x-amz-security-token': '[REDACTED]'
        }
      },
      {
        name: 'ElevenLabs',
        domains: ['api.elevenlabs.io'],
        headers: {
          'xi-api-key': '[REDACTED]'
        }
      }
    ];
    if (!this.silent) { console.log(`📋 Loaded ${this.apiPatterns.length} default API patterns for Edge runtime`); }
  }

  // Guards against valid JSON that isn't shaped as { patterns: [{ domains: string[], ... }] } —
  // e.g. a typo'd or hand-edited COOLHAND_PATTERNS_FILE — so it triggers the same
  // fallback-to-defaults path as invalid JSON, instead of crashing every request later.
  private validatePatternsShape(patternsData: unknown, sourceFile: string): CoolhandAPIPattern[] {
    const patterns = (patternsData as { patterns?: unknown } | null)?.patterns;
    const isStringArray = (value: unknown): boolean => Array.isArray(value) && value.every((item) => typeof item === 'string');
    const isValid = Array.isArray(patterns) && patterns.every((pattern) => {
      if (!pattern || typeof pattern !== 'object') { return false; }
      const { domains, paths, ports } = pattern as CoolhandAPIPattern;
      // `paths`/`ports` are read on every request by findDomainMatch, so a wrong type here would
      // throw inside the hot path and disable matching for every pattern after this one.
      return isStringArray(domains)
        && (paths === undefined || isStringArray(paths))
        && (ports === undefined || (Array.isArray(ports) && ports.every((port) => Number.isInteger(port))));
    });
    if (!isValid) {
      throw new Error(`Coolhand: patterns file "${sourceFile}" is not shaped correctly (expected { patterns: [{ domains: string[], paths?: string[], ports?: number[], ... }] })`);
    }
    return (patterns as CoolhandAPIPattern[]).map((pattern) => {
      const domains = pattern.domains.filter((domain) => {
        if (typeof domain === 'string' && isWildcardOnlyDomain(domain)) {
          if (!this.silent) { console.warn(`⚠️  Coolhand: ignoring domain "${domain}" in "${pattern.name}" (${sourceFile}) — it would match every host`); }
          return false;
        }
        return true;
      });
      return domains.length === pattern.domains.length ? pattern : { ...pattern, domains };
    });
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
        const patternsData: unknown = JSON.parse(fileContent);
        this.apiPatterns = this.validatePatternsShape(patternsData, patternsFile);
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
            const patternsData: unknown = JSON.parse(fileContent);
            this.apiPatterns = this.validatePatternsShape(patternsData, defaultPatternsFile);
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
            const fileURLToPath = getNodeBuiltin('url')?.fileURLToPath;
            if (!fileURLToPath) { throw new Error('url module unavailable'); }
            baseDir = _path.dirname(fileURLToPath(metaUrl));
          } catch {
            baseDir = process.cwd();
          }
        }
        // Try the current directory first (tsup bundle: dist/index.cjs → baseDir = dist/).
        // Fall back to the parent directory (tsc/Jest source: src/services/ → need ../ to reach src/).
        const candidates: string[] = [
          _path.join(baseDir, 'api-patterns.json'),
          _path.join(baseDir, '..', 'api-patterns.json'),
        ];
        patternsFile = candidates.find((p: string) => fs.existsSync(p)) || candidates[0];
      }

      if (fs.existsSync(patternsFile)) {
        const fileContent = fs.readFileSync(patternsFile, 'utf-8');
        const patternsData: unknown = JSON.parse(fileContent);
        this.apiPatterns = this.validatePatternsShape(patternsData, patternsFile);
        if (!this.silent) { console.log(`📋 Loaded ${this.apiPatterns.length} API patterns from ${customPatternsFile ? 'custom' : 'default'} patterns file`); }
      } else {
        if (!this.silent) { console.warn(`⚠️  API patterns file not found: ${patternsFile}. Falling back to default patterns.`); }
        this.loadDefaultPatternsForEdge();
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

  private hostnameMatchesDomain(hostname: string, domain: string): boolean {
    if (domain.includes('*')) {
      return !isWildcardOnlyDomain(domain) && this.wildcardDomainRegex(domain).test(hostname);
    }
    // `hostname` is already lowercased by findDomainMatch; lowercase the configured domain too
    // so a custom pattern written as `API.Example.com` keeps matching.
    const lowerDomain = domain.toLowerCase();
    return hostname === lowerDomain || hostname.endsWith('.' + lowerDomain);
  }

  // A `*` in a domain stands for exactly one DNS label (e.g. the region in
  // `bedrock-runtime.*.amazonaws.com`). Like plain domains, it also matches any
  // subdomain in front of it.
  private wildcardDomainCache = new Map<string, RegExp>();
  private wildcardDomainRegex(domain: string): RegExp {
    let regex = this.wildcardDomainCache.get(domain);
    if (!regex) {
      // Consecutive `*`s mean the same as one (a label), and left as-is they would build a regex
      // with polynomial backtracking (`[a-z0-9-]+[a-z0-9-]+...`).
      const body = domain.replace(/\*+/g, '*').split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9-]+');
      regex = new RegExp(`(^|\\.)${body}$`, 'i');
      this.wildcardDomainCache.set(domain, regex);
    }
    return regex;
  }

  // An entry matches `pathname` as a prefix that ends on a segment boundary, so `/v1/embed`
  // matches `/v1/embed` and `/v1/embed/x` but not `/v1/embed-jobs`; an entry that itself ends
  // in `/` is a plain prefix.
  private pathnameMatchesEntry(pathname: string, entry: string): boolean {
    if (!pathname.startsWith(entry)) { return false; }
    return entry.endsWith('/') || pathname.length === entry.length || pathname[entry.length] === '/';
  }

  // Single domain-matching implementation shared by every entry point (options-based and
  // URL-based, async and sync), so `requiresPathMatch` and `ports` behave identically
  // everywhere. Without `requiresPathMatch` a `domains` match applies to every path, exactly
  // as it always has. With it, the request must also hit one of the pattern's `paths` — and
  // only then may `ports` identify a host-less provider such as a local Ollama.
  // `path` may still carry a query string (http.request's options.path does). This runs on
  // every http/https/fetch call, so the cheap host/port test comes first and the path is only
  // split for patterns whose host or port already matched.
  private findDomainMatch(hostname: string, port: number | undefined, path: string | undefined): CoolhandMatchedPattern | null {
    let pathname: string | undefined;
    // Hostnames are case-insensitive, and `options.hostname` reaches us exactly as the host
    // app wrote it (only URL-derived hostnames are already lowercased).
    // Also drops a trailing dot: `api.openai.com.` is the same DNS name as `api.openai.com`.
    const lowerHostname = normalizeHostname(hostname);
    for (const pattern of this.apiPatterns) {
      const matchedDomain = pattern.domains.find((domain) => this.hostnameMatchesDomain(lowerHostname, domain));
      const portMatches = pattern.requiresPathMatch === true && port !== undefined && pattern.ports?.includes(port) === true;
      if (matchedDomain === undefined && !portMatches) { continue; }

      if (!pattern.requiresPathMatch) {
        if (matchedDomain === undefined) { continue; }
        return { pattern, matchType: 'domain', matchValue: matchedDomain };
      }

      if (path === undefined) { continue; }
      pathname ??= normalizeMatchPath(path);
      const requestPathname = pathname;
      const matchedPath = pattern.paths?.find((entry) => this.pathnameMatchesEntry(requestPathname, entry));
      if (matchedPath === undefined) { continue; }

      return matchedDomain !== undefined
        ? { pattern, matchType: 'domain', matchValue: matchedDomain }
        : { pattern, matchType: 'path', matchValue: matchedPath };
    }
    return null;
  }

  private matchesFromOptions(options: CoolhandRequestOptions): CoolhandMatchedPattern | null {
    const hostname = options.hostname || options.host || '';
    // Node accepts a numeric string for `port`; normalize so `ports` compares reliably.
    const port = Number(options.port) || undefined;
    return this.findDomainMatch(hostname, port, this.pathFromOptions(options));
  }

  private pathFromOptions(options: CoolhandRequestOptions): string | undefined {
    if (options.path) { return options.path; } // normalized in findDomainMatch
    const full = options.href || options.url;
    if (full) {
      try { return new URL(full).pathname; } catch { return undefined; }
    }
    return undefined;
  }

  // Defense in depth: a bug in any matcher (e.g. malformed apiPatterns surviving
  // load-time validation) must never break the host app's networking — this is the
  // hot path called from every patched http/https/fetch entry point.
  private safeMatch(fn: () => CoolhandMatchedPattern | null): CoolhandMatchedPattern | null {
    try {
      return fn();
    } catch (error) {
      if (!this.silent) { console.warn(`⚠️  Coolhand: pattern matching failed, request will not be monitored:`, (error as Error).message); }
      return null;
    }
  }

  public async matchesAPIPattern(options: CoolhandRequestOptions | string | URL): Promise<CoolhandMatchedPattern | null> {
    return this.safeMatch(() => {
      this.ensureInitialized();

      if (typeof options === 'string') {
        return this.matchesAPIPatternFromURL(options);
      }

      if (options instanceof URL) {
        return this.matchesAPIPatternFromURL(options.toString());
      }

      return this.matchesFromOptions(options);
    });
  }

  // Synchronous version for backwards compatibility (uses cached patterns)
  public matchesAPIPatternSync(options: CoolhandRequestOptions | string | URL): CoolhandMatchedPattern | null {
    return this.safeMatch(() => {
      if (typeof options === 'string') {
        return this.matchesAPIPatternFromURL(options);
      }

      if (options instanceof URL) {
        return this.matchesAPIPatternFromURL(options.toString());
      }

      return this.matchesFromOptions(options);
    });
  }

  public matchesAPIPatternFromURL(url: string): CoolhandMatchedPattern | null {
    return this.safeMatch(() => {
      let urlObj: URL;
      try {
        urlObj = new URL(url);
      } catch {
        // Unparseable URL — no hostname can be reliably/safely anchored, so there is
        // nothing left to match against. Every call site already treats `null` as
        // "not one of our providers, pass through unmonitored," which is the correct,
        // safe behavior here — see issue #171 (unanchored substring fallback let
        // e.g. "notopenai.com" or "evil.com/openai.com/x" falsely match). Scoped to just
        // the URL constructor so an unrelated bug in the matching loops below (e.g.
        // corrupted apiPatterns) still escapes to safeMatch's warning instead of being
        // silently swallowed here too.
        return null;
      }

      const domainMatch = this.findDomainMatch(urlObj.hostname, Number(urlObj.port) || undefined, urlObj.pathname);
      if (domainMatch) { return domainMatch; }

      // Check path matches (only for patterns that explicitly opt in to
      // cross-domain path matching — see CoolhandAPIPattern.allowPathMatchAcrossDomains)
      for (const pattern of this.apiPatterns) {
        if (pattern.paths && pattern.allowPathMatchAcrossDomains) {
          for (const pathPattern of pattern.paths) {
            if (normalizeMatchPath(urlObj.pathname).includes(pathPattern)) {
              return {
                pattern,
                matchType: 'path',
                matchValue: pathPattern
              };
            }
          }
        }
      }

      return null;
    });
  }

  // http(s).request accepts `options.headers` as an array too — either flat
  // (`['Authorization', 'Bearer ...']`) or as `[name, value]` pairs — whose Object.entries() keys
  // would be array indexes, so nothing below would ever match a credential header.
  private static headerEntries(headers: unknown): Array<[string, unknown]> {
    if (!Array.isArray(headers)) {
      return Object.entries((headers ?? {}) as Record<string, unknown>);
    }
    if (headers.some((item) => Array.isArray(item))) {
      return headers.filter((item): item is [string, unknown] => Array.isArray(item) && typeof item[0] === 'string');
    }
    const entries: Array<[string, unknown]> = [];
    for (let i = 0; i + 1 < headers.length; i += 2) {
      if (typeof headers[i] === 'string') { entries.push([headers[i], headers[i + 1]]); }
    }
    return entries;
  }

  public sanitizeHeaders(headers: any, pattern?: CoolhandAPIPattern): Record<string, any> {
    // Repeated names (flat/pair arrays can repeat one) are collected first and joined by the
    // normalization pass below; a Map keeps this linear and immune to names like `constructor`
    // colliding with Object.prototype.
    const collected = new Map<string, unknown[]>();
    for (const [key, value] of PatternMatchingService.headerEntries(headers)) {
      const name = key.toLowerCase();
      const values = collected.get(name);
      if (values) { values.push(value); } else { collected.set(name, [value]); }
    }
    const sanitized: Record<string, any> = Object.fromEntries(
      Array.from(collected, ([name, values]) => [name, values.length === 1 ? values[0] : values.flat()])
    );

    // Default sanitization rules — applied unconditionally, independent of pattern match
    for (const headerName of DEFAULT_REDACTED_HEADERS) {
      if (sanitized[headerName] !== undefined) {
        sanitized[headerName] = '[REDACTED]';
      }
    }
    for (const headerName of Object.keys(sanitized)) {
      if (sanitized[headerName] !== undefined && isCredentialHeaderName(headerName)) {
        sanitized[headerName] = '[REDACTED]';
      }
    }

    // Pattern-specific sanitization
    if (pattern?.headers) {
      for (const [headerKey, redactionValue] of Object.entries(pattern.headers)) {
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

  // Compared via normalizeKey (lowercased, `_`/`-` stripped) so `accessToken`, `access_token` and
  // `access-token` are all one entry.
  // x-goog-api-key is normally sent as a header (already redacted via sanitizeHeaders/
  // api-patterns.json) — included here too as defense-in-depth for callers that pass it
  // as a query param instead. X-Amz-Signature/X-Amz-Credential are genuinely query params
  // on AWS SigV4-presigned URLs. subscription-key is APIM's query-param form of the
  // Ocp-Apim-Subscription-Key header (Azure Cognitive Services / AI Foundry family).
  private static readonly SENSITIVE_QUERY_PARAMS = new Set([
    'key', 'api_key', 'apikey', 'token', 'access_token', 'secret',
    'password', 'signature', 'sig', 'x-goog-api-key',
    'x-amz-signature', 'x-amz-credential', 'x-amz-security-token',
    'subscription-key', 'ocp-apim-subscription-key', 'x-api-key', 'client_secret', 'refresh_token', 'id_token', 'authorization',
    'api_token', 'auth_token', 'bearer_token', 'secret_key', 'private_key', 'access_key', 'auth', 'bearer', 'pwd'
  ].map((name) => PatternMatchingService.normalizeKey(name)));

  public sanitizeURL(url: string): string {
    try {
      const urlObj = new URL(url);
      let redacted = false;
      // `https://user:pass@host/...` — userinfo is a credential too.
      if (urlObj.username || urlObj.password) {
        urlObj.username = '';
        urlObj.password = '';
        redacted = true;
      }
      if (urlObj.search) {
        // Rebuilt in one pass rather than calling searchParams.set() per sensitive name: set() has
        // to drop every duplicate of that name and is quadratic on a URL with many repeated params.
        const params = new URLSearchParams();
        let paramRedacted = false;
        for (const [name, value] of urlObj.searchParams) {
          if (PatternMatchingService.SENSITIVE_QUERY_PARAMS.has(PatternMatchingService.normalizeKey(name))) {
            params.append(name, '[REDACTED]');
            paramRedacted = true;
          } else {
            params.append(name, value);
          }
        }
        if (paramRedacted) {
          urlObj.search = params.toString();
          redacted = true;
        }
      }
      return redacted ? urlObj.toString() : url;
    } catch {
      return url;
    }
  }

  // Substrings (not exact key names) so e.g. Elasticsearch's `encoded_api_key` is caught
  // even though it isn't literally `api_key`. Normalized/compared with separators stripped
  // so `connection_string` and `connectionString` are both caught by one entry.
  private static readonly CREDENTIAL_KEY_FRAGMENTS = ['key', 'secret', 'password', 'passwd', 'pwd', 'token', 'credential', 'connectionstring'];

  private static normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[_-]/g, '');
  }

  // Credential-bearing keys that are redacted wherever they appear in a body, normalized as above:
  //  - Anthropic `mcp_servers[].authorization_token`
  //  - OpenAI realtime `client_secret` (an ephemeral key returned in *response* bodies)
  private static readonly ALWAYS_REDACTED_BODY_KEYS = new Set(['authorizationtoken', 'clientsecret']);

  // `authorization` / `headers` are only credentials on an MCP tool/server definition — OpenAI
  // Responses MCP tools carry `{ type: 'mcp', server_url, authorization, headers }`. Scoped to
  // those objects because a bare `headers` or `authorization` key elsewhere (tool schemas, message
  // content) is ordinary data.
  private static readonly MCP_CREDENTIAL_KEYS = new Set(['authorization', 'headers']);

  // Deeper subtrees are replaced rather than walked, so a pathologically nested body can't blow the
  // stack — and, failing closed, whatever is in them is never logged.
  private static readonly MAX_BODY_DEPTH = 64;

  private static isMcpDefinition(node: Record<string, unknown>): boolean {
    return node.type === 'mcp' || 'server_url' in node || 'serverUrl' in node || 'server_label' in node || 'serverLabel' in node;
  }

  // Credentials that appear in request/response bodies rather than headers/URLs, which
  // sanitizeHeaders/sanitizeURL never see:
  //  - Azure OpenAI's "On Your Data" feature embeds datastore credentials under
  //    data_sources/dataSources (e.g. an Azure AI Search admin key, or a Cosmos/Mongo connection
  //    string). Scoped to that subtree so message content and tool schemas outside it stay
  //    verbatim. See issue #245.
  //  - MCP server/tool credentials and realtime client secrets (see the key sets above).
  private redactBodyCredentials(value: unknown, insideDataSources: boolean, depth: number): unknown {
    if (depth > PatternMatchingService.MAX_BODY_DEPTH) {
      return '[REDACTED: nested too deeply]';
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.redactBodyCredentials(item, insideDataSources, depth + 1));
    }

    if (value && typeof value === 'object') {
      const node = value as Record<string, unknown>;
      const isMcp = PatternMatchingService.isMcpDefinition(node);
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node)) {
        const normalizedKey = PatternMatchingService.normalizeKey(key);
        const nowInside = insideDataSources || normalizedKey === 'datasources';
        const redact =
          (nowInside && PatternMatchingService.CREDENTIAL_KEY_FRAGMENTS.some((fragment) => normalizedKey.includes(fragment))) ||
          PatternMatchingService.ALWAYS_REDACTED_BODY_KEYS.has(normalizedKey) ||
          (isMcp && PatternMatchingService.MCP_CREDENTIAL_KEYS.has(normalizedKey));
        const next = redact ? '[REDACTED]' : this.redactBodyCredentials(val, nowInside, depth + 1);
        if (key === '__proto__') {
          // A plain assignment would set the prototype and silently drop the key from the log.
          Object.defineProperty(result, key, { value: next, enumerable: true, writable: true, configurable: true });
        } else {
          result[key] = next;
        }
      }
      return result;
    }

    return value;
  }

  // Each letter of a credential word may also appear as a JSON `\\uXXXX` escape (`"pass\\u0077ord"`
  // is the key `password` once parsed), so the words are matched escape-aware rather than literally.
  private static escapeAwareWord(word: string): string {
    return Array.from(word)
      .map((ch) => {
        const hex = (c: string) => c.charCodeAt(0).toString(16).padStart(4, '0');
        return `(?:${ch}|\\\\u${hex(ch.toLowerCase())}|\\\\u${hex(ch.toUpperCase())})`;
      })
      .join('');
  }

  // The credential words, matched on their own (no surrounding context) so the scan is a single
  // linear pass; redactCredentialStrings then checks the quotes around each hit.
  private static readonly CREDENTIAL_WORD_PATTERN = (() => {
    const word = (w: string) => PatternMatchingService.escapeAwareWord(w);
    return new RegExp([
      word('key'), word('secret'), word('password'), word('token'), word('authorization'),
      `${word('connection')}(?:_|\\\\u005f)?${word('string')}`,
    ].join('|'), 'gi');
  })();

  // A key must be at most this many characters on either side of the credential word, so a stray
  // quote far away can't make a whole span of prose look like one key.
  private static readonly MAX_KEY_AFFIX = 200;

  // Replaces the string value of every `"<key containing a credential word>" : "..."` in an
  // unparseable body (malformed or truncated — a body that parses as JSON never reaches this). The
  // value may be unterminated: a body cut off at the capture cap can end mid-credential.
  //
  // Anchored on the key rather than tokenizing every string, so an unbalanced or stray quote
  // elsewhere can't flip string parity and hide a credential. Linear on adversarial input: credential
  // words are found in one pass, and the quotes around them come from a cursor that only moves
  // forward (each quote is visited once) — per-hit `indexOf`/`lastIndexOf` would rescan a long
  // quote-free span for every hit. Keys with an unescaped quote inside, or longer than MAX_KEY_AFFIX
  // around the word, are not matched.
  private redactCredentialStrings(text: string): string {
    const words = new RegExp(PatternMatchingService.CREDENTIAL_WORD_PATTERN);
    const keyTail = /\s*:\s*"/y;
    const maxAffix = PatternMatchingService.MAX_KEY_AFFIX;

    let prevQuote = -1; // last quote before the current word
    let nextQuote = text.indexOf('"'); // first quote at/after the current word
    const advanceTo = (position: number) => {
      while (nextQuote !== -1 && nextQuote < position) {
        prevQuote = nextQuote;
        nextQuote = text.indexOf('"', nextQuote + 1);
      }
    };

    let out = '';
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = words.exec(text)) !== null) {
      const wordEnd = match.index + match[0].length;
      advanceTo(match.index);
      if (prevQuote === -1 || nextQuote === -1) { continue; }
      if (match.index - prevQuote - 1 > maxAffix || nextQuote - wordEnd > maxAffix) { continue; }

      keyTail.lastIndex = nextQuote + 1;
      if (!keyTail.test(text)) { continue; }

      const valueStart = keyTail.lastIndex;
      let end = valueStart;
      while (end < text.length && text[end] !== '"') {
        end += text[end] === '\\' ? 2 : 1;
      }
      end = Math.min(end, text.length);
      out += text.slice(last, valueStart) + '[REDACTED]';
      last = end; // the closing quote (if any) is kept
      words.lastIndex = end;
    }
    return out + text.slice(last);
  }

  // Bodies reach us as strings whenever parseBody couldn't produce an object: a top-level JSON
  // array (re-joined as NDJSON), NDJSON itself, a BOM-prefixed document, or a body truncated at the
  // capture cap. They must be redacted like parsed bodies rather than logged verbatim.
  private sanitizeStringBody(text: string): string {
    const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

    try {
      return JSON.stringify(this.redactBodyCredentials(JSON.parse(stripped), false, 0));
    } catch { /* not a single JSON document */ }

    const lines = stripped.split('\n');
    if (lines.length > 1) {
      try {
        return lines
          .map((line) => (line.trim() === '' ? line : JSON.stringify(this.redactBodyCredentials(JSON.parse(line), false, 0))))
          .join('\n');
      } catch { /* not NDJSON either */ }
    }

    // Unparseable (truncated, malformed): can't know the structure, so redact by key name instead.
    // Deliberately over-inclusive — a body we can't parse is safer over-redacted than leaked.
    return this.redactCredentialStrings(text);
  }

  public sanitizeBody(body: Record<string, unknown> | string | null): Record<string, unknown> | string | null {
    if (!body) {
      return body;
    }
    try {
      if (typeof body === 'string') {
        return this.sanitizeStringBody(body);
      }
      if (typeof body !== 'object') {
        return body;
      }
      return this.redactBodyCredentials(body, false, 0) as Record<string, unknown>;
    } catch (error) {
      if (!this.silent) { console.warn(`⚠️  Coolhand: body sanitization failed, request body will not be captured:`, (error as Error).message); }
      return null;
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