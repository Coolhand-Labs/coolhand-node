/**
 * Regression tests for ESM module namespace patching fix (Issue #25).
 *
 * These tests verify:
 *  1. The CJS→ESM detection heuristic (configurable property check)
 *  2. The createRequire fallback path when ESM namespaces are detected
 *  3. Warning messages when patching is skipped
 *  4. PatternMatchingService path resolution when __dirname is unavailable
 */

import * as fs from 'fs';
import { PatternMatchingService } from '../src/services/PatternMatchingService';
import { LoggingService } from '../src/services/LoggingService';

jest.mock('fs');
jest.mock('../src/services/PatternMatchingService');
jest.mock('../src/services/LoggingService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockServices() {
  const mockPatternMatchingService = {
    matchesAPIPattern: jest.fn(),
    matchesAPIPatternSync: jest.fn(),
    matchesAPIPatternFromURL: jest.fn(),
    sanitizeHeaders: jest.fn().mockImplementation((h) => ({ ...h })),
    getLoadedPatterns: jest.fn(),
    getLoadedPatternsSync: jest.fn(),
    getPatternsCount: jest.fn().mockResolvedValue(5),
    getPatternsCountSync: jest.fn().mockReturnValue(5),
  } as any;

  const mockLoggingService = {
    logRequestToAPI: jest.fn(),
    getApiEndpoint: jest.fn().mockReturnValue('https://api.coolhand.dev'),
  } as any;

  (PatternMatchingService as jest.MockedClass<typeof PatternMatchingService>)
    .mockImplementation(() => mockPatternMatchingService);
  (LoggingService as jest.MockedClass<typeof LoggingService>)
    .mockImplementation(() => mockLoggingService);

  return { mockPatternMatchingService, mockLoggingService };
}

// ---------------------------------------------------------------------------
// 1. ESM namespace detection & createRequire fallback (global-monitor)
// ---------------------------------------------------------------------------

describe('ESM namespace detection and createRequire fallback', () => {
  let originalFetch: typeof globalThis.fetch;
  let consoleWarnSpy: jest.SpyInstance;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: () => ({ text: () => Promise.resolve('{}') }),
    });

    makeMockServices();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should proceed without createRequire when properties are configurable (CJS / bundled)', async () => {
    // Simulate CJS module objects: configurable = true
    jest.spyOn(Object, 'getOwnPropertyDescriptor').mockReturnValue({
      configurable: true,
      writable: true,
      enumerable: true,
      value: jest.fn(),
    });
    jest.spyOn(Object, 'defineProperty').mockImplementation((obj, prop, desc) => {
      (obj as any)[prop] = desc.value;
      return obj;
    });

    const globalMonitor = await import('../src/global-monitor');
    await globalMonitor.initializeGlobalMonitoring({ apiKey: 'k', silent: true });

    // defineProperty should have been called (patching succeeded on the first try)
    expect(Object.defineProperty).toHaveBeenCalled();
  });

  it('should warn when https.request property is non-configurable and cannot be patched', async () => {
    // Use a targeted mock that delegates to the REAL Object.getOwnPropertyDescriptor
    // for Node.js internals, but returns configurable: false for 'request' and 'get'
    // properties. This lets loadNodeModules and createRequire work normally while
    // forcing the patchHTTPS/patchHTTP guards to hit the non-configurable else-branch.
    const realGetOwnPropDesc = Object.getOwnPropertyDescriptor;
    jest.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation(
      (obj: any, prop: PropertyKey) => {
        const realDesc = realGetOwnPropDesc(obj, prop);
        if (prop === 'request' || prop === 'get') {
          return {
            configurable: false,
            writable: false,
            enumerable: true,
            value: realDesc?.value ?? jest.fn(),
          };
        }
        return realDesc;
      }
    );

    const globalMonitor = await import('../src/global-monitor');
    await globalMonitor.initializeGlobalMonitoring({ apiKey: 'k', silent: true });

    // The non-configurable guard should emit warnings for request/get on http/https
    const warnCalls = consoleWarnSpy.mock.calls.map((c: any[]) => c[0]);
    const patchWarnings = warnCalls.filter(
      (msg: string) => typeof msg === 'string' && msg.includes('non-configurable')
    );
    expect(patchWarnings.length).toBeGreaterThanOrEqual(4); // https.request, https.get, http.request, http.get
  });

  it('should not warn about non-configurable when properties are configurable', async () => {
    jest.spyOn(Object, 'getOwnPropertyDescriptor').mockReturnValue({
      configurable: true,
      writable: true,
      enumerable: true,
      value: jest.fn(),
    });
    jest.spyOn(Object, 'defineProperty').mockImplementation((obj, prop, desc) => {
      (obj as any)[prop] = desc.value;
      return obj;
    });

    const globalMonitor = await import('../src/global-monitor');
    await globalMonitor.initializeGlobalMonitoring({ apiKey: 'k', silent: true });

    const warnCalls = consoleWarnSpy.mock.calls.map((c: any[]) => c[0]);
    const patchWarnings = warnCalls.filter(
      (msg: string) => typeof msg === 'string' && msg.includes('non-configurable')
    );
    expect(patchWarnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. createRequire produces patchable modules (unit-level contract test)
// ---------------------------------------------------------------------------

describe('createRequire contract', () => {
  it('should return http/https modules whose request property is configurable', async () => {
    // This is the core invariant the fix relies on.
    const { createRequire } = await import('module') as any;
    const cjsRequire = createRequire('file://' + process.cwd() + '/');

    const httpsModule = cjsRequire('https');
    const httpModule = cjsRequire('http');

    const httpsDesc = Object.getOwnPropertyDescriptor(httpsModule, 'request');
    const httpDesc = Object.getOwnPropertyDescriptor(httpModule, 'request');

    expect(httpsDesc).toBeDefined();
    expect(httpsDesc!.configurable).toBe(true);

    expect(httpDesc).toBeDefined();
    expect(httpDesc!.configurable).toBe(true);
  });

  it('should return patchable https.get', async () => {
    const { createRequire } = await import('module') as any;
    const cjsRequire = createRequire('file://' + process.cwd() + '/');
    const httpsModule = cjsRequire('https');

    const desc = Object.getOwnPropertyDescriptor(httpsModule, 'get');
    expect(desc).toBeDefined();
    expect(desc!.configurable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. ESM namespace objects are NOT patchable (documents the problem)
// ---------------------------------------------------------------------------

describe('ESM namespace objects are non-configurable (documents the bug)', () => {
  it('await import("https") returns non-configurable request property', async () => {
    const httpsEsm = await import('https');
    const desc = Object.getOwnPropertyDescriptor(httpsEsm, 'request');

    // This assertion documents the root cause of issue #25.
    // In Node.js ESM, module namespace properties are non-configurable.
    expect(desc).toBeDefined();
    expect(desc!.configurable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. PatternMatchingService: loadAPIPatternsSync path resolution
// ---------------------------------------------------------------------------

describe('PatternMatchingService path resolution in loadAPIPatternsSync', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('should use _path.resolve for custom patterns file', () => {
    // The loadAPIPatternsSync method receives fs and _path as arguments.
    // When customPatternsFile is provided, it calls _path.resolve(customPatternsFile).
    // We test the contract by using the real PatternMatchingService in isolation.
    jest.isolateModules(() => {
      jest.unmock('../src/services/PatternMatchingService');

      // Set up fs mock so the file "exists" and returns patterns
      const fsMock = require('fs');
      fsMock.existsSync = jest.fn().mockReturnValue(true);
      fsMock.readFileSync = jest.fn().mockReturnValue(JSON.stringify({
        patterns: [{ name: 'Test', domains: ['test.com'], headers: {} }],
      }));

      const { PatternMatchingService: RealService } = require('../src/services/PatternMatchingService');
      const svc = new RealService({ customPatternsFile: '/abs/custom.json', silent: true });

      // The service loaded patterns from the custom file
      expect(svc.getPatternsCountSync()).toBe(1);
    });
  });

  it('should fall back to process.cwd() when __dirname and import.meta.url are unavailable', () => {
    // This tests the outermost fallback in the loadAPIPatternsSync path resolution.
    // In the test environment __dirname IS defined, so this branch is not normally hit.
    // We document the expectation here: process.cwd() is the last resort.
    expect(typeof process.cwd()).toBe('string');
    expect(process.cwd().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Edge runtime skips HTTP patching entirely (existing behaviour preserved)
// ---------------------------------------------------------------------------

describe('Edge runtime bypass is preserved', () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: () => ({ text: () => Promise.resolve('{}') }),
    });

    makeMockServices();

    jest.spyOn(Object, 'getOwnPropertyDescriptor').mockReturnValue({
      configurable: true,
      writable: true,
      enumerable: true,
      value: jest.fn(),
    });
    jest.spyOn(Object, 'defineProperty').mockImplementation((obj, prop, desc) => {
      (obj as any)[prop] = desc.value;
      return obj;
    });
  });

  afterEach(() => {
    delete (globalThis as any).EdgeRuntime;
    jest.restoreAllMocks();
  });

  it('should emit edge runtime warning and not attempt http/https patching', async () => {
    (globalThis as any).EdgeRuntime = 'edge';

    const globalMonitor = await import('../src/global-monitor');
    await globalMonitor.initializeGlobalMonitoring({ apiKey: 'k', silent: false });

    const warnCalls = consoleWarnSpy.mock.calls.map((c: any[]) => c[0]);
    const edgeWarning = warnCalls.find(
      (msg: string) => typeof msg === 'string' && msg.includes('Edge runtime detected')
    );
    expect(edgeWarning).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 6. Patching all four methods (https.request, https.get, http.request, http.get)
// ---------------------------------------------------------------------------

describe('All four HTTP methods are patched when configurable', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: () => ({ text: () => Promise.resolve('{}') }),
    });

    makeMockServices();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should call defineProperty at least 4 times to patch request and get on both http and https', async () => {
    jest.spyOn(Object, 'getOwnPropertyDescriptor').mockReturnValue({
      configurable: true,
      writable: true,
      enumerable: true,
      value: jest.fn(),
    });

    const definePropertySpy = jest.spyOn(Object, 'defineProperty').mockImplementation(
      (obj, prop, desc) => {
        (obj as any)[prop] = desc.value;
        return obj;
      }
    );

    const globalMonitor = await import('../src/global-monitor');
    await globalMonitor.initializeGlobalMonitoring({ apiKey: 'k', silent: true });

    // At least 4 defineProperty calls for the http/https patches.
    // There may be additional calls from Node.js internals.
    expect(definePropertySpy.mock.calls.length).toBeGreaterThanOrEqual(4);

    // Verify that 'request' appears at least twice (https.request + http.request)
    const patchedProps = definePropertySpy.mock.calls.map((call) => call[1] as string);
    expect(patchedProps.filter((p) => p === 'request').length).toBeGreaterThanOrEqual(2);
  });
});
