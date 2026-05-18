import { Coolhand } from '../src/index';
import { LoggingService } from '../src/services/LoggingService';
import { FeedbackService } from '../src/services/FeedbackService';
import { CoolhandCallData } from '../src/types';
import { _resetGlobalState, initializeGlobalMonitoring } from '../src/global-monitor';

const fakeCallData: CoolhandCallData = {
  id: 1,
  timestamp: new Date().toISOString(),
  method: 'POST',
  url: 'https://api.openai.com/v1/chat/completions',
  headers: {},
  request_body: null,
  response_body: null,
  response_headers: null,
  status_code: 200,
  protocol: 'https'
};

describe('baseUrl configuration', () => {
  describe('Coolhand constructor', () => {
    it('uses the default endpoint when baseUrl is omitted', () => {
      const client = new Coolhand({ apiKey: 'test-key', silent: true });
      expect(client.getStats().apiEndpoint).toBe('https://coolhandlabs.com/api/v2/llm_request_logs');
    });

    it('uses a custom https baseUrl', () => {
      const client = new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'https://feedback.example.com'
      });
      expect(client.getStats().apiEndpoint).toBe('https://feedback.example.com/api/v2/llm_request_logs');
    });

    it('normalizes trailing slashes on baseUrl', () => {
      const client = new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'https://feedback.example.com/'
      });
      expect(client.getStats().apiEndpoint).toBe('https://feedback.example.com/api/v2/llm_request_logs');
    });

    it('normalizes multiple trailing slashes', () => {
      const client = new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'https://feedback.example.com///'
      });
      expect(client.getStats().apiEndpoint).toBe('https://feedback.example.com/api/v2/llm_request_logs');
    });

    it('accepts http://localhost for local dev', () => {
      expect(() => new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'http://localhost:3000'
      })).not.toThrow();
    });

    it('accepts http://127.0.0.1 for local dev', () => {
      expect(() => new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'http://127.0.0.1:8080'
      })).not.toThrow();
    });

    it('accepts http://[::1] (IPv6 loopback) for local dev', () => {
      expect(() => new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'http://[::1]:3000'
      })).not.toThrow();
    });

    it('rejects http://0.0.0.0 (unspecified address)', () => {
      expect(() => new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'http://0.0.0.0:3000'
      })).toThrow('baseUrl must use https://');
    });

    it('rejects http:// on a non-localhost host', () => {
      expect(() => new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'http://feedback.example.com'
      })).toThrow('baseUrl must use https://');
    });

    it('rejects a non-URL string', () => {
      expect(() => new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'not-a-url'
      })).toThrow('Invalid baseUrl');
    });

    it('rejects ftp:// (valid URL, wrong scheme)', () => {
      expect(() => new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'ftp://files.example.com'
      })).toThrow('baseUrl must use https://');
    });

    // Pin these so a future refactor to startsWith/includes can't accidentally allow them
    it('rejects http://localhost.attacker.com (prefix-bypass attempt)', () => {
      expect(() => new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'http://localhost.attacker.com'
      })).toThrow('baseUrl must use https://');
    });

    it('rejects http://127.0.0.1.evil.com (prefix-bypass attempt)', () => {
      expect(() => new Coolhand({
        apiKey: 'test-key',
        silent: true,
        baseUrl: 'http://127.0.0.1.evil.com'
      })).toThrow('baseUrl must use https://');
    });
  });

  describe('deprecated environment option', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      _resetGlobalState();
      warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    describe('Coolhand constructor', () => {
      it("emits only the 'local' sentence when environment: 'local' is passed", () => {
        new Coolhand({ apiKey: 'test-key', silent: true, environment: 'local' });
        const msg = warnSpy.mock.calls[0][0] as string;
        expect(msg).toContain("environment: 'local'");
        expect(msg).not.toContain("environment: 'production'");
      });

      it("emits only the 'production' sentence when environment: 'production' is passed", () => {
        new Coolhand({ apiKey: 'test-key', silent: true, environment: 'production' });
        const msg = warnSpy.mock.calls[0][0] as string;
        expect(msg).toContain("environment: 'production'");
        expect(msg).not.toContain("environment: 'local'");
      });
    });

    describe('initializeGlobalMonitoring', () => {
      it("emits only the 'local' sentence when environment: 'local' is passed", async () => {
        await initializeGlobalMonitoring({ apiKey: 'test-key', silent: true, environment: 'local' });
        const msg = warnSpy.mock.calls[0][0] as string;
        expect(msg).toContain("environment: 'local'");
        expect(msg).not.toContain("environment: 'production'");
      });

      it("emits only the 'production' sentence when environment: 'production' is passed", async () => {
        await initializeGlobalMonitoring({ apiKey: 'test-key', silent: true, environment: 'production' });
        const msg = warnSpy.mock.calls[0][0] as string;
        expect(msg).toContain("environment: 'production'");
        expect(msg).not.toContain("environment: 'local'");
      });
    });
  });

  describe('LoggingService', () => {
    it('builds the correct endpoint from a custom baseUrl', () => {
      const svc = new LoggingService({
        apiKey: 'k',
        silent: true,
        baseUrl: 'https://self-hosted.internal'
      });
      expect(svc.getApiEndpoint()).toBe('https://self-hosted.internal/api/v2/llm_request_logs');
    });

    it('POSTs to the custom baseUrl at the HTTP layer', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 42 })
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;
      try {
        const svc = new LoggingService({
          apiKey: 'k',
          silent: true,
          baseUrl: 'https://self-hosted.example.com'
        });
        await svc.logRequestToAPI(fakeCallData);
        expect(mockFetch).toHaveBeenCalledWith(
          'https://self-hosted.example.com/api/v2/llm_request_logs',
          expect.objectContaining({ method: 'POST' })
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('FeedbackService', () => {
    it('builds the correct endpoint from a custom baseUrl', () => {
      const svc = new FeedbackService({
        apiKey: 'k',
        silent: true,
        baseUrl: 'https://self-hosted.internal'
      });
      expect(svc.getApiEndpoint()).toBe('https://self-hosted.internal/api/v2/llm_request_log_feedbacks');
    });

    it('POSTs to the custom baseUrl at the HTTP layer', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1, like: true })
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;
      try {
        const svc = new FeedbackService({
          apiKey: 'k',
          silent: true,
          baseUrl: 'https://self-hosted.example.com'
        });
        await svc.createFeedback({ like: true });
        expect(mockFetch).toHaveBeenCalledWith(
          'https://self-hosted.example.com/api/v2/llm_request_log_feedbacks',
          expect.objectContaining({ method: 'POST' })
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('COOLHAND_BASE_URL environment variable', () => {
    const envKeys = ['COOLHAND_API_KEY', 'COOLHAND_BASE_URL', 'COOLHAND_SILENT'];
    const envBackup: Record<string, string | undefined> = {};

    beforeEach(() => {
      _resetGlobalState();
      jest.resetModules();
      jest.spyOn(console, 'log').mockImplementation();
      jest.spyOn(console, 'warn').mockImplementation();
      jest.spyOn(console, 'error').mockImplementation();
      for (const k of envKeys) { envBackup[k] = process.env[k]; }

      globalThis.fetch = jest.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: () => ({ text: () => Promise.resolve('{}') }),
      }) as any;
    });

    afterEach(() => {
      jest.restoreAllMocks();
      for (const k of envKeys) {
        if (envBackup[k] === undefined) { delete process.env[k]; }
        else { process.env[k] = envBackup[k]; }
      }
    });

    it('reads COOLHAND_BASE_URL and uses it as the API host', async () => {
      process.env.COOLHAND_API_KEY = 'env-key';
      process.env.COOLHAND_BASE_URL = 'https://self-hosted.example.com';

      await import('../src/auto-monitor');
      await new Promise(r => setTimeout(r, 50));

      const { getGlobalStats } = await import('../src/global-monitor');
      expect(getGlobalStats().apiEndpoint).toBe(
        'https://self-hosted.example.com/api/v2/llm_request_logs'
      );
    });

    it('uses the default host when COOLHAND_BASE_URL is not set', async () => {
      process.env.COOLHAND_API_KEY = 'env-key';
      delete process.env.COOLHAND_BASE_URL;

      await import('../src/auto-monitor');
      await new Promise(r => setTimeout(r, 50));

      const { getGlobalStats } = await import('../src/global-monitor');
      expect(getGlobalStats().apiEndpoint).toBe(
        'https://coolhandlabs.com/api/v2/llm_request_logs'
      );
    });
  });
});
