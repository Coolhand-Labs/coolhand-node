import { StepTemplateService, StepTemplateServiceConfig } from '../src/services/StepTemplateService';
import { StepTemplate, StepTemplateEfficiencyCohort, StepTemplateMetrics } from '../src/types';

const originalFetch = (global as any).fetch;

function mockGetFetch(
  bodyObj: any,
  { ok = true, status = 200, headers = {} }: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
): any {
  const text = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  return jest.fn().mockResolvedValue({ ok, status, text: jest.fn().mockResolvedValue(text), headers: new Headers(headers) });
}

function captureUrlFetch(body: unknown = []): { fetch: any; url: () => URL } {
  let captured: string | undefined;
  const fetch = jest.fn().mockImplementation(async (url: string) => {
    captured = url;
    return { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify(body)), headers: new Headers() };
  });
  return { fetch, url: () => new URL(captured!) };
}

function buildStepTemplate(overrides: Partial<StepTemplate> = {}): StepTemplate {
  return {
    id: 14,
    name: '/review',
    step_type: 'prompt_step',
    status: 'published',
    user_turn_pattern: '^/review',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    sessions_count: 2,
    occurrences_count: 3,
    last_seen_at: null,
    ...overrides
  };
}

function buildCohort(overrides: Partial<StepTemplateEfficiencyCohort> = {}): StepTemplateEfficiencyCohort {
  return {
    runs: 2,
    avg_turns_after: 1.5,
    avg_tool_calls: 4,
    avg_requests: 6,
    token_runs: 0,
    tokens_available: false,
    median_tokens: null,
    p90_tokens: null,
    tokens_per_tool_call: null,
    ...overrides
  };
}

function buildMetrics(overrides: Partial<StepTemplateMetrics> = {}): StepTemplateMetrics {
  return {
    total_runs: 2,
    tool_stats: [{ name: 'Read', pct_of_runs: 100, avg_per_run: 2.5 }],
    turn_stats: { avg: 2, median: 2, high: 3, single_turn_pct: null },
    efficiency: { interactive: null, automated: null, all: buildCohort(), unavailable_runs: 1 },
    notes: ['Token figures are unavailable.'],
    ...overrides
  };
}

function newService(overrides: Partial<StepTemplateServiceConfig> = {}): StepTemplateService {
  return new StepTemplateService({ apiKey: 'private-key-123', silent: true, ...overrides });
}

describe('StepTemplateService', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  it('targets the step templates collection on the production endpoint', () => {
    expect(newService().getApiEndpoint()).toBe('https://coolhandlabs.com/api/v2/step_templates');
  });

  describe('listStepTemplates', () => {
    it('sends no query params when called with no arguments', async () => {
      const { fetch, url } = captureUrlFetch();
      (global as any).fetch = fetch;

      await newService().listStepTemplates();

      expect(url().toString()).toBe('https://coolhandlabs.com/api/v2/step_templates');
    });

    it('maps camelCase params onto the snake_case query params the endpoint expects', async () => {
      const { fetch, url } = captureUrlFetch();
      (global as any).fetch = fetch;

      await newService().listStepTemplates({
        search: 'review',
        stepType: 'tool_step',
        includeMetrics: true,
        page: 2,
        per: 10
      });

      expect(url().searchParams.get('search')).toBe('review');
      expect(url().searchParams.get('step_type')).toBe('tool_step');
      expect(url().searchParams.get('include_metrics')).toBe('true');
      expect(url().searchParams.get('page')).toBe('2');
      expect(url().searchParams.get('per')).toBe('10');
    });

    it('sends includeMetrics: false rather than dropping it', async () => {
      const { fetch, url } = captureUrlFetch();
      (global as any).fetch = fetch;

      await newService().listStepTemplates({ includeMetrics: false });

      expect(url().searchParams.get('include_metrics')).toBe('false');
    });

    it('returns the bare array as stepTemplates with pagination read from the response headers', async () => {
      const rows = [buildStepTemplate(), buildStepTemplate({ id: 13, name: 'Bash', step_type: 'tool_step' })];
      (global as any).fetch = mockGetFetch(rows, {
        headers: { 'X-Page': '2', 'X-Per-Page': '2', 'X-Total-Count': '5', 'X-Total-Pages': '3' }
      });

      const result = await newService().listStepTemplates({ page: 2, per: 2 });

      expect(result.stepTemplates).toEqual(rows);
      expect(result.pagination).toEqual({
        current_page: 2,
        per_page: 2,
        total_count: 5,
        total_pages: 3,
        has_next_page: true,
        has_prev_page: true
      });
    });

    it('reports the per_page the server applied when it caps includeMetrics at 25', async () => {
      (global as any).fetch = mockGetFetch([], {
        headers: { 'X-Page': '1', 'X-Per-Page': '25', 'X-Total-Count': '0', 'X-Total-Pages': '0' }
      });

      const { pagination } = await newService().listStepTemplates({ includeMetrics: true, per: 100 });

      expect(pagination.per_page).toBe(25);
    });

    it('returns the nullable metrics shape unchanged', async () => {
      const metrics = buildMetrics({ tool_stats: null, turn_stats: null, efficiency: null });
      (global as any).fetch = mockGetFetch([buildStepTemplate({ metrics })]);

      const { stepTemplates } = await newService().listStepTemplates({ includeMetrics: true });

      expect(stepTemplates[0].metrics).toEqual(metrics);
    });

    it('sends the private API key and asks for JSON', async () => {
      const fetchMock = mockGetFetch([]);
      (global as any).fetch = fetchMock;

      await newService().listStepTemplates();

      const options = fetchMock.mock.calls[0][1];
      expect(options.method).toBe('GET');
      expect(options.headers['X-API-Key']).toBe('private-key-123');
      expect(options.headers.Accept).toBe('application/json');
    });

    it.each([401, 422, 504])('throws an HttpError carrying %i', async (status) => {
      (global as any).fetch = mockGetFetch({ errors: { base: ['nope'] } }, { ok: false, status });

      await expect(newService().listStepTemplates()).rejects.toMatchObject({ status, name: 'HttpError' });
    });

    it('throws when the body is not valid JSON', async () => {
      (global as any).fetch = mockGetFetch('<html>');

      await expect(newService().listStepTemplates()).rejects.toThrow('Step template response was not valid JSON');
    });
  });

  describe('getStepTemplate', () => {
    it('GETs the step template by integer id with no query params by default', async () => {
      const { fetch, url } = captureUrlFetch(buildStepTemplate());
      (global as any).fetch = fetch;

      const result = await newService().getStepTemplate(14);

      expect(url().toString()).toBe('https://coolhandlabs.com/api/v2/step_templates/14');
      expect(result).toEqual(buildStepTemplate());
    });

    it('sends include_metrics=false when metrics are opted out', async () => {
      const { fetch, url } = captureUrlFetch(buildStepTemplate());
      (global as any).fetch = fetch;

      await newService().getStepTemplate(14, { includeMetrics: false });

      expect(url().searchParams.get('include_metrics')).toBe('false');
    });

    it('returns metrics when the server includes them', async () => {
      const metrics = buildMetrics();
      (global as any).fetch = mockGetFetch(buildStepTemplate({ metrics }));

      const result = await newService().getStepTemplate(14);

      expect(result.metrics).toEqual(metrics);
    });

    it.each([0, -1, 1.5, NaN, Infinity])('rejects id %p before issuing a request', async (id) => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      await expect(newService().getStepTemplate(id)).rejects.toThrow('getStepTemplate: id must be a positive integer');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a non-number id from a loosely typed caller', async () => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      await expect(newService().getStepTemplate('14' as any)).rejects.toThrow('id must be a positive integer');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([401, 404, 504])('throws an HttpError carrying %i', async (status) => {
      (global as any).fetch = mockGetFetch({ errors: { base: ['nope'] } }, { ok: false, status });

      await expect(newService().getStepTemplate(14)).rejects.toMatchObject({ status, name: 'HttpError' });
    });
  });
});
