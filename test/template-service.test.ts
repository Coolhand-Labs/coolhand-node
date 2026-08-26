import { TemplateService, TemplateServiceConfig } from '../src/services/TemplateService';
import { HttpError } from '../src/services/BaseService';
import { LlmRequestTemplateDetail, LlmRequestTemplateSummary } from '../src/types';

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
