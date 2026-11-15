import { SavingsService, SavingsServiceConfig } from '../src/services/SavingsService';
import { RealizedSavings } from '../src/types';

const originalFetch = (global as any).fetch;

function mockFetch(
  bodyObj: any,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}
): any {
  const text = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  return jest.fn().mockResolvedValue({ ok, status, text: jest.fn().mockResolvedValue(text), headers: new Headers() });
}

function buildSavings(overrides: Partial<RealizedSavings> = {}): RealizedSavings {
  return {
    total: 4.5372,
    cost_at_previous_versions: 5.6912,
    percent: 79.7,
    workloads: [
      {
        id: 'xwjm0lgsdmy4',
        name: 'Help Center Article Suggester',
        savings: 2.0437,
        cost_at_previous_versions: 3.0402,
        active_requests: 182
      }
    ],
    ...overrides
  };
}

function newService(overrides: Partial<SavingsServiceConfig> = {}): SavingsService {
  return new SavingsService({ apiKey: 'private-key-123', silent: true, ...overrides });
}

describe('SavingsService', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  it('targets the savings singleton on the production endpoint', () => {
    expect(newService().getApiEndpoint()).toBe('https://coolhandlabs.com/api/v2/savings');
  });

  describe('getRealizedSavings', () => {
    it('GETs the endpoint with no query string, the private key and an Accept header', async () => {
      const fetchMock = mockFetch(buildSavings());
      (global as any).fetch = fetchMock;

      await newService().getRealizedSavings();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://coolhandlabs.com/api/v2/savings');
      expect(init.method).toBe('GET');
      expect(init.redirect).toBe('error');
      expect(init.headers['X-API-Key']).toBe('private-key-123');
      expect(init.headers.Accept).toBe('application/json');
    });

    it('returns the body untouched, with money as numbers and the workload id as a string', async () => {
      const savings = buildSavings();
      (global as any).fetch = mockFetch(savings);

      const result = await newService().getRealizedSavings();

      expect(result).toEqual(savings);
      expect(typeof result.total).toBe('number');
      expect(typeof result.workloads[0].id).toBe('string');
    });

    it('returns zeros and an empty workloads array as real zero savings', async () => {
      const zero = { total: 0, cost_at_previous_versions: 0, percent: 0, workloads: [] };
      (global as any).fetch = mockFetch(zero);

      await expect(newService().getRealizedSavings()).resolves.toEqual(zero);
    });

    it('throws an HttpError carrying 503, never zeros, when the comparison could not be computed', async () => {
      (global as any).fetch = mockFetch(
        { errors: { system: ['Realized savings could not be computed right now. Please retry.'] } },
        { ok: false, status: 503 }
      );

      await expect(newService().getRealizedSavings()).rejects.toMatchObject({
        name: 'HttpError',
        status: 503,
        message: expect.stringContaining('could not be computed')
      });
    });

    it('throws an HttpError carrying 401 for a missing or public key', async () => {
      (global as any).fetch = mockFetch({ error: 'Invalid API key' }, { ok: false, status: 401 });

      await expect(newService().getRealizedSavings()).rejects.toMatchObject({ name: 'HttpError', status: 401 });
    });

    it('masks the API key if a proxy echoes it back in an error body', async () => {
      (global as any).fetch = mockFetch('bad key private-key-123', { ok: false, status: 401 });

      const error = await newService().getRealizedSavings().then(
        () => new Error('expected a rejection'),
        (e: unknown) => e as Error
      );

      expect(error.message).not.toContain('private-key-123');
      expect(error.message).toContain('[redacted]');
    });

    it('throws on a non-JSON body rather than returning a half-parsed object', async () => {
      (global as any).fetch = mockFetch('<html>502 Bad Gateway</html>');

      await expect(newService().getRealizedSavings()).rejects.toThrow('Savings response was not valid JSON');
    });

    it('is a read, so a dry run still issues the request', async () => {
      const fetchMock = mockFetch(buildSavings());
      (global as any).fetch = fetchMock;

      await newService({ dryRun: true }).getRealizedSavings();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
