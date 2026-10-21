import { Coolhand } from '../src/index';
import { LoggingService } from '../src/services/LoggingService';
import { ClientFileService } from '../src/services/ClientFileService';
import { McpService } from '../src/services/McpService';

const originalFetch = (global as any).fetch;
const KEY = 'sk-ant-SECRET-KEY-123';

function errorOutput(): string {
  return (console.error as jest.Mock).mock.calls.flat().map(String).join('\n');
}

describe('apiKey validation never echoes the key', () => {
  it.each([
    ['sk-ant-SECRET\nX', 'embedded LF'],
    ['sk-ant-SECRET\r\nX', 'embedded CRLF'],
    ['sk-ant-SECRET\u0000X', 'NUL'],
    ['sk-ant-SECRET\u0007X', 'control character'],
    ['sk-ant-SECRET X', 'non-latin1 separator'],
  ])('rejects %j (%s)', (apiKey) => {
    let message = '';
    try { new Coolhand({ apiKey, silent: true }); } catch (err) { message = (err as Error).message; }
    expect(message).toMatch(/apiKey/);
    expect(message).not.toContain('SECRET');
  });

  it.each([['   '], [123], [{}]])('rejects an empty or non-string key (%j)', (apiKey) => {
    expect(() => new LoggingService({ apiKey: apiKey as unknown as string, silent: true })).toThrow(/apiKey/);
  });

  it('accepts a normal key and one with surrounding whitespace (fetch trims it)', () => {
    expect(() => new Coolhand({ apiKey: KEY, silent: true })).not.toThrow();
    expect(() => new Coolhand({ apiKey: `${KEY}\n`, silent: true })).not.toThrow();
  });
});

describe('request errors mask the apiKey', () => {
  beforeEach(() => {
    (console.error as jest.Mock).mockClear();
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  const leaky = () => jest.fn().mockRejectedValue(new Error(`proxy rejected header "${KEY}"`));

  it('logRequestToAPI masks the key when sendRequest itself throws', async () => {
    const service = new LoggingService({ apiKey: KEY, silent: false });
    jest.spyOn(service as any, 'sendRequest').mockRejectedValue(new Error(`proxy rejected header "${KEY}"`));

    await expect(service.logRequestToAPI({ id: 1, url: 'https://api.openai.com/v1/chat/completions' } as any)).resolves.toBeNull();

    expect(errorOutput()).toContain('[redacted]');
    expect(errorOutput()).not.toContain(KEY);
  });

  it('sendRequest logs a masked message', async () => {
    (global as any).fetch = leaky();
    const service = new LoggingService({ apiKey: KEY, silent: true });
    await service.logRequestToAPI({
      id: 1, timestamp: new Date().toISOString(), method: 'POST', url: 'https://api.openai.com/v1/chat/completions',
      headers: {}, request_body: null, response_body: null, response_headers: null, status_code: 200, protocol: 'https'
    });
    expect(errorOutput()).toContain('[redacted]');
    expect(errorOutput()).not.toContain(KEY);
  });

  it('read methods throw a masked error without the raw cause', async () => {
    (global as any).fetch = leaky();
    const service = new LoggingService({ apiKey: KEY, silent: true });
    const err = await service.getLogContent('log_1').then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain('[redacted]');
    expect(err?.message).not.toContain(KEY);
    expect(err?.cause).toBeUndefined();
  });

  it('keeps the cause when nothing needed masking', async () => {
    const original = new Error('connect ECONNREFUSED');
    (global as any).fetch = jest.fn().mockRejectedValue(original);
    const service = new LoggingService({ apiKey: KEY, silent: true });
    const err = await service.getLogContent('log_1').then(() => null, (e: Error) => e);
    expect(err?.cause).toBe(original);
  });

  it('masks a key that was accepted with surrounding whitespace', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error(`proxy rejected header "${KEY}"`));
    const service = new LoggingService({ apiKey: `${KEY}\n`, silent: true });
    const err = await service.getLogContent('log_1').then(() => null, (e: Error) => e);
    expect(err?.message).not.toContain(KEY);
    expect(err?.cause).toBeUndefined();
  });

  it('drops a cause that quotes the key in a nested error', async () => {
    const wrapped = new Error('fetch failed', { cause: new Error(`bad header ${KEY}`) });
    (global as any).fetch = jest.fn().mockRejectedValue(wrapped);
    const service = new LoggingService({ apiKey: KEY, silent: true });
    const err = await service.getLogContent('log_1').then(() => null, (e: Error) => e);
    expect(err?.cause).toBeUndefined();
  });

  it('masks the key in an error response body', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(new Response(`bad key ${KEY}`, { status: 401 }));
    const service = new LoggingService({ apiKey: KEY, silent: true });
    const err = await service.getLogContent('log_1').then(() => null, (e: Error) => e);
    expect(err?.message).not.toContain(KEY);
  });

  it('sendMultipart logs a masked message', async () => {
    (global as any).fetch = leaky();
    const service = new ClientFileService({ apiKey: KEY, silent: true });
    await service.createClientFile({ name: 'a.txt', file: new Blob(['x']), filename: 'a.txt' });
    expect(errorOutput()).toContain('[redacted]');
    expect(errorOutput()).not.toContain(KEY);
  });

  it.each([[null], ['plain string']])('handles a non-Error rejection (%j)', async (reason) => {
    (global as any).fetch = jest.fn().mockRejectedValue(reason);
    const service = new ClientFileService({ apiKey: KEY, silent: true });
    await expect(service.createClientFile({ name: 'a.txt', file: new Blob(['x']), filename: 'a.txt' })).resolves.toBeNull();
    expect(errorOutput()).toContain(String(reason));
  });
});

describe('excerpt masks before truncating', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  it('does not leave a key fragment when the key straddles the 2000-char cut', async () => {
    const body = 'x'.repeat(1990) + KEY;
    (global as any).fetch = jest.fn().mockResolvedValue(new Response(body, { status: 500 }));
    const service = new LoggingService({ apiKey: KEY, silent: true });
    const err = await service.getLogContent('log_1').then(() => null, (e: Error) => e);
    expect(err?.message).not.toContain(KEY.slice(0, 8));
  });
});

describe('McpService masks the apiKey in surfaced errors', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  const respond = (body: unknown) =>
    jest.fn().mockResolvedValue({ ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify(body)) });

  it('masks a JSON-RPC error message', async () => {
    (global as any).fetch = respond({ error: { message: `bad key ${KEY}` } });
    const err = await new McpService({ apiKey: KEY, silent: true }).mcpCall('t', {}).then(() => null, (e: Error) => e);
    expect(err?.message).toContain('[redacted]');
    expect(err?.message).not.toContain(KEY);
  });

  it('masks a result-level error', async () => {
    (global as any).fetch = respond({ result: { error: `bad key ${KEY}` } });
    const err = await new McpService({ apiKey: KEY, silent: true }).mcpCall('t', {}).then(() => null, (e: Error) => e);
    expect(err?.message).not.toContain(KEY);
  });
});

describe('cause scrubbing for non-Error rejections', () => {
  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  it('drops a plain-object cause that quotes the key', async () => {
    const wrapped = Object.assign(new Error('fetch failed'), { cause: { message: `bad header ${KEY}` } });
    (global as any).fetch = jest.fn().mockRejectedValue(wrapped);
    const err = await new LoggingService({ apiKey: KEY, silent: true }).getLogContent('log_1').then(() => null, (e: Error) => e);
    expect(err?.cause).toBeUndefined();
  });
});
