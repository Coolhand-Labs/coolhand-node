import * as https from 'https';
import * as http from 'http';
import { CallData, RequestOptions, MatchedPattern } from './types';
import { PatternMatchingService } from './services/PatternMatchingService';
import { LoggingService } from './services/LoggingService';

// Global state for the monitoring system
let globalPatternService: PatternMatchingService | null = null;
let globalLoggingService: LoggingService | null = null;
let isGloballyPatched = false;
let callCounter = 0;
let interceptedCalls = 0;
let silent = true;

// Global deduplication registry
const globalActiveRequests = new Map<string, {
  timestamp: number;
  requestIds: Set<string>;
}>();
const DEDUP_WINDOW_MS = 1000;

interface GlobalMonitorConfig {
  apiKey: string;
  silent?: boolean;
  patternsFile?: string;
}

/**
 * Initialize global monitoring - patches HTTP modules to monitor ALL outbound requests
 * This should be called once at the start of your application
 */
export function initializeGlobalMonitoring(config: GlobalMonitorConfig): void {
  if (isGloballyPatched) {
    log('🔄 Global monitoring already initialized, skipping...');
    return;
  }

  silent = config.silent !== false;

  // Initialize services
  globalPatternService = new PatternMatchingService(config.patternsFile);
  globalLoggingService = new LoggingService({
    apiKey: config.apiKey,
    silent
  });

  // Patch all HTTP modules
  patchHTTPS();
  patchHTTP();
  patchFetch();

  isGloballyPatched = true;

  if (!silent) {
    console.log('🌐 Global Coolhand monitoring initialized');
    console.log(`🎯 API Endpoint: ${globalLoggingService.getApiEndpoint()}`);
    console.log(`📋 Loaded ${globalPatternService.getPatternsCount()} AI API patterns`);
    console.log('🔍 Now monitoring ALL outbound HTTP requests for AI API calls...');
  }
}

/**
 * Get global monitoring statistics
 */
export function getGlobalStats() {
  return {
    totalRequests: callCounter,
    interceptedCalls: interceptedCalls,
    apiEndpoint: globalLoggingService?.getApiEndpoint() || 'Not initialized',
    isInitialized: isGloballyPatched
  };
}

/**
 * Check if global monitoring is active
 */
export function isGlobalMonitoringActive(): boolean {
  return isGloballyPatched;
}

function generateRequestId(options: RequestOptions | string | URL, method: string): string {
  const url = buildURL(options, method.includes('https') ? 'https' : 'http');
  return `${method.toUpperCase()}:${url}`;
}

function isRequestActive(requestId: string): boolean {
  const active = globalActiveRequests.get(requestId);
  if (!active) return false;

  const now = Date.now();
  if (now - active.timestamp > DEDUP_WINDOW_MS) {
    globalActiveRequests.delete(requestId);
    return false;
  }

  return true;
}

function registerActiveRequest(requestId: string): string {
  const uniqueId = `${requestId}-${Date.now()}-${Math.random()}`;
  const now = Date.now();

  const existing = globalActiveRequests.get(requestId);
  if (existing) {
    existing.requestIds.add(uniqueId);
  } else {
    globalActiveRequests.set(requestId, {
      timestamp: now,
      requestIds: new Set([uniqueId])
    });
  }

  return uniqueId;
}

function unregisterActiveRequest(requestId: string, uniqueId: string): void {
  const active = globalActiveRequests.get(requestId);
  if (active) {
    active.requestIds.delete(uniqueId);
    if (active.requestIds.size === 0) {
      globalActiveRequests.delete(requestId);
    }
  }
}

function patchHTTPS(): void {
  const originalRequest = https.request;
  const originalGet = https.get;

  try {
    const requestDescriptor = Object.getOwnPropertyDescriptor(https, 'request');
    if (!requestDescriptor || requestDescriptor.configurable !== false) {
      Object.defineProperty(https, 'request', {
        value: function(options: RequestOptions | string | URL, callback?: (res: http.IncomingMessage) => void) {
          debugRequest('HTTPS REQUEST', options);

          if (!globalPatternService) {
            return originalRequest.call(this, options as any, callback as any);
          }

          const matchedPattern = globalPatternService.matchesAPIPattern(options);

          if (matchedPattern) {
            const method = typeof options === 'object' && 'method' in options ? options.method || 'GET' : 'GET';
            const requestId = generateRequestId(options, `https-${method}`);

            if (isRequestActive(requestId)) {
              log(`🔄 Skipping duplicate HTTPS request: ${method} ${buildURL(options, 'https')}`);
              return originalRequest.call(this, options as any, callback as any);
            }

            log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTPS call`);
            return interceptRequest(originalRequest, options, callback, 'https', matchedPattern);
          }

          return originalRequest.call(this, options as any, callback as any);
        },
        writable: true,
        configurable: true
      });
    }
  } catch {
    log('Warning: Could not patch https.request');
  }

  try {
    const getDescriptor = Object.getOwnPropertyDescriptor(https, 'get');
    if (!getDescriptor || getDescriptor.configurable !== false) {
      Object.defineProperty(https, 'get', {
        value: function(options: RequestOptions | string | URL, callback?: (res: http.IncomingMessage) => void) {
          debugRequest('HTTPS GET', options);

          if (!globalPatternService) {
            return originalGet.call(this, options as any, callback as any);
          }

          const matchedPattern = globalPatternService.matchesAPIPattern(options);

          if (matchedPattern) {
            const requestId = generateRequestId(options, 'https-GET');

            if (isRequestActive(requestId)) {
              log(`🔄 Skipping duplicate HTTPS GET: ${buildURL(options, 'https')}`);
              return originalGet.call(this, options as any, callback as any);
            }

            log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTPS GET`);
            return interceptRequest(originalRequest, options, callback, 'https', matchedPattern);
          }

          return originalGet.call(this, options as any, callback as any);
        },
        writable: true,
        configurable: true
      });
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
        value: function(options: RequestOptions | string | URL, callback?: (res: http.IncomingMessage) => void) {
          debugRequest('HTTP REQUEST', options);

          if (!globalPatternService) {
            return originalRequest.call(this, options as any, callback as any);
          }

          const matchedPattern = globalPatternService.matchesAPIPattern(options);

          if (matchedPattern) {
            const method = typeof options === 'object' && 'method' in options ? options.method || 'GET' : 'GET';
            const requestId = generateRequestId(options, `http-${method}`);

            if (isRequestActive(requestId)) {
              log(`🔄 Skipping duplicate HTTP request: ${method} ${buildURL(options, 'http')}`);
              return originalRequest.call(this, options as any, callback as any);
            }

            log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTP call`);
            return interceptRequest(originalRequest, options, callback, 'http', matchedPattern);
          }

          return originalRequest.call(this, options as any, callback as any);
        },
        writable: true,
        configurable: true
      });
    }
  } catch {
    log('Warning: Could not patch http.request');
  }

  try {
    const getDescriptor = Object.getOwnPropertyDescriptor(http, 'get');
    if (!getDescriptor || getDescriptor.configurable !== false) {
      Object.defineProperty(http, 'get', {
        value: function(options: RequestOptions | string | URL, callback?: (res: http.IncomingMessage) => void) {
          debugRequest('HTTP GET', options);

          if (!globalPatternService) {
            return originalGet.call(this, options as any, callback as any);
          }

          const matchedPattern = globalPatternService.matchesAPIPattern(options);

          if (matchedPattern) {
            const requestId = generateRequestId(options, 'http-GET');

            if (isRequestActive(requestId)) {
              log(`🔄 Skipping duplicate HTTP GET: ${buildURL(options, 'http')}`);
              return originalGet.call(this, options as any, callback as any);
            }

            log(`🎯 INTERCEPTING ${matchedPattern.pattern.name} HTTP GET`);
            return interceptRequest(originalRequest, options, callback, 'http', matchedPattern);
          }

          return originalGet.call(this, options as any, callback as any);
        },
        writable: true,
        configurable: true
      });
    }
  } catch {
    log('Warning: Could not patch http.get');
  }
}

function patchFetch(): void {
  if (typeof globalThis.fetch === 'function') {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async function(url: string | URL | Request, options: RequestInit = {}) {
      const urlStr = typeof url === 'string' ? url : url.toString();
      debugRequest('FETCH', { url: urlStr, ...options });

      if (!globalPatternService) {
        return originalFetch.call(this, url, options);
      }

      const matchedPattern = globalPatternService.matchesAPIPatternFromURL(urlStr);

      if (matchedPattern) {
        const method = options.method || 'GET';
        const requestId = generateRequestId({ url: urlStr }, `fetch-${method}`);

        if (isRequestActive(requestId)) {
          log(`🔄 Skipping duplicate FETCH: ${method} ${urlStr}`);
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
  originalRequest: typeof https.request | typeof http.request,
  options: RequestOptions | string | URL,
  callback?: (res: http.IncomingMessage) => void,
  protocol: 'https' | 'http' = 'https',
  matchedPattern?: MatchedPattern
): http.ClientRequest {
  interceptedCalls++;

  const method = typeof options === 'object' && 'method' in options ? options.method || 'GET' : 'GET';
  const url = buildURL(options, protocol);
  const requestId = generateRequestId(options, `${protocol}-${method}`);
  const uniqueId = registerActiveRequest(requestId);

  const callData: CallData = {
    id: interceptedCalls,
    timestamp: new Date().toISOString(),
    method: method,
    url: url,
    headers: globalPatternService!.sanitizeHeaders(
      typeof options === 'object' && 'headers' in options ? options.headers || {} : {},
      matchedPattern?.pattern
    ),
    request_body: null,
    response_body: null,
    response_headers: null,
    status_code: null,
    protocol: protocol
  };

  log(`📞 Starting API call #${callData.id} to ${url}`);

  let requestBody = '';

  const req = originalRequest(options as any, (res: http.IncomingMessage) => {
    log(`📥 Response received for call #${callData.id}, status: ${res.statusCode}`);

    let responseBody = '';

    res.on('data', (chunk: any) => {
      responseBody += chunk.toString();
    });

    res.on('end', () => {
      callData.response_body = parseJSON(responseBody);
      callData.response_headers = globalPatternService!.sanitizeHeaders(res.headers, matchedPattern?.pattern);
      callData.status_code = res.statusCode || null;

      // Log to API
      if (globalLoggingService) {
        globalLoggingService.logRequestToAPI(callData, matchedPattern);
      }

      // Cleanup
      unregisterActiveRequest(requestId, uniqueId);
    });

    if (callback) { callback(res); }
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
    callData.request_body = parseJSON(requestBody);
    log(`📤 Request complete for call #${callData.id}`);
    return originalEnd(chunk, encoding, callback);
  });

  req.on('error', (err) => {
    log(`❌ Request error for call #${callData.id}:`, err.message);
    unregisterActiveRequest(requestId, uniqueId);
  });

  return req;
}

async function interceptFetch(
  originalFetch: typeof fetch,
  url: string | URL | Request,
  options: RequestInit,
  matchedPattern?: MatchedPattern
): Promise<Response> {
  interceptedCalls++;

  const method = options.method || 'GET';
  const urlStr = url.toString();
  const requestId = generateRequestId({ url: urlStr }, `fetch-${method}`);
  const uniqueId = registerActiveRequest(requestId);

  const callData: CallData = {
    id: interceptedCalls,
    timestamp: new Date().toISOString(),
    method: method,
    url: urlStr,
    headers: globalPatternService!.sanitizeHeaders(
      options.headers instanceof Headers
        ? Object.fromEntries(options.headers.entries())
        : (options.headers || {}),
      matchedPattern?.pattern
    ),
    request_body: options.body ? parseJSON(options.body as string) : null,
    response_body: null,
    response_headers: null,
    status_code: null,
    protocol: 'fetch'
  };

  log(`📞 Starting FETCH call #${callData.id} to ${url}`);

  try {
    const response = await originalFetch.call(globalThis, url, options);

    callData.status_code = response.status;
    callData.response_headers = Object.fromEntries(response.headers.entries());

    // Clone response to read body without consuming it
    const responseClone = response.clone();
    const responseText = await responseClone.text();
    callData.response_body = parseJSON(responseText);

    // Log to API
    if (globalLoggingService) {
      globalLoggingService.logRequestToAPI(callData, matchedPattern);
    }

    // Cleanup
    unregisterActiveRequest(requestId, uniqueId);

    return response;
  } catch (error) {
    log(`❌ Fetch error for call #${callData.id}:`, (error as Error).message);
    unregisterActiveRequest(requestId, uniqueId);
    throw error;
  }
}

function buildURL(options: RequestOptions | string | URL | any, protocol: string): string {
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

function parseJSON(str: string | null): any {
  if (!str) { return null; }
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function debugRequest(type: string, options: RequestOptions | string | URL | any): void {
  const hostname = typeof options === 'string' ? options :
                  options instanceof URL ? options.hostname :
                  options.hostname || options.host || options.url || 'unknown';
  log(`🌐 ${type} to: ${hostname}`);

  // Count all requests
  callCounter++;
}

function log(...args: any[]): void {
  if (!silent) {
    console.log(...args);
  }
}