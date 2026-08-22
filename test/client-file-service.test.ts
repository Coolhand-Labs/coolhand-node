import { ClientFileService, ClientFileServiceConfig } from '../src/services/ClientFileService';
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
});
