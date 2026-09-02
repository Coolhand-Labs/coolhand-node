/**
 * Global monitoring functionality for coolhand-node
 *
 * This module provides universal HTTP monitoring that automatically detects
 * and logs AI API calls across any Node.js application.
 */

import { CoolhandCallData, CoolhandRequestOptions, CoolhandMatchedPattern } from './types.js';
import { PatternMatchingService } from './services/PatternMatchingService.js';
import { LoggingService } from './services/LoggingService.js';
import { parseBody } from './utils/parse-body.js';
import { decompressBuffer, MAX_DECOMPRESSED_BYTES } from './utils/decompress.js';
import { CappedBuffer } from './utils/capped-buffer.js';
import { isNonInferenceURL } from './non-inference-filter.js';
import { createResponseTee } from './utils/tee-response.js';
import { readCappedResponseText } from './utils/capped-fetch-body.js';
import { normalizeRequestArgs } from './utils/normalize-request-args.js';
import { patchResponseEmit } from './utils/response-interceptor.js';
import { computeSelfEndpoint, isSelfOrExcluded as isSelfOrExcludedShared, SelfEndpoint } from './utils/self-endpoint.js';
import { DEFAULT_EXCLUDE_API_PATTERNS } from './default-exclude-api-patterns.js';
import { getFetchURL, getFetchMethod, getFetchHeaders, getFetchRequestBody } from './utils/fetch-request-helpers.js';
import { extractRequestHostname } from './utils/extract-hostname.js';
import type { PassThrough } from 'stream';

type HttpClientRequest = any; // Will be properly typed when http is loaded
type HttpIncomingMessage = any; // Will be properly typed when http is loaded

// Runtime detection utility
const isEdgeRuntime = () => {
  return (typeof (globalThis as any).EdgeRuntime !== 'undefined') ||
         process.env.NEXT_RUNTIME === 'edge' ||
         (typeof (globalThis as any).window !== 'undefined');
};

// Node.js modules - conditionally imported
let https: any = null;
let http: any = null;
// Precisely typed (unlike https/http above) since `import type` is free at runtime and
// createResponseTee's PassThrough-specific echo semantics benefit from the real type here.
let PassThroughCtor: (new () => PassThrough) | null = null;

// Available in CJS builds (and tsup's CJS shim); null in native ESM and Edge runtimes.
// Using try/catch avoids a static top-level import of 'module' that would throw at
// evaluation time in edge runtimes before isEdgeRuntime() can guard against it.
let _createRequire: ((id: string) => any) | null = null;
try { _createRequire = (require as any)('module').createRequire; } catch { /* not available in native ESM or Edge */ }

// createRequire accepts a file URL string or an absolute path. The fallback is an
// absolute path, not a hand-built 'file://' + process.cwd(): that produces
// 'file://C:\Users\...' on Windows (drive letter in the URL host slot), and building
// a valid URL would need url.pathToFileURL — a Node import this file must not take.
// eval() keeps import.meta.url out of the CJS build, where it is a compile error.
const createRequireBase = (): string => {
  try { return eval('import.meta.url') as string; } catch { /* CJS — no import.meta */ }
  return process.cwd() + '/';
};

// Synchronous module loader — used by initGlobalMonitoringCore so patching happens
// immediately when auto-monitor is imported in CJS builds.
const loadNodeModulesSync = (): boolean => {
  if (isEdgeRuntime()) {
    console.warn('⚠️  Edge runtime detected - HTTP/HTTPS patching will be limited to fetch() only');
    return false;
  }
  if (!_createRequire) { return false; } // native ESM — fall through to async path
  try {
    const req = _createRequire(createRequireBase());
    https = req('https');
    http = req('http');
    PassThroughCtor = req('stream').PassThrough;
    return true;
  } catch {
    return false;
  }
};

// Lazy load Node.js modules only when not in Edge runtime
const loadNodeModules = async () => {
  if (isEdgeRuntime()) {
    console.warn('⚠️  Edge runtime detected - HTTP/HTTPS patching will be limited to fetch() only');
    return false;
  }

  try {
    let httpsModule = await import('https') as any;
    let httpModule = await import('http') as any;

    // ESM namespace objects have non-configurable properties which cannot be patched
    // via Object.defineProperty. Detect this and fall back to createRequire, which
    // returns the mutable CJS module object where properties are configurable.
    const desc = Object.getOwnPropertyDescriptor(httpsModule, 'request');
    if (desc && desc.configurable === false) {
      log('ESM namespace detected (non-configurable properties), using createRequire fallback');
      const { createRequire: cr } = await import('module') as any;
      const cjsRequire = cr(createRequireBase());
      httpsModule = cjsRequire('https');
      httpModule = cjsRequire('http');
    }

    https = httpsModule;
    http = httpModule;
    PassThroughCtor = ((await import('stream')) as any).PassThrough;

    return true;
  } catch {
    console.warn('⚠️  Node.js HTTP modules not available - falling back to fetch() only');
    return false;
  }
};

// State is stored on globalThis so both the CJS and ESM builds of this module
// share the same values in a mixed-format Node.js process. A string key (not a
// Symbol) is required because Symbols are per-realm and would be independent
// across module formats.
const COOLHAND_STATE_KEY = '__coolhand_node_v1__';

interface CoolhandGlobalState {
  globalPatternService: PatternMatchingService | null;
  globalLoggingService: LoggingService | null;
  isGloballyPatched: boolean;
  callCounter: number;
  interceptedCalls: number;
  silent: boolean;
  globalActiveRequests: Map<string, { timestamp: number; requestIds: Set<string> }>;
  excludeApiPatterns: string[];
  selfEndpoint: SelfEndpoint | null;
}

function getState(): CoolhandGlobalState {
  const g = globalThis as any;
  if (!g[COOLHAND_STATE_KEY]) {
    g[COOLHAND_STATE_KEY] = {
      globalPatternService: null,
      globalLoggingService: null,
      isGloballyPatched: false,
      callCounter: 0,
      interceptedCalls: 0,
      silent: true,
      globalActiveRequests: new Map(),
      excludeApiPatterns: [],
      selfEndpoint: null,
    } satisfies CoolhandGlobalState;
  }
  return g[COOLHAND_STATE_KEY] as CoolhandGlobalState;
}

// Combines the self-endpoint and excludeApiPatterns checks — every patched request/get/fetch
// call site needs both together, rather than repeating `isSelfEndpoint(url) || isExcluded(url)`
// at each one. Delegates to the shared isSelfOrExcluded in self-endpoint.ts (also used by
// RequestMonitoringService) so both interception paths honor identical semantics.
function isSelfOrExcluded(url: string): boolean {
  const state = getState();
  return isSelfOrExcludedShared(url, state.selfEndpoint, state.excludeApiPatterns);
}

/** Reset all singleton state — for use in tests only. */
export function _resetGlobalState(): void {
  delete (globalThis as any)[COOLHAND_STATE_KEY];
}

const DEDUP_WINDOW_MS = 1000;

interface GlobalMonitorConfig {
  apiKey: string;
  silent?: boolean;
  patternsFile?: string;
  debug?: boolean;
  dryRun?: boolean;
  baseUrl?: string;
  excludeApiPatterns?: string[];
  /** @deprecated Use `baseUrl` instead. Removed in v0.4.0; this shim will be removed in a future release. */
  environment?: 'local' | 'production';
}

/**
 * Synchronous core initialization — sets up services and applies patches immediately.
 * In CJS builds (and TypeScript projects compiled to CJS) this patches https.request
 * at module evaluation time, so static imports of libraries like @langchain/openai
 * are intercepted correctly. In native ESM builds _createRequire is unavailable, so
 * only fetch is patched here; call loadAndPatchNodeModulesIfNeeded() to finish.
 */
export function initGlobalMonitoringCore(config: GlobalMonitorConfig): void {
  const state = getState();
  if (state.isGloballyPatched) { return; }

  // Kept local (not written to `state` yet) so a throw below leaves state fully
  // untouched, not just the service fields — see the construct-then-commit comment below.
  const silent = config.silent !== false;
  let resolvedBaseUrl = config.baseUrl;

  // TODO: remove after v1.x.x — backward-compat shim for deprecated `environment` option
  if (config.environment !== undefined) {
    console.warn(
      '[coolhand-node] DEPRECATION WARNING: The `environment` option was removed in v0.4.0. ' +
      "Use `baseUrl: 'http://localhost:3000'` instead of `environment: 'local'`. " +
      'Remove `environment: \'production\'` — the default endpoint is unchanged.'
    );
    if (config.environment === 'local' && resolvedBaseUrl === undefined) {
      resolvedBaseUrl = 'http://localhost:3000';
    }
  }

  if (config.debug && !config.dryRun) {
    console.warn(
      '[coolhand-node] DEPRECATION WARNING: `debug: true` no longer suppresses API calls. ' +
      'Use `dryRun: true` to prevent data submission. ' +
      '`debug` now only enables verbose logging.'
    );
  }

  // Construct into locals first — only assign to state once both fallible constructors
  // (LoggingService validates baseUrl and can throw) succeed, so a failed init never
  // leaves globalPatternService set without a matching globalLoggingService, and never
  // reaches the patching below.
  const patternService = new PatternMatchingService({ customPatternsFile: config.patternsFile, silent });
  const loggingService = new LoggingService({
    apiKey: config.apiKey,
    silent,
    debug: config.debug,
    dryRun: config.dryRun,
    baseUrl: resolvedBaseUrl
  });

  state.silent = silent;
  state.globalPatternService = patternService;
  state.globalLoggingService = loggingService;
  state.excludeApiPatterns = [...(config.excludeApiPatterns ?? DEFAULT_EXCLUDE_API_PATTERNS)];
  state.selfEndpoint = computeSelfEndpoint(loggingService.getApiEndpoint());

  const hasNodeModules = loadNodeModulesSync();
  if (hasNodeModules) {
    patchHTTPS();
    patchHTTP();
  }
  patchFetch();
  state.isGloballyPatched = true;
}

/**
 * Async completion step for native ESM builds where loadNodeModulesSync() cannot
 * obtain createRequire. Loads http/https via dynamic import and applies patches.
 * No-op if modules were already loaded by the synchronous path (CJS builds).
 */
export async function loadAndPatchNodeModulesIfNeeded(): Promise<void> {
  if (https !== null) { return; } // already loaded synchronously
  if (isEdgeRuntime()) { return; }
  const hasNodeModules = await loadNodeModules();
  if (hasNodeModules) {
    patchHTTPS();
    patchHTTP();
  }
}

/**
 * Initialize global monitoring - patches HTTP modules to monitor ALL outbound requests
 * This should be called once at the start of your application
 */
export async function initializeGlobalMonitoring(config: GlobalMonitorConfig): Promise<void> {
  const state = getState();

  if (state.isGloballyPatched) {
    log('🔄 Global monitoring already initialized, skipping...');
    return;
  }

  initGlobalMonitoringCore(config);
  await loadAndPatchNodeModulesIfNeeded();

  if (!state.silent) {
    console.log('🌐 Global Coolhand monitoring initialized');
    if (config.dryRun) {
      console.log('🚫 Dry run mode: ON — API calls will be skipped');
    }
    if (config.debug) {
      console.log('🔬 Debug mode: ON — verbose logging enabled');
    }
    console.log(`🎯 API Endpoint: ${state.globalLoggingService!.getApiEndpoint()}`);
    console.log(`📋 Loaded ${await state.globalPatternService!.getPatternsCount()} AI API patterns`);
    console.log(`🔍 Monitoring mode: ${https !== null ? 'Full (HTTP/HTTPS/Fetch)' : 'Fetch only (Edge runtime)'}`);
  }
}

/**
 * Get global monitoring statistics
 */
export function getGlobalStats() {
  const state = getState();
  return {
    totalRequests: state.callCounter,
    interceptedCalls: state.interceptedCalls,
    apiEndpoint: state.globalLoggingService?.getApiEndpoint() || 'Not initialized',
    isInitialized: state.isGloballyPatched
  };
}

/**
 * Check if global monitoring is active
 */
export function isGlobalMonitoringActive(): boolean {
  return getState().isGloballyPatched;
}

// Takes the already-built URL rather than (options, protocol): every call site already has it
// on hand (from the same `buildURL`/`targetUrl` it needs for isSelfOrExcluded/isNonInferenceURL),
// so this avoids re-parsing `options` into a URL string a second time per request.
function generateRequestId(url: string, method: string): string {
  return `${method.toUpperCase()}:${url}`;
}

function isRequestActive(requestId: string): boolean {
  const state = getState();
  const active = state.globalActiveRequests.get(requestId);
  if (!active) {return false;}

  const now = Date.now();
  if (now - active.timestamp > DEDUP_WINDOW_MS) {
    state.globalActiveRequests.delete(requestId);
    return false;
  }

  return true;
}

function registerActiveRequest(requestId: string): string {
  const state = getState();
  const uniqueId = `${requestId}-${Date.now()}-${Math.random()}`;
  const now = Date.now();

  const existing = state.globalActiveRequests.get(requestId);
  if (existing) {
    existing.requestIds.add(uniqueId);
  } else {
    state.globalActiveRequests.set(requestId, {
      timestamp: now,
      requestIds: new Set([uniqueId])
    });
  }

  return uniqueId;
}

function unregisterActiveRequest(requestId: string, uniqueId: string): void {
  const state = getState();
  const active = state.globalActiveRequests.get(requestId);
  if (active) {
    active.requestIds.delete(uniqueId);
    if (active.requestIds.size === 0) {
      state.globalActiveRequests.delete(requestId);
    }
  }
}

function isIdempotentMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD';
}

function patchHTTPS(): void {
  const originalRequest = https.request;
  const originalGet = https.get;

  try {
    const requestDescriptor = Object.getOwnPropertyDescriptor(https, 'request');
    if (!requestDescriptor || requestDescriptor.configurable !== false) {
      Object.defineProperty(https, 'request', {
        value: function(
          urlOrOptions: CoolhandRequestOptions | string | URL,
          optionsOrCallback?: CoolhandRequestOptions | ((res: HttpIncomingMessage) => void),
          extraCallback?: (res: HttpIncomingMessage) => void
        ) {
          const { options, callback } = normalizeRequestArgs(urlOrOptions, optionsOrCallback, extraCallback);
          debugRequest('HTTPS REQUEST', options);

          const { globalPatternService } = getState();
          if (!globalPatternService) {
            return originalRequest.call(this, options as any, callback as any);
          }

          const matchedPattern = globalPatternService.matchesAPIPatternSync(options);

          if (matchedPattern) {
            const targetUrl = buildURL(options, 'https');
            if (isSelfOrExcluded(targetUrl)) {
              return originalRequest.call(this, options as any, callback as any);
            }

            const method = typeof options === 'object' && 'method' in options ? options.method || 'GET' : 'GET';
            const requestId = generateRequestId(targetUrl, `https-${method}`);

            if (isIdempotentMethod(method) && isRequestActive(requestId)) {
              log(`🔄 Skipping duplicate HTTPS request: ${method} ${sanitizeForLog(targetUrl)}`);
              return originalRequest.call(this, options as any, callback as any);
            }

            if (isNonInferenceURL(targetUrl, method)) {
              return originalRequest.call(this, options as any, callback as any);
            }

            log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTPS call`);
            return interceptRequest(originalRequest, options, targetUrl, callback, 'https', matchedPattern);
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
    log('Warning: Could not patch https.request');
  }

  try {
    const getDescriptor = Object.getOwnPropertyDescriptor(https, 'get');
    if (!getDescriptor || getDescriptor.configurable !== false) {
      Object.defineProperty(https, 'get', {
        value: function(
          urlOrOptions: CoolhandRequestOptions | string | URL,
          optionsOrCallback?: CoolhandRequestOptions | ((res: HttpIncomingMessage) => void),
          extraCallback?: (res: HttpIncomingMessage) => void
        ) {
          const { options, callback } = normalizeRequestArgs(urlOrOptions, optionsOrCallback, extraCallback);
          debugRequest('HTTPS GET', options);

          const { globalPatternService } = getState();
          if (!globalPatternService) {
            return originalGet.call(this, options as any, callback as any);
          }

          const matchedPattern = globalPatternService.matchesAPIPatternSync(options);

          if (matchedPattern) {
            const targetUrl = buildURL(options, 'https');
            if (isSelfOrExcluded(targetUrl)) {
              return originalGet.call(this, options as any, callback as any);
            }

            const requestId = generateRequestId(targetUrl, 'https-GET');

            if (isRequestActive(requestId)) {
              log(`🔄 Skipping duplicate HTTPS GET: ${sanitizeForLog(targetUrl)}`);
              return originalGet.call(this, options as any, callback as any);
            }

            if (isNonInferenceURL(targetUrl, 'GET')) {
              return originalGet.call(this, options as any, callback as any);
            }

            log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTPS GET`);
            return interceptRequest(originalGet, options, targetUrl, callback, 'https', matchedPattern);
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
    log('Warning: Could not patch https.get');
  }
}

function patchHTTP(): void {
  const originalRequest = http.request;
  const originalGet = http.get;

  try {
    const requestDescriptor = Object.getOwnPropertyDescriptor(http, 'request');
    if (!requestDescriptor || requestDescriptor.configurable !== false) {
      Object.defineProperty(http, 'request', {
        value: function(
          urlOrOptions: CoolhandRequestOptions | string | URL,
          optionsOrCallback?: CoolhandRequestOptions | ((res: HttpIncomingMessage) => void),
          extraCallback?: (res: HttpIncomingMessage) => void
        ) {
          const { options, callback } = normalizeRequestArgs(urlOrOptions, optionsOrCallback, extraCallback);
          debugRequest('HTTP REQUEST', options);

          const { globalPatternService } = getState();
          if (!globalPatternService) {
            return originalRequest.call(this, options as any, callback as any);
          }

          const matchedPattern = globalPatternService.matchesAPIPatternSync(options);

          if (matchedPattern) {
            const targetUrl = buildURL(options, 'http');
            if (isSelfOrExcluded(targetUrl)) {
              return originalRequest.call(this, options as any, callback as any);
            }

            const method = typeof options === 'object' && 'method' in options ? options.method || 'GET' : 'GET';
            const requestId = generateRequestId(targetUrl, `http-${method}`);

            if (isIdempotentMethod(method) && isRequestActive(requestId)) {
              log(`🔄 Skipping duplicate HTTP request: ${method} ${sanitizeForLog(targetUrl)}`);
              return originalRequest.call(this, options as any, callback as any);
            }

            if (isNonInferenceURL(targetUrl, method)) {
              return originalRequest.call(this, options as any, callback as any);
            }

            log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTP call`);
            return interceptRequest(originalRequest, options, targetUrl, callback, 'http', matchedPattern);
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
    log('Warning: Could not patch http.request');
  }

  try {
    const getDescriptor = Object.getOwnPropertyDescriptor(http, 'get');
    if (!getDescriptor || getDescriptor.configurable !== false) {
      Object.defineProperty(http, 'get', {
        value: function(
          urlOrOptions: CoolhandRequestOptions | string | URL,
          optionsOrCallback?: CoolhandRequestOptions | ((res: HttpIncomingMessage) => void),
          extraCallback?: (res: HttpIncomingMessage) => void
        ) {
          const { options, callback } = normalizeRequestArgs(urlOrOptions, optionsOrCallback, extraCallback);
          debugRequest('HTTP GET', options);

          const { globalPatternService } = getState();
          if (!globalPatternService) {
            return originalGet.call(this, options as any, callback as any);
          }

          const matchedPattern = globalPatternService.matchesAPIPatternSync(options);

          if (matchedPattern) {
            const targetUrl = buildURL(options, 'http');
            if (isSelfOrExcluded(targetUrl)) {
              return originalGet.call(this, options as any, callback as any);
            }

            const requestId = generateRequestId(targetUrl, 'http-GET');

            if (isRequestActive(requestId)) {
              log(`🔄 Skipping duplicate HTTP GET: ${sanitizeForLog(targetUrl)}`);
              return originalGet.call(this, options as any, callback as any);
            }

            if (isNonInferenceURL(targetUrl, 'GET')) {
              return originalGet.call(this, options as any, callback as any);
            }

            log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTP GET`);
            return interceptRequest(originalGet, options, targetUrl, callback, 'http', matchedPattern);
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
    log('Warning: Could not patch http.get');
  }
}

function patchFetch(): void {
  if (typeof globalThis.fetch === 'function') {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async function(url: string | URL | Request, options: RequestInit = {}) {
      const urlStr = getFetchURL(url);
      debugRequest('FETCH', { url: urlStr, ...options });

      const { globalPatternService } = getState();
      if (!globalPatternService) {
        return originalFetch.call(this, url, options);
      }

      const matchedPattern = globalPatternService.matchesAPIPatternFromURL(urlStr);

      if (matchedPattern) {
        if (isSelfOrExcluded(urlStr)) {
          return originalFetch.call(this, url, options);
        }

        const method = getFetchMethod(url, options);
        const requestId = generateRequestId(urlStr, `fetch-${method}`);

        if (isIdempotentMethod(method) && isRequestActive(requestId)) {
          log(`🔄 Skipping duplicate FETCH: ${method} ${sanitizeForLog(urlStr)}`);
          return originalFetch.call(this, url, options);
        }

        if (isNonInferenceURL(urlStr, method)) {
          return originalFetch.call(this, url, options);
        }

        log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} FETCH call`);
        return interceptFetch(originalFetch, url, options, matchedPattern);
      }

      return originalFetch.call(this, url, options);
    };
  }
}


function interceptRequest(
  originalRequest: any,
  options: CoolhandRequestOptions | string | URL,
  url: string,
  callback?: (res: HttpIncomingMessage) => void,
  protocol: 'https' | 'http' = 'https',
  matchedPattern?: CoolhandMatchedPattern
): HttpClientRequest {
  const state = getState();
  state.interceptedCalls++;

  const method = typeof options === 'object' && 'method' in options ? options.method || 'GET' : 'GET';
  const requestId = generateRequestId(url, `${protocol}-${method}`);
  const uniqueId = registerActiveRequest(requestId);

  const callData: CoolhandCallData = {
    id: state.interceptedCalls,
    timestamp: new Date().toISOString(),
    method: method,
    url: state.globalPatternService?.sanitizeURL(url) ?? url,
    headers: state.globalPatternService?.sanitizeHeaders(
      typeof options === 'object' && 'headers' in options ? options.headers || {} : {},
      matchedPattern?.pattern
    ) || {},
    request_body: null,
    response_body: null,
    response_headers: null,
    status_code: null,
    protocol: protocol
  };

  log(`📞 Starting API call #${callData.id} to ${callData.url}`);

  const requestBuffer = new CappedBuffer(MAX_DECOMPRESSED_BYTES, () => {
    log(`⚠️ Request body for call #${callData.id} exceeded ${MAX_DECOMPRESSED_BYTES} bytes; truncating capture`);
  });

  // No callback passed here — patchResponseEmit below substitutes the delivered response for
  // every 'response' listener uniformly, whether registered via a callback passed to
  // .request()/.get() (re-registered below) or via req.on('response', ...) by host code. Passing
  // a callback to originalRequest would make Node deliver the *raw* res to it directly, bypassing
  // the substitution and reopening the starvation bug for that calling convention.
  const req = originalRequest(options as any);

  patchResponseEmit(req, (res: HttpIncomingMessage): HttpIncomingMessage => {
    log(`📥 Response received for call #${callData.id}, status: ${res.statusCode}`);

    const responseBuffer = new CappedBuffer(MAX_DECOMPRESSED_BYTES, () => {
      log(`⚠️ Response body for call #${callData.id} exceeded ${MAX_DECOMPRESSED_BYTES} bytes; truncating capture`);
    });

    // See createResponseTee: hands listeners an independent stream so the interceptor's own
    // capture below can't starve a host callback that consumes `res` asynchronously.
    // req.listenerCount('response') reflects both calling conventions at this point (the
    // re-registered callback and/or any req.on('response', ...) a host attached directly) — an
    // unread tee must never be constructed, since createResponseTee's backpressure guard only
    // activates once *something* reads it. Falls back to the raw `res` only if `stream` somehow
    // failed to load, matching prior (buggy) behavior rather than dropping the response.
    const hostStream = (req.listenerCount('response') > 0 && PassThroughCtor)
      ? createResponseTee(res, PassThroughCtor, MAX_DECOMPRESSED_BYTES, () => {
          log(`⚠️ Host response stream for call #${callData.id} exceeded ${MAX_DECOMPRESSED_BYTES} bytes; destroying host copy`);
        })
      : null;

    res.on('data', (chunk: any) => {
      responseBuffer.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    res.on('end', async () => {
      try {
        const rawBuffer = responseBuffer.concat();
        const contentEncoding = res.headers?.['content-encoding'];
        const responseBody = await decompressBuffer(rawBuffer, contentEncoding, log);
        callData.response_body = parseBody(responseBody);
      } catch (err: any) {
        log(`⚠️ Response body capture failed for call #${callData.id}: ${err?.message}`);
        callData.response_body = null;
      }
      const s = getState();
      callData.response_headers = s.globalPatternService?.sanitizeHeaders(res.headers, matchedPattern?.pattern) || {};
      callData.status_code = res.statusCode || null;

      // Log to API
      if (s.globalLoggingService) {
        s.globalLoggingService.logRequestToAPI(callData, matchedPattern, 'global-monitoring');
      }

      // Cleanup
      unregisterActiveRequest(requestId, uniqueId);
    });

    return hostStream || res;
  }, () => {
    // req.emit couldn't be patched (e.g. another library already made it non-writable) — the
    // capture pipeline above will never run for this request, including its unregisterActiveRequest
    // cleanup. Do it here instead of leaving the dedup entry to sit until DEDUP_WINDOW_MS's natural
    // expiry, so a burst of idempotent requests to the same URL isn't spuriously deduped meanwhile.
    log(`⚠️ Could not intercept response for call #${callData.id}; this request will not be captured/logged`);
    unregisterActiveRequest(requestId, uniqueId);
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
    log(`📤 Request complete for call #${callData.id}`);
    return originalEnd(chunk, encoding, callback);
  });

  req.on('error', (err: Error) => {
    log(`❌ Request error for call #${callData.id}:`, err.message);
    unregisterActiveRequest(requestId, uniqueId);
  });

  return req;
}

async function interceptFetch(
  originalFetch: typeof fetch,
  url: string | URL | Request,
  options: RequestInit,
  matchedPattern?: CoolhandMatchedPattern
): Promise<Response> {
  const state = getState();
  state.interceptedCalls++;

  const method = getFetchMethod(url, options);
  const urlStr = getFetchURL(url);
  const requestId = generateRequestId(urlStr, `fetch-${method}`);
  const uniqueId = registerActiveRequest(requestId);

  const callData: CoolhandCallData = {
    id: state.interceptedCalls,
    timestamp: new Date().toISOString(),
    method: method,
    url: state.globalPatternService?.sanitizeURL(urlStr) ?? urlStr,
    headers: state.globalPatternService?.sanitizeHeaders(
      getFetchHeaders(url, options),
      matchedPattern?.pattern
    ) || {},
    request_body: null,
    response_body: null,
    response_headers: null,
    status_code: null,
    protocol: 'fetch'
  };

  log(`📞 Starting FETCH call #${callData.id} to ${callData.url}`);

  try {
    // Body capture and the outbound request run concurrently. Using Promise.all
    // keeps the fetch rejection inside this try/catch from the moment it is
    // created, closing the unhandledRejection window that would exist if
    // fetchPromise were started outside the guarded block.
    const [requestBody, response] = await Promise.all([
      getFetchRequestBody(url, options),
      originalFetch.call(globalThis, url, options)
    ]);

    callData.request_body = parseBody(requestBody);
    callData.status_code = response.status;
    callData.response_headers = state.globalPatternService?.sanitizeHeaders(
      Object.fromEntries(response.headers.entries()),
      matchedPattern?.pattern
    ) || {};

    // Clone response to read body without consuming it. Drain and log in the
    // background so a slow/streaming body doesn't delay the caller's fetch() —
    // same reasoning as the res.on('data')/'end' handling on the http/https side.
    const responseClone = response.clone();
    readCappedResponseText(responseClone, MAX_DECOMPRESSED_BYTES, () => {
      log(`⚠️ Response body for call #${callData.id} exceeded ${MAX_DECOMPRESSED_BYTES} bytes; truncating capture`);
    })
      .then((responseText) => {
        callData.response_body = parseBody(responseText);
      })
      .catch((err) => {
        log(`⚠️ Response body capture failed for call #${callData.id}:`, (err as Error)?.message);
        callData.response_body = null;
      })
      .finally(() => {
        const s = getState();
        if (s.globalLoggingService) {
          s.globalLoggingService.logRequestToAPI(callData, matchedPattern, 'global-monitoring');
        }
        unregisterActiveRequest(requestId, uniqueId);
      });

    return response;
  } catch (error) {
    log(`❌ Fetch error for call #${callData.id}:`, (error as Error).message);
    unregisterActiveRequest(requestId, uniqueId);
    throw error;
  }
}

function buildURL(options: CoolhandRequestOptions | string | URL | any, protocol: string): string {
  if (typeof options === 'string') {
    return options;
  }

  if (options instanceof URL) {
    return options.toString();
  }

  if (options.href) { return options.href; }
  if (options.url) { return options.url; }

  const hostname = options.hostname || options.host || 'unknown';
  const path = options.path || '/';
  const port = options.port ? `:${options.port}` : '';

  return `${protocol}://${hostname}${port}${path}`;
}

function sanitizeForLog(url: string): string {
  return getState().globalPatternService?.sanitizeURL(url) ?? url;
}

function debugRequest(type: string, options: CoolhandRequestOptions | string | URL | any): void {
  const hostname = extractRequestHostname(options);
  log(`🌐 ${type} to: ${hostname}`);

  // Count all requests
  getState().callCounter++;
}

function log(...args: any[]): void {
  if (!getState().silent) {
    console.log(...args);
  }
}
