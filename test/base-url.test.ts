import { Coolhand } from '../src/index';
import { LoggingService } from '../src/services/LoggingService';
import { FeedbackService } from '../src/services/FeedbackService';

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
  });

  describe('COOLHAND_BASE_URL environment variable', () => {
    const envKeys = ['COOLHAND_API_KEY', 'COOLHAND_BASE_URL', 'COOLHAND_SILENT'];
    const envBackup: Record<string, string | undefined> = {};

    beforeEach(() => {
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
