import * as https from 'https';
import * as http from 'http';
import { CoolhandCallData, CoolhandRequestOptions, CoolhandMatchedPattern } from '../types';
import { PatternMatchingService } from './PatternMatchingService.js';

export class RequestMonitoringService {
  private callCounter: number = 0;
  private interceptedCalls: number = 0;
  private silent: boolean;
  private patternMatchingService: PatternMatchingService;
  private static isPatched: boolean = false;

  constructor(
    patternMatchingService: PatternMatchingService,
    silent: boolean = true
  ) {
    this.patternMatchingService = patternMatchingService;
    this.silent = silent;
  }

  public setupMonitoring(): void {
    if (!RequestMonitoringService.isPatched) {
      // Patch HTTPS
      this.patchHTTPS();

      // Patch HTTP (some libraries might use HTTP with upgrade)
      this.patchHTTP();

      // Patch fetch if available (Node 18+)
      this.patchFetch();

      RequestMonitoringService.isPatched = true;
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
          value: function(options: CoolhandRequestOptions | string | URL, callback?: (res: http.IncomingMessage) => void) {
            monitor.debugRequest('HTTPS REQUEST', options);

            // Check if this matches any API pattern
            const matchedPattern = monitor.patternMatchingService.matchesAPIPatternSync(options);

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
    } catch {
      // Silently ignore if we can't patch
      monitor.log('Warning: Could not patch https.request');
    }

    try {
      const getDescriptor = Object.getOwnPropertyDescriptor(https, 'get');
      if (!getDescriptor || getDescriptor.configurable !== false) {
        Object.defineProperty(https, 'get', {
          value: function(options: CoolhandRequestOptions | string | URL, callback?: (res: http.IncomingMessage) => void) {
            monitor.debugRequest('HTTPS GET', options);
            const matchedPattern = monitor.patternMatchingService.matchesAPIPatternSync(options);

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
    } catch {
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
          value: function(options: CoolhandRequestOptions | string | URL, callback?: (res: http.IncomingMessage) => void) {
            monitor.debugRequest('HTTP REQUEST', options);
            const matchedPattern = monitor.patternMatchingService.matchesAPIPatternSync(options);

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
    } catch {
      // Silently ignore if we can't patch
      monitor.log('Warning: Could not patch http.request');
    }

    try {
      const getDescriptor = Object.getOwnPropertyDescriptor(http, 'get');
      if (!getDescriptor || getDescriptor.configurable !== false) {
        Object.defineProperty(http, 'get', {
          value: function(options: CoolhandRequestOptions | string | URL, callback?: (res: http.IncomingMessage) => void) {
            monitor.debugRequest('HTTP GET', options);
            const matchedPattern = monitor.patternMatchingService.matchesAPIPatternSync(options);

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
    } catch {
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

        const matchedPattern = monitor.patternMatchingService.matchesAPIPatternFromURL(urlStr);

        if (matchedPattern) {
          monitor.log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} FETCH call`);
          return monitor.interceptFetch(originalFetch, url, options, matchedPattern);
        }

        return originalFetch.call(this, url, options);
      };
    }
  }

  private interceptRequest(
    originalRequest: typeof https.request | typeof http.request,
    options: CoolhandRequestOptions | string | URL,
    callback?: (res: http.IncomingMessage) => void,
    protocol: 'https' | 'http' = 'https',
    matchedPattern?: CoolhandMatchedPattern
  ): http.ClientRequest {
    this.interceptedCalls++;

    const url = this.buildURL(options, protocol);

    const callData: CoolhandCallData = {
      id: this.interceptedCalls,
      timestamp: new Date().toISOString(),
      method: typeof options === 'object' && 'method' in options ? options.method || 'GET' : 'GET',
      url: url,
      headers: this.patternMatchingService.sanitizeHeaders(
        typeof options === 'object' && 'headers' in options ? options.headers || {} : {},
        matchedPattern?.pattern
      ),
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
        callData.response_headers = this.patternMatchingService.sanitizeHeaders(res.headers, matchedPattern?.pattern);
        callData.status_code = res.statusCode || null;

        // Emit event for the logging service to handle
        this.onRequestComplete(callData, matchedPattern);
      });

      if (callback) {callback(res);}
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

  private async interceptFetch(
    originalFetch: typeof fetch,
    url: string | URL | Request,
    options: RequestInit,
    matchedPattern?: CoolhandMatchedPattern
  ): Promise<Response> {
    this.interceptedCalls++;

    const callData: CoolhandCallData = {
      id: this.interceptedCalls,
      timestamp: new Date().toISOString(),
      method: options.method || 'GET',
      url: url.toString(),
      headers: this.patternMatchingService.sanitizeHeaders(
        options.headers instanceof Headers
          ? Object.fromEntries(options.headers.entries())
          : (options.headers || {}),
        matchedPattern?.pattern
      ),
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

      this.onRequestComplete(callData, matchedPattern);

      return response;
    } catch (error) {
      this.log(`❌ Fetch error for call #${callData.id}:`, (error as Error).message);
      throw error;
    }
  }

  private buildURL(options: CoolhandRequestOptions | string | URL, protocol: string): string {
    if (typeof options === 'string') {
      return options;
    }

    if (options instanceof URL) {
      return options.toString();
    }

    if (options.href) {return options.href;}

    const hostname = options.hostname || options.host || 'unknown';
    const path = options.path || '/';
    const port = options.port ? `:${options.port}` : '';

    return `${protocol}://${hostname}${port}${path}`;
  }

  private parseJSON(str: string | null): any {
    if (!str) {return null;}
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }

  private debugRequest(type: string, options: CoolhandRequestOptions | string | URL | any): void {
    const hostname = typeof options === 'string' ? options :
                    options instanceof URL ? options.hostname :
                    options.hostname || options.host || options.url || 'unknown';
    this.log(`🌐 ${type} to: ${hostname}`);

    // Count all requests
    this.callCounter++;
  }

  private log(...args: any[]): void {
    if (!this.silent) {
      console.log(...args);
    }
  }

  // Event handler that will be overridden by the main class
  public onRequestComplete: (callData: CoolhandCallData, matchedPattern?: CoolhandMatchedPattern) => void = () => {};

  public getStats() {
    return {
      totalRequests: this.callCounter,
      interceptedCalls: this.interceptedCalls
    };
  }
}