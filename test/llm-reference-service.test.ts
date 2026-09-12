import { LlmReferenceService, LlmReferenceServiceConfig } from '../src/services/LlmReferenceService';
import { HttpError } from '../src/services/BaseService';
import { LlmReferencedFile, LlmReferenceSession } from '../src/types';

const originalFetch = (global as any).fetch;

// Both methods are GET reads, so they only touch `text()` and `headers`. The list endpoint always
// sends pagination headers, so the default here mirrors a real single-page response rather than an
// empty Headers.
function mockGetFetch(
  bodyObj: any,
  { ok = true, status = 200, headers = {} }: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
): any {
  const text = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  return jest.fn().mockResolvedValue({ ok, status, text: jest.fn().mockResolvedValue(text), headers: new Headers(headers) });
}

function buildFile(overrides: Partial<LlmReferencedFile> = {}): LlmReferencedFile {
  return {
    file_path: 'config/routes.rb',
    reference_count: 3,
    last_referenced_at: '2026-09-10T12:00:00Z',
    ...overrides
  };
}

function buildSession(overrides: Partial<LlmReferenceSession> = {}): LlmReferenceSession {
  return {
    llm_request_log_id: 'kp9npvc8qq2q',
    created_at: '2026-09-10T12:00:00Z',
    ...overrides
  };
}

function newService(overrides: Partial<LlmReferenceServiceConfig> = {}): LlmReferenceService {
  return new LlmReferenceService({ apiKey: 'private-key-123', silent: true, ...overrides });
}

describe('LlmReferenceService', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  describe('Constructor', () => {
    it('targets the llm_references collection on the production endpoint', () => {
      expect(newService().getApiEndpoint()).toBe('https://coolhandlabs.com/api/v2/llm_references');
    });
  });

  describe('searchReferencedFiles', () => {
    it('sends no query params when called with no arguments', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      await newService().searchReferencedFiles();

      expect(capturedUrl).toBe('https://coolhandlabs.com/api/v2/llm_references');
    });

    it('maps camelCase params onto the q[...] ransack query params the endpoint expects', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      await newService().searchReferencedFiles({
        filePathContains: 'routes',
        createdAtGteq: '2026-06-01T00:00:00Z',
        createdAtLteq: '2026-09-01T00:00:00Z',
        page: 2,
        per: 50
      });

      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('q[file_path_cont]')).toBe('routes');
      expect(url.searchParams.get('q[created_at_gteq]')).toBe('2026-06-01T00:00:00Z');
      expect(url.searchParams.get('q[created_at_lteq]')).toBe('2026-09-01T00:00:00Z');
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.get('per')).toBe('50');
    });

    it('omits params that were not supplied rather than sending empty values', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      await newService().searchReferencedFiles({ filePathContains: 'routes' });

      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('q[created_at_gteq]')).toBeNull();
      expect(url.searchParams.get('q[created_at_lteq]')).toBeNull();
      expect(url.searchParams.get('page')).toBeNull();
    });

    it('never sends a client_id param — the client is derived from the API key', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      // Cast because SearchReferencedFilesParams deliberately has no clientId — this asserts the
      // wrapper drops it rather than forwarding an unsupported param a non-TS caller might pass.
      await newService().searchReferencedFiles({ clientId: 'someone-else' } as any);

      expect(new URL(capturedUrl!).searchParams.get('client_id')).toBeNull();
    });

    it('sends the private API key and asks for JSON', async () => {
      let capturedOptions: any;
      (global as any).fetch = jest.fn().mockImplementation(async (_url: string, options: any) => {
        capturedOptions = options;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      await newService().searchReferencedFiles();

      expect(capturedOptions.method).toBe('GET');
      expect(capturedOptions.headers['X-API-Key']).toBe('private-key-123');
      expect(capturedOptions.headers.Accept).toBe('application/json');
    });

    it('returns { files, pagination }, reading pagination off the response headers', async () => {
      const files = [buildFile({ file_path: 'app/models/client.rb', reference_count: 7 })];
      (global as any).fetch = mockGetFetch(files, {
        headers: { 'X-Page': '3', 'X-Per-Page': '1', 'X-Total-Count': '7', 'X-Total-Pages': '7' }
      });

      const result = await newService().searchReferencedFiles({ page: 3, per: 1 });

      expect(result.files).toEqual(files);
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
      (global as any).fetch = mockGetFetch([buildFile()], {
        headers: { 'X-Page': '1', 'X-Per-Page': '1', 'X-Total-Count': '7', 'X-Total-Pages': '7' }
      });

      const { files, pagination } = await newService().searchReferencedFiles({ per: 1 });

      expect(files).toHaveLength(1);
      expect(pagination.total_count).toBe(7);
    });

    it('reports an empty result as a real zero-count page, not a missing one', async () => {
      (global as any).fetch = mockGetFetch([], {
        headers: { 'X-Page': '1', 'X-Per-Page': '25', 'X-Total-Count': '0', 'X-Total-Pages': '1' }
      });

      const { files, pagination } = await newService().searchReferencedFiles();

      expect(files).toEqual([]);
      expect(pagination.total_count).toBe(0);
      expect(pagination.per_page).toBe(25);
      expect(pagination.has_next_page).toBe(false);
      expect(pagination.has_prev_page).toBe(false);
    });

    it('throws an HttpError carrying 401 when the key is missing or is the public key', async () => {
      (global as any).fetch = mockGetFetch({ error: 'API key is required' }, { ok: false, status: 401 });

      await expect(newService().searchReferencedFiles()).rejects.toMatchObject({
        name: 'HttpError',
        status: 401
      });
    });

    it('throws an HttpError carrying 422 for an unrecognized ransack attribute', async () => {
      (global as any).fetch = mockGetFetch(
        { errors: { q: ['Unrecognized filter attribute or predicate'] } },
        { ok: false, status: 422 }
      );

      await expect(newService().searchReferencedFiles()).rejects.toBeInstanceOf(HttpError);
    });

    it('surfaces the aggregate statement timeout as a distinguishable 504, not a generic 5xx', async () => {
      (global as any).fetch = mockGetFetch(
        { errors: { system: ['Timed out aggregating referenced files. Narrow file_path or reduce per, and try again.'] } },
        { ok: false, status: 504 }
      );

      await expect(newService().searchReferencedFiles()).rejects.toMatchObject({ status: 504 });
    });

    it('throws a JSON error rather than returning a half-parsed object on a non-JSON body', async () => {
      (global as any).fetch = mockGetFetch('<html>502 Bad Gateway</html>');

      await expect(newService().searchReferencedFiles()).rejects.toThrow('Referenced file response was not valid JSON');
    });
  });

  describe('listReferencedFileSessions', () => {
    it('hits the sessions collection route with file_path as a query param', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      await newService().listReferencedFileSessions({ filePath: 'config/routes.rb' });

      const url = new URL(capturedUrl!);
      expect(url.pathname).toBe('/api/v2/llm_references/sessions');
      expect(url.searchParams.get('file_path')).toBe('config/routes.rb');
    });

    it('sends page/per when supplied', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue('[]'), headers: new Headers() };
      });

      await newService().listReferencedFileSessions({ filePath: 'config/routes.rb', page: 2, per: 10 });

      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.get('per')).toBe('10');
    });

    it('returns { sessions, pagination }, reading pagination off the response headers', async () => {
      const sessions = [buildSession()];
      (global as any).fetch = mockGetFetch(sessions, {
        headers: { 'X-Page': '1', 'X-Per-Page': '25', 'X-Total-Count': '1', 'X-Total-Pages': '1' }
      });

      const result = await newService().listReferencedFileSessions({ filePath: 'config/routes.rb' });

      expect(result.sessions).toEqual(sessions);
      expect(result.pagination.total_count).toBe(1);
    });

    it('returns an empty page (not an error) for a file_path that matches nothing', async () => {
      (global as any).fetch = mockGetFetch([], {
        headers: { 'X-Page': '1', 'X-Per-Page': '25', 'X-Total-Count': '0', 'X-Total-Pages': '0' }
      });

      const { sessions, pagination } = await newService().listReferencedFileSessions({ filePath: 'no/such/file.rb' });

      expect(sessions).toEqual([]);
      expect(pagination.total_count).toBe(0);
    });

    it('throws an HttpError carrying 422 when file_path is blank', async () => {
      (global as any).fetch = mockGetFetch({ errors: { file_path: ['is required'] } }, { ok: false, status: 422 });

      await expect(newService().listReferencedFileSessions({ filePath: '' })).rejects.toMatchObject({ status: 422 });
    });

    it('surfaces the per-file_path session count timeout as a distinguishable 504, not a generic 5xx', async () => {
      // Unlike searchReferencedFiles there's no GROUP BY aggregate here, but a file_path
      // referenced by very many sessions makes the pagination COUNT(*) just as expensive, and it
      // runs under the same statement-timeout guard server-side — so this can 504 too.
      (global as any).fetch = mockGetFetch(
        { errors: { system: ['Timed out counting sessions for this file_path. Reduce per and try again.'] } },
        { ok: false, status: 504 }
      );

      await expect(newService().listReferencedFileSessions({ filePath: 'config/routes.rb' })).rejects.toMatchObject({
        status: 504
      });
    });

    it('rejects a non-string filePath client-side without issuing a request', async () => {
      // A plain-JS caller bypassing the TypeScript signature (e.g. an omitted filePath, which is
      // `undefined` at runtime) must not fall through to URL.searchParams.set, which would coerce
      // it into the literal query value "undefined" and silently search for that literal path.
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      await expect(newService().listReferencedFileSessions({} as any)).rejects.toThrow(
        'listReferencedFileSessions: filePath must be a string'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws an HttpError carrying 401 when the key is missing or is the public key', async () => {
      (global as any).fetch = mockGetFetch({ error: 'API key is required' }, { ok: false, status: 401 });

      await expect(newService().listReferencedFileSessions({ filePath: 'config/routes.rb' })).rejects.toMatchObject({
        status: 401
      });
    });
  });
});
