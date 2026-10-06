import { TemplateService, TemplateServiceConfig } from '../src/services/TemplateService';
import { HttpError } from '../src/services/BaseService';
import { LlmMetrics, LlmRequestTemplateDetail, LlmRequestTemplateSummary } from '../src/types';

const originalFetch = (global as any).fetch;

// searchTemplates/getTemplate are GET reads, so they only touch `text()` and `headers`. The list
// endpoint always sends pagination headers, so the default here mirrors a real single-page
// response rather than an empty Headers.
function mockGetFetch(
  bodyObj: any,
  { ok = true, status = 200, headers = {} }: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
): any {
  const text = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  return jest.fn().mockResolvedValue({ ok, status, text: jest.fn().mockResolvedValue(text), headers: new Headers(headers) });
}

function buildSummary(overrides: Partial<LlmRequestTemplateSummary> = {}): LlmRequestTemplateSummary {
  return {
    id: 'kp9npvc8qq2q',
    name: 'Unmatched',
    status: 'published',
    version: null,
    group: 'other',
    workload_id: '47myqes2q692',
    workload_name: 'Unmatched',
    system_template: true,
    deprecated_at: null,
    log_count: 0,
    created_at: '2026-08-20T02:12:27Z',
    updated_at: '2026-08-20T02:12:27Z',
    ...overrides
  };
}

function buildMetrics(overrides: Partial<LlmMetrics> = {}): LlmMetrics {
  return {
    days_back: null,
    since: '2026-09-01T00:00:00Z',
    until: '2026-10-06T22:49:40Z',
    request_count: 0,
    failure_count: 0,
    error_rate: null,
    error_rate_change: null,
    avg_cost_per_request: null,
    total_cost: null,
    priced_request_count: 0,
    long_context_request_count: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    avg_input_tokens: null,
    avg_output_tokens: null,
    avg_latency_ms: null,
    correctness_score: null,
    sentiment_score: null,
    revision_score: null,
    first_request_at: null,
    last_request_at: null,
    ...overrides
  };
}

function newService(overrides: Partial<TemplateServiceConfig> = {}): TemplateService {
  return new TemplateService({ apiKey: 'private-key-123', silent: true, ...overrides });
}

describe('TemplateService', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  describe('Constructor', () => {
    it('targets the templates collection on the production endpoint', () => {
      expect(newService().getApiEndpoint()).toBe('https://coolhandlabs.com/api/v2/llm_request_templates');
    });
  });

  describe('searchTemplates', () => {
    it('sends no query params when called with no arguments', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      await newService().searchTemplates();

      expect(capturedUrl).toBe('https://coolhandlabs.com/api/v2/llm_request_templates');
    });

    it('maps camelCase params onto the snake_case query params the endpoint expects', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      await newService().searchTemplates({
        search: 'summar',
        workloadId: '47myqes2q692',
        status: 'draft',
        includeDeprecated: true,
        includeSystem: true,
        page: 2,
        per: 50
      });

      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('search')).toBe('summar');
      expect(url.searchParams.get('workload_id')).toBe('47myqes2q692');
      expect(url.searchParams.get('status')).toBe('draft');
      expect(url.searchParams.get('include_deprecated')).toBe('true');
      expect(url.searchParams.get('include_system')).toBe('true');
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.get('per')).toBe('50');
    });

    it('sends the metrics window params, serialising Date bounds as ISO8601 UTC', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      await newService().searchTemplates({
        includeMetrics: true,
        daysBack: 14,
        since: new Date('2026-09-01T00:00:00Z'),
        until: '2026-09-15T00:00:00+02:00'
      });

      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('include_metrics')).toBe('true');
      expect(url.searchParams.get('days_back')).toBe('14');
      expect(url.searchParams.get('since')).toBe('2026-09-01T00:00:00.000Z');
      expect(url.searchParams.get('until')).toBe('2026-09-15T00:00:00+02:00');
      expect(url.search).toContain('until=2026-09-15T00%3A00%3A00%2B02%3A00');
    });

    it('throws before issuing a request for an invalid Date bound', async () => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      await expect(newService().searchTemplates({ since: new Date('nope') })).rejects.toThrow(
        'since must be a valid Date or an ISO8601 string'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns the metrics object on a row, with the new counters and a null days_back', async () => {
      const metrics = buildMetrics({ request_count: 3 });
      (global as any).fetch = mockGetFetch([buildSummary({ metrics })]);

      const { templates } = await newService().searchTemplates({ includeMetrics: true, since: '2026-09-01' });

      expect(templates[0].metrics).toEqual(metrics);
    });

    it('throws an HttpError carrying 422 for a malformed metrics window', async () => {
      (global as any).fetch = mockGetFetch({ errors: { since: ['must be an ISO8601 timestamp'] } }, { ok: false, status: 422 });

      await expect(newService().searchTemplates({ includeMetrics: true, since: 'bad' })).rejects.toMatchObject({
        status: 422
      });
    });

    it('omits params that were not supplied rather than sending empty values', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      await newService().searchTemplates({ search: 'summar' });

      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('status')).toBeNull();
      expect(url.searchParams.get('include_system')).toBeNull();
      expect(url.searchParams.get('page')).toBeNull();
    });

    it('never sends a client_id param — the client is derived from the API key', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      // Cast because SearchTemplatesParams deliberately has no clientId — this asserts the wrapper
      // drops it rather than forwarding an unsupported param a non-TS caller might pass.
      await newService().searchTemplates({ clientId: 'someone-else' } as any);

      expect(new URL(capturedUrl!).searchParams.get('client_id')).toBeNull();
    });

    it('sends the private API key and asks for JSON', async () => {
      let capturedOptions: any;
      (global as any).fetch = jest.fn().mockImplementation(async (_url: string, options: any) => {
        capturedOptions = options;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      await newService().searchTemplates();

      expect(capturedOptions.method).toBe('GET');
      expect(capturedOptions.headers['X-API-Key']).toBe('private-key-123');
      expect(capturedOptions.headers.Accept).toBe('application/json');
    });

    it('returns { templates, pagination }, reading pagination off the response headers', async () => {
      const templates = [buildSummary({ id: 'aaa', name: 'Summarize' })];
      (global as any).fetch = mockGetFetch(templates, {
        headers: { 'X-Page': '3', 'X-Per-Page': '1', 'X-Total-Count': '7', 'X-Total-Pages': '7' }
      });

      const result = await newService().searchTemplates({ page: 3, per: 1 });

      expect(result.templates).toEqual(templates);
      expect(result.pagination).toEqual({
        current_page: 3,
        per_page: 1,
        total_count: 7,
        total_pages: 7,
        has_next_page: true,
        has_prev_page: true
      });
    });

    it('reports the header total, not the returned array length', async () => {
      // One row on the wire, seven in the collection — proves pagination is header-sourced.
      (global as any).fetch = mockGetFetch([buildSummary()], {
        headers: { 'X-Page': '1', 'X-Per-Page': '1', 'X-Total-Count': '7', 'X-Total-Pages': '7' }
      });

      const { templates, pagination } = await newService().searchTemplates({ per: 1 });

      expect(templates).toHaveLength(1);
      expect(pagination.total_count).toBe(7);
    });

    it('reports an empty default list as a real zero-count page, not a missing one', async () => {
      // The live shape for a client whose only templates are the hidden system buckets: an empty
      // array with X-Total-Count: 0 still present.
      (global as any).fetch = mockGetFetch([], {
        headers: { 'X-Page': '1', 'X-Per-Page': '25', 'X-Total-Count': '0', 'X-Total-Pages': '1' }
      });

      const { templates, pagination } = await newService().searchTemplates();

      expect(templates).toEqual([]);
      expect(pagination.total_count).toBe(0);
      expect(pagination.per_page).toBe(25);
      expect(pagination.has_next_page).toBe(false);
      expect(pagination.has_prev_page).toBe(false);
    });

    it('throws an HttpError carrying 401 when the key is missing or is the public key', async () => {
      (global as any).fetch = mockGetFetch({ error: 'API key is required' }, { ok: false, status: 401 });

      await expect(newService().searchTemplates()).rejects.toMatchObject({
        name: 'HttpError',
        status: 401
      });
    });

    it('throws an HttpError carrying 422 for an unrecognized status filter', async () => {
      (global as any).fetch = mockGetFetch(
        { errors: { status: ['must be one of: draft, published, failure'] } },
        { ok: false, status: 422 }
      );

      await expect(newService().searchTemplates({ status: 'draft' })).rejects.toBeInstanceOf(HttpError);
    });

    it('surfaces the log_count statement timeout as a distinguishable 504, not a generic 5xx', async () => {
      (global as any).fetch = mockGetFetch(
        { errors: { system: ['Query timed out'] } },
        { ok: false, status: 504 }
      );

      // A caller narrowing the query and retrying needs to tell 504 apart from a 500 without
      // string-matching the message, which is the whole reason HttpError carries `status`.
      await expect(newService().searchTemplates()).rejects.toMatchObject({ status: 504 });
    });
  });

  describe('getTemplate', () => {
    it('fetches the single-template route and returns both prompt patterns', async () => {
      const detail: LlmRequestTemplateDetail = {
        ...buildSummary({ id: 'aaa', name: 'Summarize', system_template: false }),
        user_prompt_pattern: '^Summarize: (.+)$',
        system_prompt_pattern: null
      };
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify(detail)), headers: new Headers() };
      });

      const result = await newService().getTemplate('aaa');

      expect(capturedUrl).toBe('https://coolhandlabs.com/api/v2/llm_request_templates/aaa');
      expect(result.user_prompt_pattern).toBe('^Summarize: (.+)$');
      expect(result.system_prompt_pattern).toBeNull();
    });

    it('sends no query string when no options are given', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('{}'), headers: new Headers() };
      });

      await newService().getTemplate('aaa');

      expect(new URL(capturedUrl!).search).toBe('');
    });

    it('sends the metrics window options on the single-template route', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('{}'), headers: new Headers() };
      });

      await newService().getTemplate('aaa', {
        includeMetrics: false,
        daysBack: 30,
        since: new Date('2026-09-01T00:00:00Z'),
        until: new Date('2026-09-08T00:00:00Z')
      });

      const url = new URL(capturedUrl!);
      expect(url.pathname).toBe('/api/v2/llm_request_templates/aaa');
      expect(url.searchParams.get('include_metrics')).toBe('false');
      expect(url.searchParams.get('days_back')).toBe('30');
      expect(url.searchParams.get('since')).toBe('2026-09-01T00:00:00.000Z');
      expect(url.searchParams.get('until')).toBe('2026-09-08T00:00:00.000Z');
    });

    it('throws before issuing a request for an invalid Date bound', async () => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      await expect(newService().getTemplate('aaa', { since: new Date('nope') })).rejects.toThrow(
        'since must be a valid Date or an ISO8601 string'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('percent-encodes the id instead of letting it alter the path', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('{}'), headers: new Headers() };
      });

      await newService().getTemplate('a/b');

      expect(capturedUrl).toBe('https://coolhandlabs.com/api/v2/llm_request_templates/a%2Fb');
    });

    it.each([['', 'blank'], ['   ', 'whitespace-only'], ['.', 'a dot-segment'], ['..', 'a parent dot-segment']])(
      'rejects %p (%s) without issuing a request, so it cannot resolve away to the list route',
      async (id) => {
        const fetchMock = jest.fn();
        (global as any).fetch = fetchMock;

        await expect(newService().getTemplate(id)).rejects.toThrow('getTemplate: id must be a non-empty string');
        expect(fetchMock).not.toHaveBeenCalled();
      }
    );

    it('throws an HttpError carrying 404 for a template belonging to another client', async () => {
      (global as any).fetch = mockGetFetch(
        { errors: { llmrequesttemplate: ["Couldn't find LlmRequestTemplate with id = zzz"] } },
        { ok: false, status: 404 }
      );

      // 404 rather than 403 is deliberate server-side: a foreign template's existence is not
      // disclosed. The wrapper must not translate it into anything else.
      await expect(newService().getTemplate('zzz')).rejects.toMatchObject({ status: 404 });
    });

    it('surfaces the log_count statement timeout as a distinguishable 504', async () => {
      (global as any).fetch = mockGetFetch({ errors: { system: ['Query timed out'] } }, { ok: false, status: 504 });

      await expect(newService().getTemplate('kp9npvc8qq2q')).rejects.toMatchObject({ status: 504 });
    });

    it('throws a JSON error rather than returning a half-parsed object on a non-JSON body', async () => {
      (global as any).fetch = mockGetFetch('<html>502 Bad Gateway</html>');

      await expect(newService().getTemplate('aaa')).rejects.toThrow('Template response was not valid JSON');
    });
  });
});
