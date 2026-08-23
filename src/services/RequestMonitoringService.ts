import { PassThrough } from 'stream';
import type { IncomingMessage, ClientRequest } from 'http';
import { CoolhandCallData, CoolhandRequestOptions, CoolhandMatchedPattern } from '../types';
import { PatternMatchingService } from './PatternMatchingService.js';
import { parseBody } from '../utils/parse-body.js';
import { decompressBuffer, MAX_DECOMPRESSED_BYTES } from '../utils/decompress.js';
import { CappedBuffer } from '../utils/capped-buffer.js';
import { isNonInferenceURL } from '../non-inference-filter.js';
import { createResponseTee } from '../utils/tee-response.js';
import { readCappedResponseText } from '../utils/capped-fetch-body.js';
import { normalizeRequestArgs } from '../utils/normalize-request-args.js';
import { extractRequestHostname } from '../utils/extract-hostname.js';

type OriginalRequestFn = typeof import('http').request | typeof import('https').request;

// Node.js http/https modules — loaded via createRequire rather than a static
// `import * as https from 'https'`. tsup's CJS output compiles a static import to
// `__toESM(require("https"))`, whose __copyProps helper defines properties without
// `configurable: true` (defaults to false), so the Object.defineProperty patching
// below would silently no-op. createRequire returns the real, mutable CJS module
// object instead. See global-monitor.ts's loadNodeModulesSync for the sibling fix
// (issue #25) this mirrors — the synchronous half only, since setupMonitoring()
// below is called synchronously from Coolhand's constructor and has no async path.
let https: any = null;
let http: any = null;

let _createRequire: ((id: string) => any) | null = null;
try { _createRequire = (require as any)('module').createRequire; } catch { /* not available in native ESM */ }

// createRequire accepts a file URL string or an absolute path. The fallback is an
// absolute path, not a hand-built 'file://' + process.cwd(): that produces
// 'file://C:\Users\...' on Windows (drive letter in the URL host slot), and building
// a valid URL would need url.pathToFileURL — a Node import this file must not take.
// eval() keeps import.meta.url out of the CJS build, where it is a compile error.
const createRequireBase = (): string => {
  try { return eval('import.meta.url') as string; } catch { /* CJS — no import.meta */ }
  return process.cwd() + '/';
};

const loadNodeModules = (): boolean => {
  if (!_createRequire) { return false; } // native ESM — no synchronous fallback available
  try {
    const req = _createRequire(createRequireBase());
    https = req('https');
    http = req('http');
    return true;
  } catch {
    return false;
  }
};

export class RequestMonitoringService {
  private callCounter: number = 0;
  private interceptedCalls: number = 0;
  private silent: boolean;
  private patternMatchingService: PatternMatchingService;
  private static isPatched: boolean = false;
  public excludeApiPatterns: string[] = [];

  constructor(
    patternMatchingService: PatternMatchingService,
    silent: boolean = true
  ) {
    this.patternMatchingService = patternMatchingService;
    this.silent = silent;
  }

  public setupMonitoring(): void {
    if (!RequestMonitoringService.isPatched) {
      if (loadNodeModules()) {
        // Patch HTTPS
        this.patchHTTPS();

        // Patch HTTP (some libraries might use HTTP with upgrade)
        this.patchHTTP();
      } else {
        console.warn('⚠️  Node.js HTTP modules not available - HTTP/HTTPS interception disabled (fetch() interception still active)');
      }

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
          value: function(
            urlOrOptions: CoolhandRequestOptions | string | URL,
            optionsOrCallback?: CoolhandRequestOptions | ((res: IncomingMessage) => void),
            extraCallback?: (res: IncomingMessage) => void
          ) {
            const { options, callback } = normalizeRequestArgs(urlOrOptions, optionsOrCallback, extraCallback);
            monitor.debugRequest('HTTPS REQUEST', options);

            // Check if this matches any API pattern
            const matchedPattern = monitor.patternMatchingService.matchesAPIPatternSync(options);

            if (matchedPattern) {
              if (monitor.isExcluded(options, 'https')) {
                return originalRequest.call(this, options as any, callback as any);
              }
              const method = typeof options === 'object' && 'method' in options ? (options as any).method || 'GET' : 'GET';
              if (isNonInferenceURL(monitor.buildURL(options, 'https'), method)) {
                return originalRequest.call(this, options as any, callback as any);
              }
              monitor.log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTPS call`);
              return monitor.interceptRequest(originalRequest, options, callback, 'https', matchedPattern);
            }

            return originalRequest.call(this, options as any, callback as any);
          },
          writable: true,
          configurable: true
        });
      } else {
        console.warn('⚠️  Could not patch https.request: property is non-configurable');
      }
    } catch {
      // Silently ignore if we can't patch
      monitor.log('Warning: Could not patch https.request');
    }

    try {
      const getDescriptor = Object.getOwnPropertyDescriptor(https, 'get');
      if (!getDescriptor || getDescriptor.configurable !== false) {
        Object.defineProperty(https, 'get', {
          value: function(
            urlOrOptions: CoolhandRequestOptions | string | URL,
            optionsOrCallback?: CoolhandRequestOptions | ((res: IncomingMessage) => void),
            extraCallback?: (res: IncomingMessage) => void
          ) {
            const { options, callback } = normalizeRequestArgs(urlOrOptions, optionsOrCallback, extraCallback);
            monitor.debugRequest('HTTPS GET', options);
            const matchedPattern = monitor.patternMatchingService.matchesAPIPatternSync(options);

            if (matchedPattern) {
              if (monitor.isExcluded(options, 'https')) {
                return originalGet.call(this, options as any, callback as any);
              }
              if (isNonInferenceURL(monitor.buildURL(options, 'https'), 'GET')) {
                return originalGet.call(this, options as any, callback as any);
              }
              monitor.log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTPS GET`);
              return monitor.interceptRequest(originalGet, options, callback, 'https', matchedPattern);
            }

            return originalGet.call(this, options as any, callback as any);
          },
          writable: true,
          configurable: true
        });
      } else {
        console.warn('⚠️  Could not patch https.get: property is non-configurable');
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
          value: function(
            urlOrOptions: CoolhandRequestOptions | string | URL,
            optionsOrCallback?: CoolhandRequestOptions | ((res: IncomingMessage) => void),
            extraCallback?: (res: IncomingMessage) => void
          ) {
            const { options, callback } = normalizeRequestArgs(urlOrOptions, optionsOrCallback, extraCallback);
            monitor.debugRequest('HTTP REQUEST', options);
            const matchedPattern = monitor.patternMatchingService.matchesAPIPatternSync(options);

            if (matchedPattern) {
              if (monitor.isExcluded(options, 'http')) {
                return originalRequest.call(this, options as any, callback as any);
              }
              const method = typeof options === 'object' && 'method' in options ? (options as any).method || 'GET' : 'GET';
              if (isNonInferenceURL(monitor.buildURL(options, 'http'), method)) {
                return originalRequest.call(this, options as any, callback as any);
              }
              monitor.log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTP call`);
              return monitor.interceptRequest(originalRequest, options, callback, 'http', matchedPattern);
            }

            return originalRequest.call(this, options as any, callback as any);
          },
          writable: true,
          configurable: true
        });
      } else {
        console.warn('⚠️  Could not patch http.request: property is non-configurable');
      }
    } catch {
      // Silently ignore if we can't patch
      monitor.log('Warning: Could not patch http.request');
    }

    try {
      const getDescriptor = Object.getOwnPropertyDescriptor(http, 'get');
      if (!getDescriptor || getDescriptor.configurable !== false) {
        Object.defineProperty(http, 'get', {
          value: function(
            urlOrOptions: CoolhandRequestOptions | string | URL,
            optionsOrCallback?: CoolhandRequestOptions | ((res: IncomingMessage) => void),
            extraCallback?: (res: IncomingMessage) => void
          ) {
            const { options, callback } = normalizeRequestArgs(urlOrOptions, optionsOrCallback, extraCallback);
            monitor.debugRequest('HTTP GET', options);
            const matchedPattern = monitor.patternMatchingService.matchesAPIPatternSync(options);

            if (matchedPattern) {
              if (monitor.isExcluded(options, 'http')) {
                return originalGet.call(this, options as any, callback as any);
              }
              if (isNonInferenceURL(monitor.buildURL(options, 'http'), 'GET')) {
                return originalGet.call(this, options as any, callback as any);
              }
              monitor.log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTP GET`);
              return monitor.interceptRequest(originalGet, options, callback, 'http', matchedPattern);
            }

            return originalGet.call(this, options as any, callback as any);
          },
          writable: true,
          configurable: true
        });
      } else {
        console.warn('⚠️  Could not patch http.get: property is non-configurable');
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
          if (monitor.isExcluded(urlStr, 'https')) {
            return originalFetch.call(this, url, options);
          }
          const method = (options as RequestInit)?.method || 'GET';
          if (isNonInferenceURL(urlStr, method)) {
            return originalFetch.call(this, url, options);
          }
          monitor.log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} FETCH call`);
          return monitor.interceptFetch(originalFetch, url, options, matchedPattern);
        }

        return originalFetch.call(this, url, options);
      };
    }
  }

  private interceptRequest(
    originalRequest: OriginalRequestFn,
    options: CoolhandRequestOptions | string | URL,
    callback?: (res: IncomingMessage) => void,
    protocol: 'https' | 'http' = 'https',
    matchedPattern?: CoolhandMatchedPattern
  ): ClientRequest {
    this.interceptedCalls++;

    const url = this.buildURL(options, protocol);

    const callData: CoolhandCallData = {
      id: this.interceptedCalls,
      timestamp: new Date().toISOString(),
      method: typeof options === 'object' && 'method' in options ? options.method || 'GET' : 'GET',
      url: this.patternMatchingService.sanitizeURL(url),
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

    this.log(`📞 Starting API call #${callData.id} to ${callData.url}`);

    let requestBody = '';

    const req = originalRequest(options as any, (res: IncomingMessage) => {
      this.log(`📥 Response received for call #${callData.id}, status: ${res.statusCode}`);

      const responseBuffer = new CappedBuffer(MAX_DECOMPRESSED_BYTES, () => {
        this.log(`⚠️ Response body for call #${callData.id} exceeded ${MAX_DECOMPRESSED_BYTES} bytes; truncating capture`);
      });

      // See createResponseTee: hands the host an independent stream so the interceptor's own
      // capture below can't starve a host callback that consumes `res` asynchronously. Only
      // created when there's a callback to hand it to — an unread tee must never be constructed,
      // since createResponseTee's backpressure guard only activates once *something* reads it.
      const hostStream = callback
        ? createResponseTee(res, PassThrough, MAX_DECOMPRESSED_BYTES, () => {
            this.log(`⚠️ Host response stream for call #${callData.id} exceeded ${MAX_DECOMPRESSED_BYTES} bytes; destroying host copy`);
          })
        : null;

      res.on('data', (chunk: any) => {
        responseBuffer.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      res.on('end', async () => {
        try {
          const rawBuffer = responseBuffer.concat();
          const contentEncoding = res.headers?.['content-encoding'];
          const responseBody = await decompressBuffer(rawBuffer, contentEncoding, this.log.bind(this));
          callData.response_body = parseBody(responseBody);
        } catch (err: any) {
          this.log(`⚠️ Response body capture failed for call #${callData.id}: ${err?.message}`);
          callData.response_body = null;
        }
        callData.response_headers = this.patternMatchingService.sanitizeHeaders(res.headers, matchedPattern?.pattern);
        callData.status_code = res.statusCode || null;

        // Emit event for the logging service to handle
        this.onRequestComplete(callData, matchedPattern);
      });

      // hostStream is duck-typed to match http.IncomingMessage at runtime (see createResponseTee).
      if (callback) {callback(hostStream as unknown as IncomingMessage);}
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
      callData.request_body = parseBody(requestBody);
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
      url: this.patternMatchingService.sanitizeURL(url.toString()),
      headers: this.patternMatchingService.sanitizeHeaders(
        options.headers instanceof Headers
          ? Object.fromEntries(options.headers.entries())
          : (options.headers || {}),
        matchedPattern?.pattern
      ),
      request_body: options.body ? parseBody(options.body as string) : null,
      response_body: null,
      response_headers: null,
      status_code: null,
      protocol: 'fetch'
    };

    this.log(`📞 Starting FETCH call #${callData.id} to ${callData.url}`);

    try {
      const response = await originalFetch.call(globalThis, url, options);

      callData.status_code = response.status;
      callData.response_headers = this.patternMatchingService.sanitizeHeaders(
        Object.fromEntries(response.headers.entries()),
        matchedPattern?.pattern
      );

      // Clone response to read body without consuming it. Drain and log in the
      // background so a slow/streaming body doesn't delay the caller's fetch() —
      // same reasoning as the res.on('data')/'end' handling on the http/https side.
      const responseClone = response.clone();
      readCappedResponseText(responseClone, MAX_DECOMPRESSED_BYTES, () => {
        this.log(`⚠️ Response body for call #${callData.id} exceeded ${MAX_DECOMPRESSED_BYTES} bytes; truncating capture`);
      })
        .then((responseText) => {
          callData.response_body = parseBody(responseText);
        })
        .catch((err) => {
          this.log(`⚠️ Response body capture failed for call #${callData.id}:`, (err as Error)?.message);
          callData.response_body = null;
        })
        .finally(() => {
          this.onRequestComplete(callData, matchedPattern);
        });

      return response;
    } catch (error) {
      this.log(`❌ Fetch error for call #${callData.id}:`, (error as Error).message);
      throw error;
    }
  }

  private isExcluded(options: CoolhandRequestOptions | string | URL, protocol: string): boolean {
    if (this.excludeApiPatterns.length === 0) { return false; }
    const url = this.buildURL(options, protocol);
    return this.excludeApiPatterns.some(p => url.includes(p));
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

  private debugRequest(type: string, options: CoolhandRequestOptions | string | URL | any): void {
    const hostname = extractRequestHostname(options);
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