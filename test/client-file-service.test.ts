import { ClientFileService, ClientFileServiceConfig } from '../src/services/ClientFileService';
import { HttpError } from '../src/services/BaseService';
import { CoolhandClientFileResponse } from '../src/types';

const originalFetch = (global as any).fetch;

function createMockFetch(mockResponse: any, status: number = 200, ok: boolean = true): any {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: jest.fn().mockResolvedValue(mockResponse),
    text: jest.fn().mockResolvedValue(JSON.stringify(mockResponse))
  });
}

function buildResponse(overrides: Partial<CoolhandClientFileResponse> = {}): CoolhandClientFileResponse {
  return {
    id: 'cf_123',
    name: 'deck.pdf',
    file_type: 'slide_deck',
    status: 'draft',
    description: null,
    metadata: {},
    created_at: '2026-08-20T00:00:00Z',
    ...overrides
  };
}

describe('ClientFileService', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  describe('Constructor validation and initialization', () => {
    it('should configure with production endpoint', () => {
      const config: ClientFileServiceConfig = { apiKey: 'test-api-key', silent: true };
      const service = new ClientFileService(config);

      expect(service.getApiEndpoint()).toBe('https://coolhandlabs.com/api/v2/client_files');
    });
  });

  describe('createClientFile', () => {
    it('should successfully upload a file', async () => {
      const mockResponse = buildResponse();
      (global as any).fetch = createMockFetch(mockResponse);

      const service = new ClientFileService({ apiKey: 'test-api-key', silent: true });
      const result = await service.createClientFile({
        name: 'deck.pdf',
        file_type: 'slide_deck',
        file: Buffer.from('pdf-bytes'),
        filename: 'deck.pdf'
      });

      expect(result).toEqual(mockResponse);
    });

    it.each(['a][b', 'a[b', 'a]', '', 'bad\nkey'])('rejects metadata key %j instead of injecting a multipart field name', async (key) => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      const service = new ClientFileService({ apiKey: 'secret-key', silent: true });

      await expect(service.createClientFile({
        name: 'deck.pdf',
        file: Buffer.from('pdf-bytes'),
        filename: 'deck.pdf',
        metadata: { [key]: 'v' }
      })).rejects.toThrow(/Invalid client file metadata key/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips metadata values that cannot be serialized rather than sending "undefined"', async () => {
      let capturedBody: FormData | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (_url: string, options: any) => {
        capturedBody = options.body;
        return { ok: true, status: 201, json: jest.fn().mockResolvedValue(buildResponse()), text: jest.fn().mockResolvedValue('') };
      });

      const service = new ClientFileService({ apiKey: 'secret-key', silent: true });
      await service.createClientFile({
        name: 'deck.pdf',
        file: Buffer.from('pdf-bytes'),
        filename: 'deck.pdf',
        metadata: { keep: 'yes', gone: undefined as unknown as string }
      });

      expect(capturedBody!.get('client_file[metadata][keep]')).toBe('yes');
      expect(capturedBody!.has('client_file[metadata][gone]')).toBe(false);
    });

    it('should structure the multipart form data correctly, including flattened metadata', async () => {
      let capturedBody: FormData | undefined;
      let capturedHeaders: any;

      (global as any).fetch = jest.fn().mockImplementation(async (_url: string, options: any) => {
        capturedBody = options.body;
        capturedHeaders = options.headers;
        return {
          ok: true,
          status: 201,
          json: jest.fn().mockResolvedValue(buildResponse()),
          text: jest.fn().mockResolvedValue('')
        };
      });

      const service = new ClientFileService({ apiKey: 'secret-key', silent: true });
      await service.createClientFile({
        name: 'deck.pdf',
        file_type: 'slide_deck',
        description: 'Q3 review',
        file: Buffer.from('pdf-bytes'),
        filename: 'deck.pdf',
        metadata: { project_path: '/Users/me/my-project', client: 'acme' }
      });

      expect(capturedBody!.get('client_file[name]')).toBe('deck.pdf');
      expect(capturedBody!.get('client_file[file_type]')).toBe('slide_deck');
      expect(capturedBody!.get('client_file[description]')).toBe('Q3 review');
      expect(capturedBody!.get('client_file[metadata][project_path]')).toBe('/Users/me/my-project');
      expect(capturedBody!.get('client_file[metadata][client]')).toBe('acme');

      const filePart = capturedBody!.get('client_file[file]') as unknown as File;
      expect(filePart.name).toBe('deck.pdf');

      expect(capturedHeaders['X-API-Key']).toBe('secret-key');
      expect(capturedHeaders['Content-Type']).toBeUndefined();
    });

    it('should JSON-stringify non-string metadata values instead of mangling them', async () => {
      let capturedBody: FormData | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (_url: string, options: any) => {
        capturedBody = options.body;
        return {
          ok: true,
          status: 201,
          json: jest.fn().mockResolvedValue(buildResponse()),
          text: jest.fn().mockResolvedValue('')
        };
      });

      const service = new ClientFileService({ apiKey: 'test-api-key', silent: true });
      await service.createClientFile({
        name: 'deck.pdf',
        file: Buffer.from('pdf-bytes'),
        filename: 'deck.pdf',
        metadata: { count: 3, active: true, tags: ['a', 'b'], nested: { a: 1 } }
      });

      expect(capturedBody!.get('client_file[metadata][count]')).toBe('3');
      expect(capturedBody!.get('client_file[metadata][active]')).toBe('true');
      expect(capturedBody!.get('client_file[metadata][tags]')).toBe('["a","b"]');
      expect(capturedBody!.get('client_file[metadata][nested]')).toBe('{"a":1}');
    });

    it('should omit optional fields when not provided', async () => {
      let capturedBody: FormData | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (_url: string, options: any) => {
        capturedBody = options.body;
        return {
          ok: true,
          status: 201,
          json: jest.fn().mockResolvedValue(buildResponse()),
          text: jest.fn().mockResolvedValue('')
        };
      });

      const service = new ClientFileService({ apiKey: 'test-api-key', silent: true });
      await service.createClientFile({
        name: 'notes.txt',
        file: Buffer.from('plain text'),
        filename: 'notes.txt'
      });

      expect(capturedBody!.get('client_file[file_type]')).toBeNull();
      expect(capturedBody!.get('client_file[description]')).toBeNull();
      expect(capturedBody!.get('client_file[metadata][project_path]')).toBeNull();
    });

    it('should handle a failed API response gracefully', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: jest.fn().mockResolvedValue('Unprocessable Entity')
      });

      const service = new ClientFileService({ apiKey: 'test-api-key', silent: true });
      const result = await service.createClientFile({
        name: 'deck.pdf',
        file: Buffer.from('pdf-bytes'),
        filename: 'deck.pdf'
      });

      expect(result).toBeNull();
    });

    it('should handle network errors gracefully', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const service = new ClientFileService({ apiKey: 'test-api-key', silent: true });
      const result = await service.createClientFile({
        name: 'deck.pdf',
        file: Buffer.from('pdf-bytes'),
        filename: 'deck.pdf'
      });

      expect(result).toBeNull();
    });

    it('should throw when global fetch is unavailable', async () => {
      const savedFetch = (global as any).fetch;
      delete (global as any).fetch;

      const service = new ClientFileService({ apiKey: 'test-api-key', silent: true });

      await expect(
        service.createClientFile({ name: 'deck.pdf', file: Buffer.from('pdf-bytes'), filename: 'deck.pdf' })
      ).rejects.toThrow('requires Node.js 18+');

      (global as any).fetch = savedFetch;
    });

    it('should skip the API call in dry-run mode', async () => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      const service = new ClientFileService({ apiKey: 'test-api-key', silent: true, dryRun: true });
      const result = await service.createClientFile({
        name: 'deck.pdf',
        file: Buffer.from('pdf-bytes'),
        filename: 'deck.pdf'
      });

      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('listClientFiles', () => {
    function mockListFetch(body: unknown, headers: Record<string, string> = {}, status = 200): jest.Mock {
      return jest.fn().mockResolvedValue({
        ok: status < 400,
        status,
        text: jest.fn().mockResolvedValue(JSON.stringify(body)),
        headers: new Headers(headers)
      });
    }

    it('sends the filters as query params and reads pagination from the response headers', async () => {
      const fetchMock = mockListFetch([buildResponse()], {
        'X-Page': '2',
        'X-Per-Page': '1',
        'X-Total-Count': '3',
        'X-Total-Pages': '3'
      });
      (global as any).fetch = fetchMock;

      const service = new ClientFileService({ apiKey: 'user-key', silent: true });
      const result = await service.listClientFiles({ status: 'draft', fileType: 'report', page: 2, per: 1 });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://coolhandlabs.com/api/v2/client_files?status=draft&file_type=report&page=2&per=1');
      expect(init.method).toBe('GET');
      expect(init.headers['X-API-Key']).toBe('user-key');
      expect(result.files).toEqual([buildResponse()]);
      expect(result.pagination).toEqual({
        current_page: 2,
        per_page: 1,
        total_count: 3,
        total_pages: 3,
        has_next_page: true,
        has_prev_page: true
      });
    });

    it('omits unset filters', async () => {
      const fetchMock = mockListFetch([]);
      (global as any).fetch = fetchMock;

      await new ClientFileService({ apiKey: 'user-key', silent: true }).listClientFiles();

      expect(fetchMock.mock.calls[0][0]).toBe('https://coolhandlabs.com/api/v2/client_files');
    });

    it('throws an HttpError carrying the status on a non-2xx response', async () => {
      (global as any).fetch = mockListFetch({ errors: { system: ['nope'] } }, {}, 403);

      const error = await new ClientFileService({ apiKey: 'client-key', silent: true })
        .listClientFiles()
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(403);
    });
  });

  describe('downloadClientFile', () => {
    function mockBytesFetch(bytes: Uint8Array, headers: Record<string, string>, status = 200): jest.Mock {
      return jest.fn().mockResolvedValue({
        ok: status < 400,
        status,
        arrayBuffer: jest.fn().mockResolvedValue(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
        text: jest.fn().mockResolvedValue('{"errors":{"clientfile":["not found"]}}'),
        headers: new Headers(headers)
      });
    }

    it('returns the raw bytes without decoding them, plus content type and filename', async () => {
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x80]);
      const fetchMock = mockBytesFetch(bytes, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="deck.pdf"; filename*=UTF-8\'\'deck.pdf'
      });
      (global as any).fetch = fetchMock;

      const result = await new ClientFileService({ apiKey: 'user-key', silent: true }).downloadClientFile('abc123');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://coolhandlabs.com/api/v2/client_files/abc123/content');
      expect(init.headers['X-API-Key']).toBe('user-key');
      expect(Buffer.isBuffer(result.content)).toBe(true);
      expect(result.content.equals(Buffer.from(bytes))).toBe(true);
      expect(result.contentType).toBe('application/pdf');
      expect(result.filename).toBe('deck.pdf');
    });

    it.each([
      ['attachment; filename="my deck.txt"', 'my deck.txt'],
      ['attachment; filename=deck.txt', 'deck.txt'],
      ['attachment; filename*=UTF-8\'\'q3%20r%C3%A9sum%C3%A9.pdf', 'q3 r\u00e9sum\u00e9.pdf'],
      ['attachment; filename="a\\"b.txt"', 'a"b.txt'],
      ['attachment', null]
    ])('parses the filename from Content-Disposition %s', async (disposition, expected) => {
      (global as any).fetch = mockBytesFetch(new Uint8Array([1]), { 'Content-Disposition': disposition });

      const result = await new ClientFileService({ apiKey: 'user-key', silent: true }).downloadClientFile('abc123');

      expect(result.filename).toBe(expected);
    });

    it('reports null content type and filename when the headers are absent', async () => {
      (global as any).fetch = mockBytesFetch(new Uint8Array([1]), {});

      const result = await new ClientFileService({ apiKey: 'user-key', silent: true }).downloadClientFile('abc123');

      expect(result.contentType).toBeNull();
      expect(result.filename).toBeNull();
    });

    it('throws an HttpError with the status on a 404', async () => {
      (global as any).fetch = mockBytesFetch(new Uint8Array(), {}, 404);

      const error = await new ClientFileService({ apiKey: 'user-key', silent: true })
        .downloadClientFile('missing')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(404);
    });

    it.each(['', '  ', '.', '..'])('rejects the id %j before sending a request', async (id) => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      await expect(
        new ClientFileService({ apiKey: 'user-key', silent: true }).downloadClientFile(id)
      ).rejects.toThrow('downloadClientFile: id must be a non-empty string');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('percent-encodes the id as a single path segment', async () => {
      const fetchMock = mockBytesFetch(new Uint8Array([1]), {});
      (global as any).fetch = fetchMock;

      await new ClientFileService({ apiKey: 'user-key', silent: true }).downloadClientFile('a/b?c');

      expect(fetchMock.mock.calls[0][0]).toBe('https://coolhandlabs.com/api/v2/client_files/a%2Fb%3Fc/content');
    });
  });

  describe('updateClientFileStatus', () => {
    it('PATCHes the status in a client_file envelope and returns the updated file', async () => {
      const fetchMock = createMockFetch(buildResponse({ status: 'published' }));
      (global as any).fetch = fetchMock;

      const result = await new ClientFileService({ apiKey: 'user-key', silent: true })
        .updateClientFileStatus('abc123', 'published');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://coolhandlabs.com/api/v2/client_files/abc123');
      expect(init.method).toBe('PATCH');
      expect(init.headers['X-API-Key']).toBe('user-key');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({ client_file: { status: 'published' } });
      expect(result).toEqual(buildResponse({ status: 'published' }));
    });

    it('throws an HttpError with the status on a 422', async () => {
      (global as any).fetch = createMockFetch({ errors: { status: ['is invalid'] } }, 422, false);

      const error = await new ClientFileService({ apiKey: 'user-key', silent: true })
        .updateClientFileStatus('abc123', 'bogus' as never)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(422);
    });

    it('rejects a blank id before sending a request', async () => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      await expect(
        new ClientFileService({ apiKey: 'user-key', silent: true }).updateClientFileStatus('  ', 'draft')
      ).rejects.toThrow('updateClientFileStatus: id must be a non-empty string');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips the request in dry-run mode', async () => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      const result = await new ClientFileService({ apiKey: 'user-key', silent: true, dryRun: true })
        .updateClientFileStatus('abc123', 'archived');

      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
