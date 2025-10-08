/**
 * Global monitoring functionality for coolhand-node
 *
 * This module provides universal HTTP monitoring that automatically detects
 * and logs AI API calls across any Node.js application.
 */

import { PatternMatchingService } from './services/PatternMatchingService.js';
import { LoggingService } from './services/LoggingService.js';
import { CoolhandRequestOptions, CoolhandCallData, CoolhandMatchedPattern, CoolhandStats } from './types.js';

// Global monitoring state
let globalPatternService: PatternMatchingService | null = null;
let globalLoggingService: LoggingService | null = null;
let globalStats = { totalRequests: 0, interceptedCalls: 0, apiEndpoint: '' };
let isInitialized = false;

// Runtime detection utility
const isEdgeRuntime = (): boolean => {
  return (typeof (globalThis as any).EdgeRuntime !== 'undefined') ||
    process.env.NEXT_RUNTIME === 'edge' ||
    (typeof (globalThis as any).window !== 'undefined');
};

// Node.js modules - conditionally imported
let https: any = null;
let http: any = null;

// Lazy load Node.js modules only when not in Edge runtime
const loadNodeModules = async () => {
  if (isEdgeRuntime()) {
    console.warn('⚠️ Edge runtime detected - HTTP/HTTPS patching will be limited to fetch() only');
    return false;
  }

  try {
    // Use dynamic imports for ES modules
    const httpsModule = await import('https');
    const httpModule = await import('http');
    https = httpsModule.default || httpsModule;
    http = httpModule.default || httpModule;
    return true;
  } catch (error) {
    console.warn('⚠️ Could not load Node.js HTTP modules:', (error as Error).message);
    return false;
  }
};

/**
 * Initialize global monitoring
 */
export function initializeGlobalMonitoring(options: {
  apiKey: string;
  environment?: 'local' | 'production';
  silent?: boolean;
  patternsFile?: string;
}): Promise<void> {
  return initializeGlobalMonitoringAsync(options);
}

/**
 * Internal async implementation
 */
async function initializeGlobalMonitoringAsync(options: {
  apiKey: string;
  environment?: 'local' | 'production';
  silent?: boolean;
  patternsFile?: string;
}): Promise<void> {
  if (isInitialized) {
    console.log('🔧 Global monitoring already initialized');
    return;
  }

  const { apiKey, environment = 'production', silent = true, patternsFile } = options;

  try {
    // Initialize services
    globalPatternService = new PatternMatchingService(patternsFile);
    globalLoggingService = new LoggingService({
      apiKey,
      silent,
    });

    // Update global stats
    globalStats.apiEndpoint = environment === 'local'
      ? 'http://localhost:3000/api/v2/llm_request_logs'
      : 'https://coolhand.io/api/v2/llm_request_logs';

    // Set up monitoring only if not in Edge runtime
    if (await loadNodeModules()) {
      setupGlobalMonitoring();
    } else {
      // In Edge runtime, still set up fetch patching
      patchFetchGlobal();
    }

    isInitialized = true;

    if (!silent) {
      console.log('✅ Global monitoring initialized successfully');
      console.log(`📊 Environment: ${environment}`);
      console.log(`🔕 Silent mode: ${silent ? 'ON' : 'OFF'}`);

      if (patternsFile) {
        console.log(`📁 Custom patterns file: ${patternsFile}`);
      }

      console.log(`📋 Loaded ${globalPatternService.getPatternsCount()} API patterns`);
    }
  } catch (error) {
    console.error('❌ Failed to initialize global monitoring:', (error as Error).message);
    throw error;
  }
}

/**
 * Set up global HTTP monitoring
 */
function setupGlobalMonitoring(): void {
  if (!https || !http || !globalPatternService || !globalLoggingService) {
    return;
  }

  // Patch HTTPS module
  patchHttpsModule();

  // Patch HTTP module
  patchHttpModule();

  // Patch fetch if available
  patchFetchGlobal();
}

/**
 * Patch HTTPS module
 */
function patchHttpsModule(): void {
  if (!https) return;

  const originalRequest = https.request;
  const originalGet = https.get;

  try {
    https.request = function(this: any, options: CoolhandRequestOptions | string | URL, callback?: any) {
      return interceptRequest(originalRequest, options, callback, 'https');
    };

    https.get = function(this: any, options: CoolhandRequestOptions | string | URL, callback?: any) {
      return interceptRequest(originalGet, options, callback, 'https');
    };
  } catch (error) {
    console.warn('⚠️ Could not patch HTTPS module:', (error as Error).message);
  }
}

/**
 * Patch HTTP module
 */
function patchHttpModule(): void {
  if (!http) return;

  const originalRequest = http.request;
  const originalGet = http.get;

  try {
    http.request = function(this: any, options: CoolhandRequestOptions | string | URL, callback?: any) {
      return interceptRequest(originalRequest, options, callback, 'http');
    };

    http.get = function(this: any, options: CoolhandRequestOptions | string | URL, callback?: any) {
      return interceptRequest(originalGet, options, callback, 'http');
    };
  } catch (error) {
    console.warn('⚠️ Could not patch HTTP module:', (error as Error).message);
  }
}

/**
 * Patch global fetch
 */
function patchFetchGlobal(): void {
  if (typeof globalThis.fetch !== 'function') {
    return;
  }

  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async function(url: string | URL | Request, options?: RequestInit) {
      return interceptFetch(originalFetch, url, options);
    };
  } catch (error) {
    console.warn('⚠️ Could not patch fetch:', (error as Error).message);
  }
}

/**
 * Intercept HTTP/HTTPS requests
 */
function interceptRequest(
  originalFunction: any,
  options: CoolhandRequestOptions | string | URL,
  callback?: any,
  protocol: 'http' | 'https' = 'https'
): any {
  globalStats.totalRequests++;

  if (!globalPatternService) {
    return originalFunction(options, callback);
  }

  // Check if this matches any API pattern
  const matchedPattern = globalPatternService.matchesAPIPattern(options);

  if (matchedPattern) {
    globalStats.interceptedCalls++;

    // Log the intercepted call
    const callData: CoolhandCallData = {
      id: globalStats.totalRequests,
      timestamp: new Date().toISOString(),
      method: 'POST', // Default for most AI APIs
      url: buildURL(options, protocol),
      headers: {},
      request_body: null,
      response_body: null,
      response_headers: null,
      status_code: null,
      protocol
    };

    // Log to Coolhand API
    if (globalLoggingService) {
      globalLoggingService.logRequestToAPI(callData, matchedPattern);
    }
  }

  return originalFunction(options, callback);
}

/**
 * Intercept fetch requests
 */
async function interceptFetch(
  originalFetch: any,
  url: string | URL | Request,
  options?: RequestInit
): Promise<Response> {
  globalStats.totalRequests++;

  if (!globalPatternService) {
    return originalFetch(url, options);
  }

  // Check if this matches any API pattern
  const matchedPattern = globalPatternService.matchesAPIPattern(url);

  if (matchedPattern) {
    globalStats.interceptedCalls++;

    // Log the intercepted call
    const callData: CoolhandCallData = {
      id: globalStats.totalRequests,
      timestamp: new Date().toISOString(),
      method: options?.method || 'GET',
      url: url.toString(),
      headers: options?.headers || {},
      request_body: options?.body || null,
      response_body: null,
      response_headers: null,
      status_code: null,
      protocol: 'https'
    };

    // Log to Coolhand API
    if (globalLoggingService) {
      globalLoggingService.logRequestToAPI(callData, matchedPattern);
    }
  }

  return originalFetch(url, options);
}

/**
 * Build URL from options
 */
function buildURL(options: CoolhandRequestOptions | string | URL, protocol: string): string {
  if (typeof options === 'string') {
    return options;
  }

  if (options instanceof URL) {
    return options.toString();
  }

  const hostname = options.hostname || options.host || 'localhost';
  const port = options.port ? `:${options.port}` : '';
  const path = options.path || '/';

  return `${protocol}://${hostname}${port}${path}`;
}

/**
 * Get global monitoring statistics
 */
export function getGlobalStats(): CoolhandStats {
  return {
    totalRequests: globalStats.totalRequests,
    interceptedCalls: globalStats.interceptedCalls,
    apiEndpoint: globalStats.apiEndpoint
  };
}

/**
 * Check if global monitoring is active
 */
export function isGlobalMonitoringActive(): boolean {
  return isInitialized;
}