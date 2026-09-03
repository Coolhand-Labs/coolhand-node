import { LoggingService, LoggingServiceConfig } from '../src/services/LoggingService';
import { HttpError } from '../src/services/BaseService';
import { CoolhandCallData, CoolhandMatchedPattern, LlmRequestLogContentFull, LlmRequestLogContentSearchResult, LlmRequestLogSummary, SearchLogsResponse } from '../src/types';

// Mock fetch for testing
const originalFetch = (global as any).fetch;

// Helper function to create a mock fetch
function createMockFetch(mockResponse: any, status: number = 200, ok: boolean = true): any {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: jest.fn().mockResolvedValue(mockResponse),
    text: jest.fn().mockResolvedValue(JSON.stringify(mockResponse))
  });
}

// Helper for GET-based reads (getLogContent/searchLogs), which only read the `text()` body.
// `headers` defaults to an empty Headers so callers that don't care (getLogContent) are
// unaffected; searchLogs tests pass explicit pagination headers via the `headers` option.
function mockGetFetch(
  bodyObj: any,
  { ok = true, status = 200, headers = {} }: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
): any {
  const text = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  return jest.fn().mockResolvedValue({ ok, status, text: jest.fn().mockResolvedValue(text), headers: new Headers(headers) });
}

// Helper function to create mock call data
function createMockCallData(overrides: Partial<CoolhandCallData> = {}): CoolhandCallData {
  return {
    id: 1,
    timestamp: '2023-01-01T00:00:00Z',
    method: 'POST',
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { 'Content-Type': 'application/json', 'Authorization': '[REDACTED]' },
    request_body: {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.7
    },
    response_body: { choices: [{ message: { content: 'Hi there!' } }] },
    response_headers: { 'Content-Type': 'application/json' },
    status_code: 200,
    protocol: 'https',
    ...overrides
  };
}

// Helper function to create mock matched pattern
function createMockMatchedPattern(): CoolhandMatchedPattern {
  return {
    pattern: {
      name: 'OpenAI',
      domains: ['api.openai.com'],
      paths: ['/v1/chat/completions'],
      headers: { 'Authorization': '[REDACTED]' }
    },
    matchType: 'domain',
    matchValue: 'api.openai.com'
  };
}

describe('LoggingService', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  describe('Constructor validation and initialization', () => {
    it('should configure with production endpoint', () => {
      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);

      expect(service.getApiEndpoint()).toBe('https://coolhandlabs.com/api/v2/llm_request_logs');
    });
  });

  describe('API Logging', () => {
    it('should successfully log with fetch', async () => {
      const mockResponse = { id: 123, status: 'success' };
      (global as any).fetch = createMockFetch(mockResponse);

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      await expect(service.logRequestToAPI(callData)).resolves.not.toThrow();
    });

    it('should successfully log with matched pattern', async () => {
      const mockResponse = { id: 124, status: 'success' };
      (global as any).fetch = createMockFetch(mockResponse);

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();
      const matchedPattern = createMockMatchedPattern();

      await expect(service.logRequestToAPI(callData, matchedPattern)).resolves.not.toThrow();
    });

    it('should handle failed API response gracefully', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue('Bad Request'),
        json: jest.fn().mockResolvedValue({ error: 'Bad Request' })
      });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      await expect(service.logRequestToAPI(callData)).resolves.not.toThrow();
    });

    it('should handle network errors gracefully', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      await expect(service.logRequestToAPI(callData)).resolves.not.toThrow();
    });

    it('should resolve (not reject) when payload contains a circular reference', async () => {
      (global as any).fetch = jest.fn();

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const circular: any = { note: 'circular' };
      circular.self = circular;
      const callData = createMockCallData({ response_body: circular });

      await expect(service.logRequestToAPI(callData)).resolves.not.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        '❌ Request error:',
        expect.stringContaining('circular structure')
      );
    });

    it('should resolve (not reject) when matchedPattern is malformed', async () => {
      (global as any).fetch = createMockFetch({ id: 1, status: 'success' });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: false
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();
      // logRequestInfo (called before sendRequest, so outside its try/catch) reads
      // matchedPattern.pattern.name — a matchedPattern missing `pattern` throws
      // synchronously here, which previously escaped as a rejected logRequestToAPI
      // promise instead of degrading to null like every other failure mode.
      const malformedPattern = { matchType: 'domain', matchValue: 'api.test.com' } as any;

      await expect(service.logRequestToAPI(callData, malformedPattern)).resolves.not.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        '❌ Failed to log request to API:',
        expect.stringContaining("reading 'name'")
      );
    });

    it('should structure payload correctly', async () => {
      let capturedRequestBody: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, status: 'success' }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, status: 'success' }))
        };
      });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData({
        id: 456,
        method: 'POST',
        url: 'https://api.example.com/test'
      });

      await service.logRequestToAPI(callData);

      expect(capturedRequestBody.llm_request_log).toBeDefined();
      expect(capturedRequestBody.llm_request_log.raw_request).toBeDefined();

      const rawRequest = capturedRequestBody.llm_request_log.raw_request;
      expect(rawRequest.id).toBe(456);
      expect(rawRequest.method).toBe('POST');
      expect(rawRequest.url).toBe('https://api.example.com/test');
    });

    it('should include metadata in the payload when provided', async () => {
      let capturedRequestBody: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, status: 'success' }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, status: 'success' }))
        };
      });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      await service.logRequestToAPI(callData, undefined, 'manual', undefined, { project_path: '/Users/me/my-project' });

      expect(capturedRequestBody.llm_request_log.metadata).toEqual({ project_path: '/Users/me/my-project' });
    });

    it('should omit metadata from the payload when not provided', async () => {
      let capturedRequestBody: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, status: 'success' }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, status: 'success' }))
        };
      });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      await service.logRequestToAPI(callData);

      expect(capturedRequestBody.llm_request_log.metadata).toBeUndefined();
    });

    it('should include metadata alongside an explicit collector', async () => {
      let capturedRequestBody: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, status: 'success' }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, status: 'success' }))
        };
      });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      await service.logRequestToAPI(callData, undefined, undefined, 'coolhand-cli', { project_path: '/tmp/proj' });

      expect(capturedRequestBody.llm_request_log.collector).toBe('coolhand-cli');
      expect(capturedRequestBody.llm_request_log.metadata).toEqual({ project_path: '/tmp/proj' });
    });

    it('should set correct headers', async () => {
      let capturedHeaders: any;

      (global as any).fetch = jest.fn().mockImplementation(async (input: any, options: any) => {
        capturedHeaders = options.headers;
        return {
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValue({ id: 123, status: 'success' }),
          text: jest.fn().mockResolvedValue(JSON.stringify({ id: 123, status: 'success' }))
        };
      });

      const config: LoggingServiceConfig = {
        apiKey: 'secret-api-key-123',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      await service.logRequestToAPI(callData);

      expect(capturedHeaders['Content-Type']).toBe('application/json');
      expect(capturedHeaders['X-API-Key']).toBe('secret-api-key-123');
    });
  });

  describe('Logging behavior', () => {
    it('should not output logs in silent mode', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      (global as any).fetch = createMockFetch({ id: 123, status: 'success' });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();
      const matchedPattern = createMockMatchedPattern();

      await service.logRequestToAPI(callData, matchedPattern);

      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).not.toContain('🎉 LOGGING');
      expect(logCalls).not.toContain('✅ Successfully logged');

      consoleSpy.mockRestore();
    });

    it('should output verbose logs in non-silent mode', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      (global as any).fetch = createMockFetch({ id: 123, status: 'success' });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: false
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();
      const matchedPattern = createMockMatchedPattern();

      await service.logRequestToAPI(callData, matchedPattern);

      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('🎉 LOGGING OpenAI API Call');
      expect(logCalls).toContain('🕐 Time:');
      expect(logCalls).toContain('🎯 POST');
      expect(logCalls).toContain('📊 Status: 200');
      expect(logCalls).toContain('🔧 Protocol: https');
      expect(logCalls).toContain('🔍 Matched by: domain');
      expect(logCalls).toContain('🤖 Model: gpt-4');
      expect(logCalls).toContain('💬 Messages: 1');
      expect(logCalls).toContain('🌡️  Temperature: 0.7');
      expect(logCalls).toContain('📤 Sending to:');

      consoleSpy.mockRestore();
    });

    it('should use HTTPS fallback when fetch is not available', async () => {
      const originalFetch = (global as any).fetch;
      delete (global as any).fetch;

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: true
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      try {
        await service.logRequestToAPI(callData);
      } catch (error) {
        expect((error as Error).message).not.toContain('fetch');
      }

      (global as any).fetch = originalFetch;
    });

    it('should handle logging without matched pattern', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      (global as any).fetch = createMockFetch({ id: 123, status: 'success' });

      const config: LoggingServiceConfig = {
        apiKey: 'test-api-key',
        silent: false
      };

      const service = new LoggingService(config);
      const callData = createMockCallData();

      await service.logRequestToAPI(callData);

      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('🎉 LOGGING API API Call');
      expect(logCalls).not.toContain('🔍 Matched by:');

      consoleSpy.mockRestore();
    });
  });

  describe('getLogContent', () => {
    it('GETs the log by id with the private key, plus section/maxChars/includeThinking as query params', async () => {
      let capturedUrl: string | undefined;
      let capturedOptions: any;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string, options: any) => {
        capturedUrl = url;
        capturedOptions = options;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify({ id: 'abc123' })) };
      });

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      await service.getLogContent('abc123', {
        section: 'end',
        maxChars: 500,
        includeThinking: true
      });

      const url = new URL(capturedUrl!);
      expect(url.origin + url.pathname).toBe('https://coolhandlabs.com/api/v2/llm_request_logs/abc123');
      expect(url.searchParams.get('section')).toBe('end');
      expect(url.searchParams.get('max_chars')).toBe('500');
      expect(url.searchParams.has('search_query')).toBe(false);
      expect(url.searchParams.get('include_thinking')).toBe('true');
      expect(capturedOptions.method).toBe('GET');
      expect(capturedOptions.headers['X-API-Key']).toBe('private-key-123');
    });

    it('GETs the log by id with searchQuery as a query param, omitting section/maxChars', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify({ id: 'abc123' })) };
      });

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      await service.getLogContent('abc123', { searchQuery: 'timeout' });

      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('search_query')).toBe('timeout');
      expect(url.searchParams.has('section')).toBe(false);
      expect(url.searchParams.has('max_chars')).toBe(false);
    });

    it('throws client-side on a blank searchQuery instead of silently returning the content shape', async () => {
      const fetchSpy = jest.fn();
      (global as any).fetch = fetchSpy;

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });

      // The backend branches on Rails' `.present?` (blank/whitespace-only counts as absent), so a
      // blank query would otherwise fall through to the content shape server-side while this
      // overload's return type promises a search result — must fail fast instead.
      await expect(service.getLogContent('abc123', { searchQuery: '' })).rejects.toThrow(
        'searchQuery must be a non-empty string'
      );
      await expect(service.getLogContent('abc123', { searchQuery: '   ' })).rejects.toThrow(
        'searchQuery must be a non-empty string'
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws client-side on a blank logId instead of silently hitting the index route', async () => {
      const fetchSpy = jest.fn();
      (global as any).fetch = fetchSpy;

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });

      // A blank logId would otherwise build a URL Rails strips to the collection endpoint,
      // returning a bare array typed as a single log's content — must fail fast instead.
      await expect(service.getLogContent('')).rejects.toThrow('logId must be a non-empty string');
      await expect(service.getLogContent('   ')).rejects.toThrow('logId must be a non-empty string');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws client-side on a dot-segment logId that WHATWG URL parsing would resolve away', async () => {
      const fetchSpy = jest.fn();
      (global as any).fetch = fetchSpy;

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });

      // encodeURIComponent doesn't escape "." — new URL(...) still collapses "." to the parent
      // (collection) path and ".." further up, past this resource entirely. Both must be rejected
      // the same as a blank id, not silently sent as a real request.
      await expect(service.getLogContent('.')).rejects.toThrow('logId must be a non-empty string');
      await expect(service.getLogContent('..')).rejects.toThrow('logId must be a non-empty string');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns the parsed log content on success', async () => {
      const mockResponse: LlmRequestLogContentFull = {
        id: 'abc123',
        url: '/c/client-hash/llm_request_logs/abc123',
        model: 'gpt-4',
        source_api: 'openai',
        template_id: null,
        template_name: null,
        input_tokens: 100,
        output_tokens: 50,
        latency_ms: 250,
        created_at: '2026-01-01T00:00:00Z',
        system_prompt: 'You are a helpful assistant.',
        user_prompt: 'What is 2+2?',
        output: '4',
        thinking_response: ['Let me add these numbers.']
      };
      (global as any).fetch = mockGetFetch(mockResponse);

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      // thinking_response is only ever present server-side when includeThinking was requested.
      const result = await service.getLogContent('abc123', { includeThinking: true });

      expect(result).toEqual(mockResponse);
      expect(result.thinking_response).toEqual(['Let me add these numbers.']);
    });

    it('returns snippet matches when searchQuery is used', async () => {
      const mockResponse: LlmRequestLogContentSearchResult = {
        id: 'abc123',
        url: '/c/client-hash/llm_request_logs/abc123',
        model: 'gpt-4',
        source_api: 'openai',
        template_id: null,
        template_name: null,
        input_tokens: 100,
        output_tokens: 50,
        latency_ms: 250,
        created_at: '2026-01-01T00:00:00Z',
        search_query: 'timeout',
        matches: { system_prompt: [], user_prompt: ['...a timeout occurred...'], output: [] }
      };
      (global as any).fetch = mockGetFetch(mockResponse);

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      const result = await service.getLogContent('abc123', { searchQuery: 'timeout' });

      expect(result).toEqual(mockResponse);
    });

    it('throws with the HTTP status on a non-ok response', async () => {
      (global as any).fetch = mockGetFetch('Key rejected', { ok: false, status: 401 });

      const service = new LoggingService({ apiKey: 'public-key-used-by-mistake', silent: true });
      await expect(service.getLogContent('abc123')).rejects.toMatchObject({
        status: 401,
        message: expect.stringContaining('Log request failed (401)')
      });
      await expect(service.getLogContent('abc123')).rejects.toBeInstanceOf(HttpError);
    });

    it('throws with a 404 status when the log is not found', async () => {
      (global as any).fetch = mockGetFetch('Not found', { ok: false, status: 404 });

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      await expect(service.getLogContent('missing')).rejects.toMatchObject({
        status: 404,
        message: expect.stringContaining('Log request failed (404)')
      });
    });

    it('throws a plain error on network failure', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      await expect(service.getLogContent('abc123')).rejects.toThrow('Log request failed: ECONNREFUSED');
    });

    it('throws when the body is not valid JSON', async () => {
      (global as any).fetch = mockGetFetch('<html>not json</html>');

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      await expect(service.getLogContent('abc123')).rejects.toThrow('Log response was not valid JSON');
    });
  });

  describe('searchLogs', () => {
    it('builds named filters and pagination as query params', async () => {
      let capturedUrl: string | undefined;
      let capturedOptions: any;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string, options: any) => {
        capturedUrl = url;
        capturedOptions = options;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify([])), headers: new Headers() };
      });

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      await service.searchLogs({
        templateId: 'tmpl-hash',
        workloadId: 'workload-hash',
        systemPromptContains: 'assistant',
        userPromptContains: 'help',
        model: 'gpt-4',
        sourceApi: 'openai',
        sourceApiResult: 'success',
        unmatchedOnly: true,
        daysBack: 7,
        includePrompts: true,
        sort: 'created_at desc',
        page: 2,
        per: 10,
        includeTotal: true
      });

      const url = new URL(capturedUrl!);
      expect(url.origin + url.pathname).toBe('https://coolhandlabs.com/api/v2/llm_request_logs');
      expect(url.searchParams.get('template_id')).toBe('tmpl-hash');
      expect(url.searchParams.get('workload_id')).toBe('workload-hash');
      expect(url.searchParams.get('system_prompt_contains')).toBe('assistant');
      expect(url.searchParams.get('user_prompt_contains')).toBe('help');
      expect(url.searchParams.get('model')).toBe('gpt-4');
      expect(url.searchParams.get('source_api')).toBe('openai');
      expect(url.searchParams.get('source_api_result')).toBe('success');
      expect(url.searchParams.get('unmatched_only')).toBe('true');
      expect(url.searchParams.get('days_back')).toBe('7');
      expect(url.searchParams.get('include_prompts')).toBe('true');
      expect(url.searchParams.get('q[s]')).toBe('created_at desc');
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.get('per')).toBe('10');
      expect(url.searchParams.get('include_total')).toBe('true');
      expect(capturedOptions.method).toBe('GET');
      expect(capturedOptions.headers['X-API-Key']).toBe('private-key-123');
    });

    it('omits include_total when not passed', async () => {
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify([])), headers: new Headers() };
      });

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      await service.searchLogs({ model: 'gpt-4' });

      const url = new URL(capturedUrl!);
      expect(url.searchParams.has('include_total')).toBe(false);
    });

    it('sends explicit false booleans as the literal string "false", not omitting the param', async () => {
      // Both are false-by-default backend-side anyway, so dropping `false` here wouldn't currently
      // change behavior — but an explicit `false` is still caller intent, and this SDK shouldn't
      // silently treat it like `undefined` (an actually-omitted param) the way it does everywhere
      // else in this method. The backend casts the sent string via ActiveModel::Type::Boolean,
      // which does treat the literal string "false" as boolean false, so this round-trips correctly.
      let capturedUrl: string | undefined;
      (global as any).fetch = jest.fn().mockImplementation(async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify([])), headers: new Headers() };
      });

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      await service.searchLogs({ unmatchedOnly: false, includePrompts: false, includeTotal: false });

      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('unmatched_only')).toBe('false');
      expect(url.searchParams.get('include_prompts')).toBe('false');
      expect(url.searchParams.get('include_total')).toBe('false');
    });

    it('does not let a NaN page (type-legal but nonsensical) propagate into current_page', async () => {
      (global as any).fetch = mockGetFetch([]);

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      const result = await service.searchLogs({ page: NaN });

      expect(result.pagination.current_page).toBe(1);
    });

    it('returns { logs, pagination }, reading pagination off response headers', async () => {
      const mockLogs: LlmRequestLogSummary[] = [
        {
          id: 'abc123',
          collector: 'manual',
          source_api: 'openai',
          source_api_result: 'success',
          model: 'gpt-4',
          template_id: null,
          template_name: null,
          input_tokens: 100,
          output_tokens: 50,
          latency_ms: 250,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z'
        }
      ];
      (global as any).fetch = mockGetFetch(mockLogs, {
        headers: { 'X-Page': '2', 'X-Per-Page': '1', 'X-Total-Count': '5', 'X-Total-Pages': '5' }
      });

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      const result: SearchLogsResponse = await service.searchLogs({ page: 2, per: 1 });

      expect(result.logs).toEqual(mockLogs);
      expect(result.pagination).toEqual({
        current_page: 2,
        per_page: 1,
        total_count: 5,
        total_pages: 5,
        has_next_page: true,
        has_prev_page: true
      });
    });

    it('defaults per_page to the server default (25) and other fields to 0 when headers are absent and logs is empty', async () => {
      (global as any).fetch = mockGetFetch([]);

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      const result = await service.searchLogs();

      expect(result.logs).toEqual([]);
      expect(result.pagination).toEqual({
        current_page: 1,
        per_page: 25,
        total_count: 0,
        total_pages: 0,
        has_next_page: false,
        has_prev_page: false
      });
    });

    it('reports has_next_page: true when a full page comes back with headers absent, even though total_pages is only a lower-bound estimate', async () => {
      const fullPage: LlmRequestLogSummary[] = Array.from({ length: 25 }, (_, i) => ({
        id: `log-${i}`,
        collector: 'manual',
        source_api: 'openai',
        source_api_result: 'success',
        model: 'gpt-4',
        template_id: null,
        template_name: null,
        input_tokens: 100,
        output_tokens: 50,
        latency_ms: 250,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
      }));
      (global as any).fetch = mockGetFetch(fullPage);

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      const result = await service.searchLogs({ page: 1 });

      // A caller looping `while (pagination.has_next_page)` must not stop here just because
      // total_pages' lower-bound estimate (1) matches the current page.
      expect(result.pagination.total_pages).toBe(1);
      expect(result.pagination.has_next_page).toBe(true);
    });

    it('does not extrapolate a fabricated total_count from an empty page, but still reports has_prev_page: true', async () => {
      (global as any).fetch = mockGetFetch([]);

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      const result = await service.searchLogs({ page: 1000000, per: 25 });

      // An empty page proves nothing about how many rows exist (unlike a non-empty page, which
      // offset-based pagination guarantees a lower bound for) — extrapolating (page-1)*per here
      // would report a fabricated ~25M-row total_count for a search that matched nothing.
      expect(result.pagination.total_count).toBe(0);
      expect(result.pagination.total_pages).toBe(0);
      expect(result.pagination.has_next_page).toBe(false);
      // has_prev_page is page-relative, not result-relative: still true regardless of the empty page.
      expect(result.pagination.has_prev_page).toBe(true);
    });

    it('does not report total_count: 0 when logs is non-empty but pagination headers are absent (backend pre-#1096)', async () => {
      const mockLogs: LlmRequestLogSummary[] = [
        {
          id: 'abc123',
          collector: 'manual',
          source_api: 'openai',
          source_api_result: 'success',
          model: 'gpt-4',
          template_id: null,
          template_name: null,
          input_tokens: 100,
          output_tokens: 50,
          latency_ms: 250,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z'
        }
      ];
      (global as any).fetch = mockGetFetch(mockLogs);

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      const result = await service.searchLogs({ page: 3, per: 10 });

      expect(result.logs).toEqual(mockLogs);
      // Lower-bound estimate: page 3 of 10-per-page, assuming pages 1-2 were full (20 items) plus
      // this page's 1 real item = 21, so total_pages (ceil(21/10)) comes out to exactly 3 — this
      // must stay self-consistent with per_page/current_page, not just "total_count: 1".
      expect(result.pagination).toEqual({
        current_page: 3,
        per_page: 10,
        total_count: 21,
        total_pages: 3,
        has_next_page: false,
        has_prev_page: true
      });
    });

    it('falls back to a fallback value when a present header is malformed (non-numeric)', async () => {
      (global as any).fetch = mockGetFetch([{ id: 'abc123' } as unknown as LlmRequestLogSummary], {
        headers: { 'X-Total-Count': 'not-a-number', 'X-Page': '1', 'X-Per-Page': '25', 'X-Total-Pages': '1' }
      });

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      const result = await service.searchLogs();

      // X-Total-Count is present (so the "headers absent" branch doesn't apply) but garbage —
      // falls back to logs.length rather than propagating NaN.
      expect(result.pagination.total_count).toBe(1);
      expect(Number.isNaN(result.pagination.total_count)).toBe(false);
    });

    it('derives a missing X-Total-Pages from X-Total-Count, not from current_page, so a real count is not truncated', async () => {
      (global as any).fetch = mockGetFetch([], {
        // X-Total-Count present and valid (500 real rows) but X-Total-Pages absent — a fallback of
        // `currentPage` (1) would report total_pages: 1 and truncate a caller's pagination loop
        // after the first 25-row page despite 500 real rows existing.
        headers: { 'X-Total-Count': '500', 'X-Page': '1', 'X-Per-Page': '25' }
      });

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      const result = await service.searchLogs();

      expect(result.pagination.total_count).toBe(500);
      expect(result.pagination.total_pages).toBe(20);
      expect(result.pagination.has_next_page).toBe(true);
    });

    it('treats an empty-string header value as absent, not a valid zero', async () => {
      const mockLogs: LlmRequestLogSummary[] = [{ id: 'abc123' } as unknown as LlmRequestLogSummary];
      (global as any).fetch = mockGetFetch(mockLogs, {
        headers: { 'X-Total-Count': '', 'X-Page': '', 'X-Per-Page': '' }
      });

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      const result = await service.searchLogs();

      // Number('') is 0 in JS — without a stricter check this would wrongly report total_count: 0
      // for a non-empty `logs`. The header is technically present, so it falls back per-field
      // rather than through the whole "headers absent" branch — per_page falls back to the
      // server's real default (25), not logs.length.
      expect(result.pagination.total_count).toBe(1);
      expect(result.pagination.current_page).toBe(1);
      expect(result.pagination.per_page).toBe(25);
    });

    it('throws with the HTTP status on a non-ok response', async () => {
      (global as any).fetch = mockGetFetch('Key rejected', { ok: false, status: 401 });

      const service = new LoggingService({ apiKey: 'public-key-used-by-mistake', silent: true });
      await expect(service.searchLogs()).rejects.toMatchObject({
        status: 401,
        message: expect.stringContaining('Log request failed (401)')
      });
      await expect(service.searchLogs()).rejects.toBeInstanceOf(HttpError);
    });

    it('throws a plain error on network failure', async () => {
      (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      await expect(service.searchLogs()).rejects.toThrow('Log request failed: ECONNREFUSED');
    });

    it('throws when the body is not valid JSON', async () => {
      (global as any).fetch = mockGetFetch('<html>not json</html>');

      const service = new LoggingService({ apiKey: 'private-key-123', silent: true });
      await expect(service.searchLogs()).rejects.toThrow('Log response was not valid JSON');
    });
  });
});

