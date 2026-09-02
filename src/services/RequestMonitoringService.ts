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
import { patchResponseEmit } from '../utils/response-interceptor.js';
import { computeSelfEndpoint, isSelfOrExcluded, SelfEndpoint } from '../utils/self-endpoint.js';
import { getFetchURL, getFetchMethod, getFetchHeaders, getFetchRequestBody } from '../utils/fetch-request-helpers.js';
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

// Stored on globalThis, not a class-static field — a plain static would only be shared within a
// single loaded copy of this module. If the host's dependency graph pulls in coolhand-node via
// both `require()` and `import` (or two transitive deps resolve different build variants), each
// gets its own module instance with its own class definition, and a class-static field can't see
// across that boundary — two instances could each believe they're the sole owner and both patch
// the shared https/http/fetch globals, double-logging every request. globalThis is shared
// process-wide regardless of module instance, matching global-monitor.ts's identical rationale
// for storing its own state there instead of module-level variables.
const ACTIVE_OWNER_KEY = '__coolhand_node_request_monitoring_active_owner_v1__';

/** Reads the current process-wide active owner — exported for use in tests only. */
export function _getActiveOwner(): RequestMonitoringService | null {
  return (globalThis as any)[ACTIVE_OWNER_KEY] ?? null;
}

function setActiveOwner(owner: RequestMonitoringService): void {
  (globalThis as any)[ACTIVE_OWNER_KEY] = owner;
}

/** Clears the active-owner singleton — for use in tests only. */
export function _resetActiveOwner(): void {
  delete (globalThis as any)[ACTIVE_OWNER_KEY];
}

export class RequestMonitoringService {
  private callCounter: number = 0;
  private interceptedCalls: number = 0;
  private silent: boolean;
  private patternMatchingService: PatternMatchingService;
  public excludeApiPatterns: string[] = [];
  private selfEndpoint: SelfEndpoint | null = null;

  constructor(
    patternMatchingService: PatternMatchingService,
    silent: boolean = true
  ) {
    this.patternMatchingService = patternMatchingService;
    this.silent = silent;
  }

  public setupMonitoring(): void {
    const owner = _getActiveOwner();

    if (owner === null) {
      setActiveOwner(this);

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
    } else if (owner !== this) {
      // Only one Coolhand instance's patches are ever live per process — the http/https/fetch
      // replacements install once and close over whichever instance called setupMonitoring()
      // first. Without this warning, a second instance's excludeApiPatterns/baseUrl/apiKey are
      // silently never consulted, with no signal to the developer that it didn't work.
      console.warn(
        '⚠️  Coolhand: this instance was NOT able to start monitoring outbound requests. ' +
        'Another Coolhand instance already owns HTTP/HTTPS/fetch interception in this process — ' +
        "only one instance's configuration (excludeApiPatterns, baseUrl, apiKey) is ever active " +
        "per process. This instance's excludeApiPatterns and logging destination will NOT be " +
        'used for automatic interception. Construct only one Coolhand instance per process, or ' +
        "use a single instance's excludeApiPatterns to control which traffic is logged."
      );
    }
    // owner === this: a re-entrant call on the instance that already owns the live patches —
    // a harmless no-op.

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
              const targetUrl = monitor.buildURL(options, 'https');
              if (monitor.isSelfOrExcludedURL(targetUrl)) {
                return originalRequest.call(this, options as any, callback as any);
              }
              const method = typeof options === 'object' && 'method' in options ? (options as any).method || 'GET' : 'GET';
              if (isNonInferenceURL(targetUrl, method)) {
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
              const targetUrl = monitor.buildURL(options, 'https');
              if (monitor.isSelfOrExcludedURL(targetUrl)) {
                return originalGet.call(this, options as any, callback as any);
              }
              if (isNonInferenceURL(targetUrl, 'GET')) {
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
              const targetUrl = monitor.buildURL(options, 'http');
              if (monitor.isSelfOrExcludedURL(targetUrl)) {
                return originalRequest.call(this, options as any, callback as any);
              }
              const method = typeof options === 'object' && 'method' in options ? (options as any).method || 'GET' : 'GET';
              if (isNonInferenceURL(targetUrl, method)) {
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
              const targetUrl = monitor.buildURL(options, 'http');
              if (monitor.isSelfOrExcludedURL(targetUrl)) {
                return originalGet.call(this, options as any, callback as any);
              }
              if (isNonInferenceURL(targetUrl, 'GET')) {
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
        // getFetchURL/getFetchMethod handle both fetch() calling conventions — `fetch(url, init)`
        // and `fetch(new Request(...))` — the latter of which `url.toString()` alone would render
        // as the useless "[object Request]" (Request doesn't override toString, unlike URL),
        // silently failing every pattern match below instead of throwing.
        const urlStr = getFetchURL(url);

        monitor.debugRequest('FETCH', { url: urlStr, ...options });

        const matchedPattern = monitor.patternMatchingService.matchesAPIPatternFromURL(urlStr);

        if (matchedPattern) {
          if (monitor.isSelfOrExcludedURL(urlStr)) {
            return originalFetch.call(this, url, options);
          }
          const method = getFetchMethod(url, options);
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

    const requestBuffer = new CappedBuffer(MAX_DECOMPRESSED_BYTES, () => {
      this.log(`⚠️ Request body for call #${callData.id} exceeded ${MAX_DECOMPRESSED_BYTES} bytes; truncating capture`);
    });

    // No callback passed here — patchResponseEmit below substitutes the delivered response for
    // every 'response' listener uniformly, whether registered via a callback passed to
    // .request()/.get() (re-registered below) or via req.on('response', ...) by host code. Passing
    // a callback to originalRequest would make Node deliver the *raw* res to it directly, bypassing
    // the substitution and reopening the starvation bug for that calling convention.
    const req = originalRequest(options as any);

    patchResponseEmit(req, (res: IncomingMessage): IncomingMessage => {
      this.log(`📥 Response received for call #${callData.id}, status: ${res.statusCode}`);

      const responseBuffer = new CappedBuffer(MAX_DECOMPRESSED_BYTES, () => {
        this.log(`⚠️ Response body for call #${callData.id} exceeded ${MAX_DECOMPRESSED_BYTES} bytes; truncating capture`);
      });

      // See createResponseTee: hands listeners an independent stream so the interceptor's own
      // capture below can't starve a host callback that consumes `res` asynchronously.
      // req.listenerCount('response') reflects both calling conventions at this point (the
      // re-registered callback and/or any req.on('response', ...) a host attached directly) — an
      // unread tee must never be constructed, since createResponseTee's backpressure guard only
      // activates once *something* reads it.
      const hostStream = req.listenerCount('response') > 0
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
      return (hostStream as unknown as IncomingMessage) || res;
    }, () => {
      // req.emit couldn't be patched (e.g. another library already made it non-writable) — the
      // capture pipeline above will never run for this request. Surface that instead of silently
      // dropping the log entry with no signal at all.
      this.log(`⚠️ Could not intercept response for call #${callData.id}; this request will not be captured/logged`);
    });

    // Node's http.request(options, callback) is sugar for `req.once('response', callback)` — since
    // we withheld callback from originalRequest above, register the equivalent ourselves so it goes
    // through patchResponseEmit's substitution like any other 'response' listener.
    if (callback) { req.once('response', callback); }

    // Intercept request body
    const originalWrite = req.write.bind(req);
    const originalEnd = req.end.bind(req);

    req.write = function(chunk: any, encoding?: any, callback?: any) {
      if (chunk) {
        requestBuffer.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return originalWrite(chunk, encoding, callback);
    };

    req.end = ((chunk?: any, encoding?: any, callback?: any) => {
      if (chunk) {
        requestBuffer.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      callData.request_body = parseBody(requestBuffer.concat().toString('utf-8'));
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
      method: getFetchMethod(url, options),
      url: this.patternMatchingService.sanitizeURL(getFetchURL(url)),
      headers: this.patternMatchingService.sanitizeHeaders(
        getFetchHeaders(url, options),
        matchedPattern?.pattern
      ),
      request_body: null,
      response_body: null,
      response_headers: null,
      status_code: null,
      protocol: 'fetch'
    };

    this.log(`📞 Starting FETCH call #${callData.id} to ${callData.url}`);

    try {
      // Body capture and the outbound request run concurrently (see global-monitor.ts's
      // identical interceptFetch) — a Request-object body read (clone().text()) is not
      // guaranteed to be instantaneous, and awaiting it before dispatching the real request
      // would delay every intercepted fetch() behind request-body capture, or hang it
      // indefinitely if that read never settles. Using Promise.all also keeps the fetch
      // rejection inside this try/catch from the moment it is created, closing the
      // unhandledRejection window that would exist if fetchPromise were started outside
      // the guarded block.
      const [requestBody, response] = await Promise.all([
        getFetchRequestBody(url, options),
        originalFetch.call(globalThis, url, options)
      ]);

      callData.request_body = parseBody(requestBody);
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

  /**
   * Registers the SDK's own backend endpoint so it's never re-intercepted (see
   * src/utils/self-endpoint.ts). Unlike excludeApiPatterns, this is unconditional and not
   * user-overridable — it must hold even if a custom patternsFile entry matches this host.
   */
  public setSelfApiEndpoint(apiEndpoint: string): void {
    this.selfEndpoint = computeSelfEndpoint(apiEndpoint);
  }

  // Combines the self-endpoint and excludeApiPatterns checks against an already-built URL —
  // callers also need that same URL for isNonInferenceURL right afterward, so this takes the
  // built string directly rather than (options, protocol), letting each patched call site build
  // the URL once and reuse it for both checks instead of parsing it twice. Delegates to the
  // shared isSelfOrExcluded in self-endpoint.ts (also used by global-monitor.ts) so both
  // interception paths honor identical semantics.
  private isSelfOrExcludedURL(url: string): boolean {
    return isSelfOrExcluded(url, this.selfEndpoint, this.excludeApiPatterns);
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