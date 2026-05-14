/**
 * Integration tests verifying all configuration features work correctly
 * after the ESM namespace patching fix (Issue #25).
 *
 * These tests exercise the public API surface end-to-end through the
 * modified PatternMatchingService and global-monitor code paths.
 */

// No top-level fs/path imports needed — mocking is done within jest.isolateModules

// ---------------------------------------------------------------------------
// 1. Coolhand class: all configuration options
// ---------------------------------------------------------------------------

describe('Coolhand class configuration', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('should initialize with apiKey only (defaults: silent=true, debug=false)', () => {
    jest.isolateModules(() => {
      const { Coolhand } = require('../src/coolhand');
      const instance = new Coolhand({ apiKey: 'test-key' });

      const stats = instance.getStats();
      expect(stats).toHaveProperty('totalRequests', 0);
      expect(stats).toHaveProperty('interceptedCalls', 0);
      expect(stats).toHaveProperty('apiEndpoint');
      expect(stats.apiEndpoint).toContain('coolhandlabs.com');
    });
  });

  it('should throw when apiKey is missing', () => {
    jest.isolateModules(() => {
      const { Coolhand } = require('../src/coolhand');
      expect(() => new Coolhand({} as any)).toThrow('API key is required');
    });
  });

  it('should respect silent=false and emit console output', () => {
    const logSpy = jest.spyOn(console, 'log');

    jest.isolateModules(() => {
      const { Coolhand } = require('../src/coolhand');
      new Coolhand({ apiKey: 'test-key', silent: false });
    });

    const msgs = logSpy.mock.calls.map(c => c[0]);
    expect(msgs.some((m: string) => typeof m === 'string' && m.includes('Coolhand'))).toBe(true);
  });

  it('should suppress console output when silent=true', () => {
    // Track calls manually to avoid spy leakage between tests
    const captured: string[] = [];
    const origLog = console.log;
    console.log = ((...args: any[]) => { captured.push(String(args[0])); }) as any;

    try {
      jest.isolateModules(() => {
        const { Coolhand } = require('../src/coolhand');
        new Coolhand({ apiKey: 'test-key', silent: true });
      });

      expect(captured.filter(m => m.includes('Setting up Coolhand'))).toHaveLength(0);
    } finally {
      console.log = origLog;
    }
  });

  it('should show debug mode indicator when debug=true and silent=false', () => {
    const logSpy = jest.spyOn(console, 'log');

    jest.isolateModules(() => {
      const { Coolhand } = require('../src/coolhand');
      new Coolhand({ apiKey: 'test-key', silent: false, debug: true });
    });

    const msgs = logSpy.mock.calls.map(c => c[0]);
    expect(msgs.some((m: string) => typeof m === 'string' && m.includes('DEBUG MODE'))).toBe(true);
  });

  it('should accept a custom patternsFile path without crashing', () => {
    jest.isolateModules(() => {
      // Mock fs within isolated module scope so ESM getter-only props are bypassed
      jest.doMock('fs', () => ({
        existsSync: jest.fn().mockReturnValue(true),
        readFileSync: jest.fn().mockReturnValue(JSON.stringify({
          patterns: [
            { name: 'Custom', domains: ['custom.api.com'], headers: { 'x-key': '[REDACTED]' } },
          ],
        })),
      }));

      const { Coolhand } = require('../src/coolhand');
      const instance = new Coolhand({
        apiKey: 'test-key',
        patternsFile: '/custom/patterns.json',
        silent: true,
      });

      expect(instance.getStats()).toHaveProperty('apiEndpoint');
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Coolhand class: feedback helper methods
// ---------------------------------------------------------------------------

describe('Coolhand feedback helpers', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('should expose createFeedback method', () => {
    jest.isolateModules(() => {
      const { Coolhand } = require('../src/coolhand');
      const instance = new Coolhand({ apiKey: 'test-key', silent: true });
      expect(typeof instance.createFeedback).toBe('function');
    });
  });

  it('should return null from createFeedback in debug mode', async () => {
    let result: any;
    await jest.isolateModulesAsync(async () => {
      const { Coolhand } = require('../src/coolhand');
      const instance = new Coolhand({ apiKey: 'test-key', silent: true, debug: true });

      result = await instance.createFeedback({
        like: true,
        explanation: 'Great answer',
      });
    });

    expect(result).toBeNull();
  });

  it('should send feedback payload when not in debug mode', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 1, like: true }),
    });
    globalThis.fetch = fetchSpy;

    await jest.isolateModulesAsync(async () => {
      const { Coolhand } = require('../src/coolhand');
      const instance = new Coolhand({ apiKey: 'test-key', silent: true, debug: false });

      await instance.createFeedback({
        like: true,
        explanation: 'Test feedback',
      });
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('llm_request_log_feedbacks');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-API-Key']).toBe('test-key');

    // Payload should include collector field
    const body = JSON.parse(opts.body);
    expect(body.llm_request_log_feedback).toHaveProperty('sentiment', 'like');
    expect(body.llm_request_log_feedback).not.toHaveProperty('like');
    expect(body.llm_request_log_feedback).toHaveProperty('collector');
    expect(body.llm_request_log_feedback.collector).toContain('coolhand-node');
  });
});

// ---------------------------------------------------------------------------
// 3. Coolhand class: header sanitization
// ---------------------------------------------------------------------------

describe('Coolhand header sanitization', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('should sanitize authorization headers', () => {
    jest.isolateModules(() => {
      const { Coolhand } = require('../src/coolhand');
      const instance = new Coolhand({ apiKey: 'test-key', silent: true });

      const sanitized = instance.sanitizeHeaders(
        { authorization: 'Bearer sk-secret-token-123', 'content-type': 'application/json' },
        { name: 'OpenAI', headers: { authorization: '[REDACTED]' } }
      );

      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized['content-type']).toBe('application/json');
    });
  });

  it('should return headers unchanged when no pattern is provided', () => {
    jest.isolateModules(() => {
      const { Coolhand } = require('../src/coolhand');
      const instance = new Coolhand({ apiKey: 'test-key', silent: true });

      const headers = { 'x-custom': 'value', accept: 'application/json' };
      const sanitized = instance.sanitizeHeaders(headers);

      expect(sanitized['x-custom']).toBe('value');
      expect(sanitized.accept).toBe('application/json');
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Global monitoring: all configuration options
// ---------------------------------------------------------------------------

describe('Global monitoring configuration', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();

    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: () => ({ text: () => Promise.resolve('{}') }),
    });
  });

  it('should initialize and report stats', async () => {
    const mod = await import('../src/global-monitor');
    await mod.initializeGlobalMonitoring({ apiKey: 'k', silent: true });

    const stats = mod.getGlobalStats();
    expect(stats.isInitialized).toBe(true);
    expect(typeof stats.totalRequests).toBe('number');
    expect(typeof stats.interceptedCalls).toBe('number');
    expect(stats.apiEndpoint).toContain('coolhandlabs.com');
  });

  it('should report active after initialization', async () => {
    const mod = await import('../src/global-monitor');
    await mod.initializeGlobalMonitoring({ apiKey: 'k', silent: true });

    expect(mod.isGlobalMonitoringActive()).toBe(true);
  });

  it('should accept debug flag without crashing', async () => {
    const mod = await import('../src/global-monitor');
    await expect(
      mod.initializeGlobalMonitoring({ apiKey: 'k', silent: true, debug: true })
    ).resolves.not.toThrow();
  });

  it('should accept patternsFile without crashing', async () => {
    const mod = await import('../src/global-monitor');
    await expect(
      mod.initializeGlobalMonitoring({
        apiKey: 'k',
        silent: true,
        patternsFile: './nonexistent-but-should-not-crash.json',
      })
    ).resolves.not.toThrow();
  });

  it('should log startup messages when silent=false', async () => {
    const logSpy = console.log as jest.Mock;

    const mod = await import('../src/global-monitor');
    await mod.initializeGlobalMonitoring({ apiKey: 'k', silent: false });

    const msgs = logSpy.mock.calls.map((c: any[]) => c[0]);
    expect(msgs.some((m: string) => typeof m === 'string' && m.includes('Coolhand'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Auto-monitor: environment variable configuration
// ---------------------------------------------------------------------------

describe('Auto-monitor environment variable configuration', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();

    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Back up env
    for (const key of ['COOLHAND_API_KEY', 'COOLHAND_SILENT', 'COOLHAND_PATTERNS_FILE', 'COOLHAND_DEBUG', 'NODE_ENV']) {
      envBackup[key] = process.env[key];
    }

    globalThis.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      clone: () => ({ text: () => Promise.resolve('{}') }),
    });
  });

  afterEach(() => {
    // Restore env
    for (const [key, val] of Object.entries(envBackup)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it('should warn when COOLHAND_API_KEY is missing (non-production)', async () => {
    delete process.env.COOLHAND_API_KEY;
    delete process.env.NODE_ENV;

    const warnSpy = console.warn as jest.Mock;
    await import('../src/auto-monitor');

    const msgs = warnSpy.mock.calls.map((c: any[]) => c[0]);
    expect(msgs.some((m: string) => typeof m === 'string' && m.includes('COOLHAND_API_KEY not found'))).toBe(true);
  });

  it('should not warn when COOLHAND_API_KEY is missing in production', async () => {
    delete process.env.COOLHAND_API_KEY;
    process.env.NODE_ENV = 'production';

    // Track warns manually to avoid spy leakage from setup.ts jest.fn()
    const captured: string[] = [];
    const origWarn = console.warn;
    console.warn = ((...args: any[]) => { captured.push(String(args[0])); }) as any;

    try {
      await import('../src/auto-monitor');
      expect(captured.some(m => m.includes('COOLHAND_API_KEY not found'))).toBe(false);
    } finally {
      console.warn = origWarn;
    }
  });

  it('should auto-initialize when COOLHAND_API_KEY is set', async () => {
    process.env.COOLHAND_API_KEY = 'auto-test-key';

    const mod = await import('../src/auto-monitor');
    // Give the async IIFE time to run
    await new Promise(r => setTimeout(r, 50));

    expect(mod.isGlobalMonitoringActive()).toBe(true);
  });

  it('should respect COOLHAND_SILENT=false', async () => {
    process.env.COOLHAND_API_KEY = 'auto-test-key';
    process.env.COOLHAND_SILENT = 'false';

    const logSpy = console.log as jest.Mock;
    await import('../src/auto-monitor');
    await new Promise(r => setTimeout(r, 50));

    const msgs = logSpy.mock.calls.map((c: any[]) => c[0]);
    expect(msgs.some((m: string) => typeof m === 'string' && m.includes('Auto-initializing'))).toBe(true);
  });

  it('should respect COOLHAND_DEBUG=true', async () => {
    process.env.COOLHAND_API_KEY = 'auto-test-key';
    process.env.COOLHAND_SILENT = 'false';
    process.env.COOLHAND_DEBUG = 'true';

    const logSpy = console.log as jest.Mock;
    await import('../src/auto-monitor');
    await new Promise(r => setTimeout(r, 50));

    const msgs = logSpy.mock.calls.map((c: any[]) => c[0]);
    expect(msgs.some((m: string) => typeof m === 'string' && m.includes('Debug mode'))).toBe(true);
  });

  it('should re-export initializeGlobalMonitoring, getGlobalStats, isGlobalMonitoringActive', async () => {
    delete process.env.COOLHAND_API_KEY;

    const mod = await import('../src/auto-monitor');
    expect(typeof mod.initializeGlobalMonitoring).toBe('function');
    expect(typeof mod.getGlobalStats).toBe('function');
    expect(typeof mod.isGlobalMonitoringActive).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 6. PatternMatchingService: patterns loaded correctly after changes
// ---------------------------------------------------------------------------

describe('PatternMatchingService integration after ESM fix', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    // Ensure fs/path are NOT mocked (a prior test uses jest.doMock('fs'))
    jest.unmock('fs');
    jest.unmock('path');
  });

  it('should load default patterns (OpenAI, Anthropic, Google AI)', () => {
    jest.isolateModules(() => {
      const { PatternMatchingService } = require('../src/services/PatternMatchingService');
      const svc = new PatternMatchingService({ silent: true });

      expect(svc.getPatternsCountSync()).toBeGreaterThanOrEqual(3);
    });
  });

  it('should match OpenAI domain after initialization', () => {
    jest.isolateModules(() => {
      const { PatternMatchingService } = require('../src/services/PatternMatchingService');
      const svc = new PatternMatchingService({ silent: true });

      const match = svc.matchesAPIPatternSync({ hostname: 'api.openai.com', path: '/v1/chat/completions' });
      expect(match).not.toBeNull();
      expect(match!.pattern.name).toBe('OpenAI');
    });
  });

  it('should match Anthropic domain', () => {
    jest.isolateModules(() => {
      const { PatternMatchingService } = require('../src/services/PatternMatchingService');
      const svc = new PatternMatchingService({ silent: true });

      const match = svc.matchesAPIPatternSync({ hostname: 'api.anthropic.com', path: '/v1/messages' });
      expect(match).not.toBeNull();
      expect(match!.pattern.name).toBe('Anthropic');
    });
  });

  it('should match Google AI / Gemini domain', () => {
    jest.isolateModules(() => {
      const { PatternMatchingService } = require('../src/services/PatternMatchingService');
      const svc = new PatternMatchingService({ silent: true });

      const match = svc.matchesAPIPatternSync({ hostname: 'generativelanguage.googleapis.com', path: '/v1/models' });
      expect(match).not.toBeNull();
      expect(match!.pattern.name).toBe('Google AI');
    });
  });

  it('should return null for non-matching domains', () => {
    jest.isolateModules(() => {
      const { PatternMatchingService } = require('../src/services/PatternMatchingService');
      const svc = new PatternMatchingService({ silent: true });

      const match = svc.matchesAPIPatternSync({ hostname: 'example.com', path: '/api/data' });
      expect(match).toBeNull();
    });
  });

  it('should sanitize headers using loaded patterns', () => {
    jest.isolateModules(() => {
      const { PatternMatchingService } = require('../src/services/PatternMatchingService');
      const svc = new PatternMatchingService({ silent: true });

      const sanitized = svc.sanitizeHeaders(
        { authorization: 'Bearer sk-secret', 'content-type': 'application/json' },
        { name: 'OpenAI', headers: { authorization: '[REDACTED]' } }
      );

      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized['content-type']).toBe('application/json');
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Collector utility: version and method strings
// ---------------------------------------------------------------------------

describe('Collector utility integration', () => {
  it('should return version-stamped collector string', () => {
    jest.isolateModules(() => {
      const { getCollectorString, getPackageName, getPackageVersion } = require('../src/utils/collector');

      expect(getPackageName()).toBe('coolhand-node');
      expect(getPackageVersion()).toMatch(/^\d+\.\d+\.\d+$/);

      const base = getCollectorString();
      expect(base).toMatch(/^coolhand-node-\d+\.\d+\.\d+$/);

      const withMethod = getCollectorString('global-monitoring');
      expect(withMethod).toMatch(/^coolhand-node-\d+\.\d+\.\d+-global-monitoring$/);
    });
  });
});

// ---------------------------------------------------------------------------
// 8. parseBody utility: unchanged after fix
// ---------------------------------------------------------------------------

describe('parseBody utility integration', () => {
  it('should parse JSON, pass through strings, and handle nulls', () => {
    jest.isolateModules(() => {
      const { parseBody } = require('../src/utils/parse-body');

      expect(parseBody('{"key":"value"}')).toEqual({ key: 'value' });
      expect(parseBody('not json')).toBe('not json');
      expect(parseBody(null)).toBeNull();
      expect(parseBody(undefined)).toBeNull();
      expect(parseBody('')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 9. LoggingService: debug mode skips API calls
// ---------------------------------------------------------------------------

describe('LoggingService debug mode integration', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('should skip API call in debug mode', async () => {
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy;

    await jest.isolateModulesAsync(async () => {
      const { LoggingService } = require('../src/services/LoggingService');
      const svc = new LoggingService({ apiKey: 'test', silent: true, debug: true });

      await svc.logRequestToAPI({
        id: 1,
        timestamp: new Date().toISOString(),
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {},
        request_body: {},
        response_body: {},
        response_headers: null,
        status_code: 200,
        protocol: 'https',
      });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should call API when debug=false', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    globalThis.fetch = fetchSpy;

    await jest.isolateModulesAsync(async () => {
      const { LoggingService } = require('../src/services/LoggingService');
      const svc = new LoggingService({ apiKey: 'test', silent: true, debug: false });

      await svc.logRequestToAPI({
        id: 1,
        timestamp: new Date().toISOString(),
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        headers: {},
        request_body: {},
        response_body: {},
        response_headers: null,
        status_code: 200,
        protocol: 'https',
      });
    });

    expect(fetchSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 10. FeedbackService: debug mode skips API calls
// ---------------------------------------------------------------------------

describe('FeedbackService debug mode integration', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('should return null in debug mode', async () => {
    let result: any;
    await jest.isolateModulesAsync(async () => {
      const { FeedbackService } = require('../src/services/FeedbackService');
      const svc = new FeedbackService({ apiKey: 'test', silent: true, debug: true });

      result = await svc.createFeedback({ like: true, explanation: 'good' });
    });

    expect(result).toBeNull();
  });

  it('should call API when debug=false', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 42, like: true }),
    });
    globalThis.fetch = fetchSpy;

    await jest.isolateModulesAsync(async () => {
      const { FeedbackService } = require('../src/services/FeedbackService');
      const svc = new FeedbackService({ apiKey: 'test', silent: true, debug: false });

      await svc.createFeedback({ like: false, explanation: 'bad' });
    });

    expect(fetchSpy).toHaveBeenCalled();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.llm_request_log_feedback.sentiment).toBe('dislike');
    expect(body.llm_request_log_feedback).not.toHaveProperty('like');
  });
});
