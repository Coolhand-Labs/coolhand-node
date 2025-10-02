import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { CoolhandOptions, CallData, Stats, RequestOptions, LogPayload, APIPatterns, APIPattern, MatchedPattern } from './types';

export class Coolhand {
  private callCounter: number = 0;
  private interceptedCalls: number = 0;
  private silent: boolean;
  private environment: 'local' | 'production';
  private apiKey: string;
  private apiEndpoint: string;
  private apiPatterns: APIPattern[] = [];
  private static isPatched: boolean = false;

  constructor(options: CoolhandOptions) {
    // Configuration options
    this.silent = options.silent !== false;
    this.environment = options.environment || 'production';
    this.apiKey = options.apiKey;

    // Set API endpoint based on environment
    this.apiEndpoint = this.environment === 'production'
      ? 'https://coolhand.io/api/v2/llm_request_logs'
      : 'http://localhost:3000/api/v2/llm_request_logs';

    if (!this.apiKey) {
      console.error('❌ API key is required for logging. Pass it in options.apiKey');
      throw new Error('API key is required');
    }

    // Load API patterns
    this.loadAPIPatterns(options.patternsFile);

    if (!this.silent) {
      console.log('🔍 Setting up Coolhand...');
      console.log(`🌍 Environment: ${this.environment}`);
      console.log(`🎯 API Endpoint: ${this.apiEndpoint}`);
      console.log(`📋 Loaded ${this.apiPatterns.length} API patterns`);
    }

    this.setupMonitoring();

    if (!this.silent) {
      console.log('✅ Coolhand ready - will log to API');
    }
  }

  private log(...args: any[]): void {
    if (!this.silent) {
      console.log(...args);
    }
  }

  private loadAPIPatterns(customPatternsFile?: string): void {
    try {
      let patternsFile: string;

      if (customPatternsFile) {
        // Use custom patterns file if provided
        patternsFile = path.resolve(customPatternsFile);
      } else {
        // Use default patterns file
        patternsFile = path.join(__dirname, 'api-patterns.json');
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

  private setupMonitoring(): void {
    if (!Coolhand.isPatched) {
      // Patch HTTPS
      this.patchHTTPS();

      // Patch HTTP (some libraries might use HTTP with upgrade)
      this.patchHTTP();

      // Patch fetch if available (Node 18+)
      this.patchFetch();

      Coolhand.isPatched = true;
    }

    // Debug: Log when any request happens
    this.log('📡 Monitoring all outbound requests...');
  }

  private patchHTTPS(): void {
    const originalRequest = https.request;
    const originalGet = https.get;
    const monitor = this;

    try {
      const requestDescriptor = Object.getOwnPropertyDescriptor(https, 'request');
      if (!requestDescriptor || requestDescriptor.configurable !== false) {
        Object.defineProperty(https, 'request', {
          value: function(options: RequestOptions | string | URL, callback?: (res: http.IncomingMessage) => void) {
            monitor.debugRequest('HTTPS REQUEST', options);

            // Check if this matches any API pattern
            const matchedPattern = monitor.matchesAPIPattern(options);

            if (matchedPattern) {
              monitor.log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTPS call`);
              return monitor.interceptRequest(originalRequest, options, callback, 'https', matchedPattern);
            }

            return originalRequest.call(this, options as any, callback as any);
          },
          writable: true,
          configurable: true
        });
      }
    } catch (error) {
      // Silently ignore if we can't patch
      monitor.log('Warning: Could not patch https.request');
    }

    try {
      const getDescriptor = Object.getOwnPropertyDescriptor(https, 'get');
      if (!getDescriptor || getDescriptor.configurable !== false) {
        Object.defineProperty(https, 'get', {
          value: function(options: RequestOptions | string | URL, callback?: (res: http.IncomingMessage) => void) {
            monitor.debugRequest('HTTPS GET', options);
            const matchedPattern = monitor.matchesAPIPattern(options);

            if (matchedPattern) {
              monitor.log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTPS GET`);
              return monitor.interceptRequest(originalRequest, options, callback, 'https', matchedPattern);
            }

            return originalGet.call(this, options as any, callback as any);
          },
          writable: true,
          configurable: true
        });
      }
    } catch (error) {
      // Silently ignore if we can't patch
      monitor.log('Warning: Could not patch https.get');
    }
  }

  private patchHTTP(): void {
    const originalRequest = http.request;
    const originalGet = http.get;
    const monitor = this;

    try {
      const requestDescriptor = Object.getOwnPropertyDescriptor(http, 'request');
      if (!requestDescriptor || requestDescriptor.configurable !== false) {
        Object.defineProperty(http, 'request', {
          value: function(options: RequestOptions | string | URL, callback?: (res: http.IncomingMessage) => void) {
            monitor.debugRequest('HTTP REQUEST', options);
            const matchedPattern = monitor.matchesAPIPattern(options);

            if (matchedPattern) {
              monitor.log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTP call`);
              return monitor.interceptRequest(originalRequest, options, callback, 'http', matchedPattern);
            }

            return originalRequest.call(this, options as any, callback as any);
          },
          writable: true,
          configurable: true
        });
      }
    } catch (error) {
      // Silently ignore if we can't patch
      monitor.log('Warning: Could not patch http.request');
    }

    try {
      const getDescriptor = Object.getOwnPropertyDescriptor(http, 'get');
      if (!getDescriptor || getDescriptor.configurable !== false) {
        Object.defineProperty(http, 'get', {
          value: function(options: RequestOptions | string | URL, callback?: (res: http.IncomingMessage) => void) {
            monitor.debugRequest('HTTP GET', options);
            const matchedPattern = monitor.matchesAPIPattern(options);

            if (matchedPattern) {
              monitor.log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTP GET`);
              return monitor.interceptRequest(originalRequest, options, callback, 'http', matchedPattern);
            }

            return originalGet.call(this, options as any, callback as any);
          },
          writable: true,
          configurable: true
        });
      }
    } catch (error) {
      // Silently ignore if we can't patch
      monitor.log('Warning: Could not patch http.get');
    }
  }

  private patchFetch(): void {
    if (typeof globalThis.fetch === 'function') {
      const originalFetch = globalThis.fetch;
      const monitor = this;

      globalThis.fetch = async function(url: string | URL | Request, options: RequestInit = {}) {
        const urlStr = typeof url === 'string' ? url : url.toString();

        monitor.debugRequest('FETCH', { url: urlStr, ...options });

        const matchedPattern = monitor.matchesAPIPatternFromURL(urlStr);

        if (matchedPattern) {
          monitor.log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} FETCH call`);
          return monitor.interceptFetch(originalFetch, url, options, matchedPattern);
        }

        return originalFetch.call(this, url, options);
      };
    }
  }

  private matchesAPIPattern(options: RequestOptions | string | URL): MatchedPattern | null {
    if (typeof options === 'string') {
      return this.matchesAPIPatternFromURL(options);
    }

    if (options instanceof URL) {
      return this.matchesAPIPatternFromURL(options.toString());
    }

    // Construct URL from options
    const hostname = options.hostname || options.host || '';
    const path = options.path || '';

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

  private matchesAPIPatternFromURL(url: string): MatchedPattern | null {
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
    } catch (error) {
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

  private debugRequest(type: string, options: RequestOptions | string | URL | any): void {
    const hostname = typeof options === 'string' ? options :
                    options instanceof URL ? options.hostname :
                    options.hostname || options.host || options.url || 'unknown';
    this.log(`🌐 ${type} to: ${hostname}`);

    // Count all requests
    this.callCounter++;
  }

  private interceptRequest(
    originalRequest: typeof https.request | typeof http.request,
    options: RequestOptions | string | URL,
    callback?: (res: http.IncomingMessage) => void,
    protocol: 'https' | 'http' = 'https',
    matchedPattern?: MatchedPattern
  ): http.ClientRequest {
    this.interceptedCalls++;

    const url = this.buildURL(options, protocol);

    const callData: CallData = {
      id: this.interceptedCalls,
      timestamp: new Date().toISOString(),
      method: typeof options === 'object' && 'method' in options ? options.method || 'GET' : 'GET',
      url: url,
      headers: this.sanitizeHeaders(typeof options === 'object' && 'headers' in options ? options.headers || {} : {}, matchedPattern?.pattern),
      request_body: null,
      response_body: null,
      response_headers: null,
      status_code: null,
      protocol: protocol
    };

    this.log(`📞 Starting API call #${callData.id} to ${url}`);

    let requestBody = '';

    const req = originalRequest(options as any, (res: http.IncomingMessage) => {
      this.log(`📥 Response received for call #${callData.id}, status: ${res.statusCode}`);

      let responseBody = '';

      res.on('data', (chunk: any) => {
        responseBody += chunk.toString();
      });

      res.on('end', () => {
        callData.response_body = this.parseJSON(responseBody);
        callData.response_headers = this.sanitizeHeaders(res.headers, matchedPattern?.pattern);
        callData.status_code = res.statusCode || null;

        this.logCallToAPI(callData, matchedPattern);
      });

      if (callback) callback(res);
    });

    // Intercept request body
    const originalWrite = req.write.bind(req);
    const originalEnd = req.end.bind(req);

    req.write = function(chunk: any, encoding?: any, callback?: any) {
      if (chunk) {
        requestBody += chunk.toString();
      }
      return originalWrite(chunk, encoding, callback);
    };

    req.end = ((chunk?: any, encoding?: any, callback?: any) => {
      if (chunk) {
        requestBody += chunk.toString();
      }
      callData.request_body = this.parseJSON(requestBody);
      this.log(`📤 Request complete for call #${callData.id}`);
      return originalEnd(chunk, encoding, callback);
    }).bind(this);

    req.on('error', (err) => {
      this.log(`❌ Request error for call #${callData.id}:`, err.message);
    });

    return req;
  }

  private async interceptFetch(originalFetch: typeof fetch, url: string | URL | Request, options: RequestInit, matchedPattern?: MatchedPattern): Promise<Response> {
    this.interceptedCalls++;

    const callData: CallData = {
      id: this.interceptedCalls,
      timestamp: new Date().toISOString(),
      method: options.method || 'GET',
      url: url.toString(),
      headers: this.sanitizeHeaders(options.headers || {}, matchedPattern?.pattern),
      request_body: options.body ? this.parseJSON(options.body as string) : null,
      response_body: null,
      response_headers: null,
      status_code: null,
      protocol: 'fetch'
    };

    this.log(`📞 Starting FETCH call #${callData.id} to ${url}`);

    try {
      const response = await originalFetch.call(globalThis, url, options);

      callData.status_code = response.status;
      callData.response_headers = Object.fromEntries(response.headers.entries());

      // Clone response to read body without consuming it
      const responseClone = response.clone();
      const responseText = await responseClone.text();
      callData.response_body = this.parseJSON(responseText);

      this.logCallToAPI(callData, matchedPattern);

      return response;
    } catch (error) {
      this.log(`❌ Fetch error for call #${callData.id}:`, (error as Error).message);
      throw error;
    }
  }

  private buildURL(options: RequestOptions | string | URL, protocol: string): string {
    if (typeof options === 'string') {
      return options;
    }

    if (options instanceof URL) {
      return options.toString();
    }

    if (options.href) return options.href;

    const hostname = options.hostname || options.host || 'unknown';
    const path = options.path || '/';
    const port = options.port ? `:${options.port}` : '';

    return `${protocol}://${hostname}${port}${path}`;
  }

  public sanitizeHeaders(headers: any, pattern?: APIPattern): Record<string, any> {
    const sanitized = { ...headers };

    // Default sanitization rules
    if (sanitized.authorization) {
      sanitized.authorization = sanitized.authorization.replace(/Bearer .+/, 'Bearer [REDACTED]');
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

  public parseJSON(str: string | null): any {
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }

  private async logCallToAPI(callData: CallData, matchedPattern?: MatchedPattern): Promise<void> {
    const payload: LogPayload = {
      llm_request_log: {
        raw_request: callData
      }
    };

    const requestOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey
      },
      body: JSON.stringify(payload)
    };

    try {
      if (!this.silent) {
        const apiName = matchedPattern?.pattern.name || 'API';
        console.log(`\n🎉 LOGGING ${apiName} API Call #${callData.id}`);
        console.log(`🕐 Time: ${callData.timestamp}`);
        console.log(`🎯 ${callData.method} ${callData.url}`);
        console.log(`📊 Status: ${callData.status_code}`);
        console.log(`🔧 Protocol: ${callData.protocol}`);
        if (matchedPattern) {
          console.log(`🔍 Matched by: ${matchedPattern.matchType} (${matchedPattern.matchValue})`);
        }

        if (callData.request_body?.model) {
          console.log(`🤖 Model: ${callData.request_body.model}`);
        }

        if (callData.request_body?.messages) {
          console.log(`💬 Messages: ${callData.request_body.messages.length}`);
        }

        if (callData.request_body?.temperature !== undefined) {
          console.log(`🌡️  Temperature: ${callData.request_body.temperature}`);
        }

        console.log(`📤 Sending to: ${this.apiEndpoint}`);
      }

      // Use fetch if available, otherwise use https/http
      if (typeof fetch !== 'undefined') {
        const response = await fetch(this.apiEndpoint, requestOptions);

        if (response.ok) {
          const result = await response.json() as any;
          this.log(`✅ Successfully logged to API with ID: ${result.id}`);
        } else {
          const errorText = await response.text();
          console.error(`❌ Failed to log to API: ${response.status} - ${errorText}`);
        }
      } else {
        // Fallback to using https/http modules
        await this.logWithHTTPS(payload);
      }

      if (!this.silent) {
        console.log('═'.repeat(60));
      }

    } catch (error) {
      console.error(`❌ Error logging to API:`, (error as Error).message);
    }
  }

  private async logWithHTTPS(payload: LogPayload): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.apiEndpoint);
      const postData = JSON.stringify(payload);

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'X-API-Key': this.apiKey
        }
      };

      const req = (url.protocol === 'https:' ? https : http).request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            this.log(`✅ Successfully logged to API`);
            resolve();
          } else {
            console.error(`❌ Failed to log to API: ${res.statusCode} - ${data}`);
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  public getStats(): Stats {
    return {
      totalRequests: this.callCounter,
      interceptedCalls: this.interceptedCalls,
      environment: this.environment,
      apiEndpoint: this.apiEndpoint
    };
  }
}