import { WorkloadService, WorkloadServiceConfig } from '../src/services/WorkloadService';
import { LlmMetrics, WorkloadSummary } from '../src/types';

const originalFetch = (global as any).fetch;

function mockGetFetch(
  bodyObj: any,
  { ok = true, status = 200, headers = {} }: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
): any {
  const text = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  return jest.fn().mockResolvedValue({ ok, status, text: jest.fn().mockResolvedValue(text), headers: new Headers(headers) });
}

function captureUrl(): { url: () => URL } {
  let captured: string | undefined;
  (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
    captured = url;
    return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
  });
  return { url: () => new URL(captured!) };
}

function buildWorkload(overrides: Partial<WorkloadSummary> = {}): WorkloadSummary {
  return {
    id: 'j35494sql6yd',
    name: 'Agent Engineering',
    description: null,
    archived: false,
    system: false,
    merged: false,
    template_count: 2,
    draft_template_count: 1,
    log_count: 160,
    last_activity: '2026-08-25T20:03:47Z',
    ...overrides
  };
}

function newService(overrides: Partial<WorkloadServiceConfig> = {}): WorkloadService {
  return new WorkloadService({ apiKey: 'private-key-123', silent: true, ...overrides });
}

describe('WorkloadService', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  it('targets the workloads collection on the production endpoint', () => {
    expect(newService().getApiEndpoint()).toBe('https://coolhandlabs.com/api/v2/workloads');
  });

  describe('searchWorkloads', () => {
    it('sends no query params when called with no arguments', async () => {
      const seen = captureUrl();

      await newService().searchWorkloads();

      expect(seen.url().toString()).toBe('https://coolhandlabs.com/api/v2/workloads');
    });

    it('maps camelCase params onto the snake_case query params the endpoint expects', async () => {
      const seen = captureUrl();

      await newService().searchWorkloads({
        search: 'agent',
        includeArchived: true,
        includeSystem: false,
        includeTemplates: true,
        includeMetrics: true,
        daysBack: 7,
        page: 2,
        per: 50
      });

      const params = seen.url().searchParams;
      expect(params.get('search')).toBe('agent');
      expect(params.get('include_archived')).toBe('true');
      expect(params.get('include_system')).toBe('false');
      expect(params.get('include_templates')).toBe('true');
      expect(params.get('include_metrics')).toBe('true');
      expect(params.get('days_back')).toBe('7');
      expect(params.get('page')).toBe('2');
      expect(params.get('per')).toBe('50');
    });

    it('serialises Date bounds as ISO8601 UTC', async () => {
      const seen = captureUrl();

      await newService().searchWorkloads({
        includeMetrics: true,
        since: new Date('2026-09-01T00:00:00Z'),
        until: new Date('2026-10-01T12:30:00Z')
      });

      expect(seen.url().searchParams.get('since')).toBe('2026-09-01T00:00:00.000Z');
      expect(seen.url().searchParams.get('until')).toBe('2026-10-01T12:30:00.000Z');
    });

    it('percent-encodes a "+" UTC offset in a string bound so the server does not read it as a space', async () => {
      const seen = captureUrl();

      await newService().searchWorkloads({ since: '2026-09-01T00:00:00+02:00' });

      expect(seen.url().search).toContain('since=2026-09-01T00%3A00%3A00%2B02%3A00');
      expect(seen.url().searchParams.get('since')).toBe('2026-09-01T00:00:00+02:00');
    });

    it('passes a malformed string bound through for the server to reject', async () => {
      const seen = captureUrl();

      await newService().searchWorkloads({ includeMetrics: true, since: 'bad' });

      expect(seen.url().searchParams.get('since')).toBe('bad');
    });

    it('throws before issuing a request for an invalid Date', async () => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      await expect(newService().searchWorkloads({ since: new Date('nope') })).rejects.toThrow(
        'since must be a valid Date or an ISO8601 string'
      );
      await expect(newService().searchWorkloads({ until: new Date('nope') })).rejects.toThrow(
        'until must be a valid Date or an ISO8601 string'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never sends a client_id param — the client is derived from the API key', async () => {
      const seen = captureUrl();

      await newService().searchWorkloads({ clientId: 'someone-else' } as any);

      expect(seen.url().searchParams.get('client_id')).toBeNull();
    });

    it('sends the private API key and asks for JSON', async () => {
      let capturedOptions: any;
      (global as any).fetch = jest.fn().mockImplementation(async (_url: string, options: any) => {
        capturedOptions = options;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      await newService().searchWorkloads();

      expect(capturedOptions.method).toBe('GET');
      expect(capturedOptions.headers['X-API-Key']).toBe('private-key-123');
      expect(capturedOptions.headers.Accept).toBe('application/json');
    });

    it('returns { workloads, pagination }, exposing the hashid id as-is and reading pagination off the headers', async () => {
      const workloads = [buildWorkload()];
      (global as any).fetch = mockGetFetch(workloads, {
        headers: { 'X-Page': '3', 'X-Per-Page': '1', 'X-Total-Count': '7', 'X-Total-Pages': '7' }
      });

      const result = await newService().searchWorkloads({ page: 3, per: 1 });

      expect(result.workloads).toEqual(workloads);
      expect(typeof result.workloads[0].id).toBe('string');
      expect(result.pagination).toEqual({
        current_page: 3,
        per_page: 1,
        total_count: 7,
        total_pages: 7,
        has_next_page: true,
        has_prev_page: true
      });
    });

    it('passes the metrics object through untouched, including null days_back and the new counters', async () => {
      const metrics: LlmMetrics = {
        days_back: null,
        since: '2026-09-01T00:00:00Z',
        until: '2026-10-06T22:49:40Z',
        request_count: 10,
        failure_count: 2,
        error_rate: 20,
        error_rate_change: null,
        avg_cost_per_request: 0.01,
        total_cost: 0.08,
        priced_request_count: 8,
        long_context_request_count: 1,
        total_input_tokens: 1000,
        total_output_tokens: 400,
        avg_input_tokens: 125,
        avg_output_tokens: 50,
        avg_latency_ms: 812.5,
        correctness_score: null,
        sentiment_score: null,
        revision_score: null,
        first_request_at: '2026-07-08T19:00:36Z',
        last_request_at: '2026-08-25T20:03:47Z'
      };
      (global as any).fetch = mockGetFetch([buildWorkload({ metrics })]);

      const { workloads } = await newService().searchWorkloads({ includeMetrics: true });

      expect(workloads[0].metrics).toEqual(metrics);
      expect(workloads[0].metrics?.days_back).toBeNull();
    });

    it('throws an HttpError carrying 401 for a missing or public key', async () => {
      (global as any).fetch = mockGetFetch({ error: 'API key is required' }, { ok: false, status: 401 });

      await expect(newService().searchWorkloads()).rejects.toMatchObject({ name: 'HttpError', status: 401 });
    });

    it('throws an HttpError carrying 422 and the errors body for a bad window', async () => {
      (global as any).fetch = mockGetFetch(
        { errors: { since: ['must be an ISO8601 timestamp'] } },
        { ok: false, status: 422 }
      );

      await expect(newService().searchWorkloads({ since: 'bad' })).rejects.toMatchObject({
        status: 422,
        message: expect.stringContaining('"since"')
      });
    });

    it('surfaces the statement timeout as a distinguishable 504', async () => {
      (global as any).fetch = mockGetFetch({ errors: { system: ['Query timed out'] } }, { ok: false, status: 504 });

      await expect(newService().searchWorkloads({ includeMetrics: true })).rejects.toMatchObject({ status: 504 });
    });

    it('throws on a non-JSON body rather than returning a half-parsed object', async () => {
      (global as any).fetch = mockGetFetch('<html>502 Bad Gateway</html>');

      await expect(newService().searchWorkloads()).rejects.toThrow('Workload response was not valid JSON');
    });
  });
});
