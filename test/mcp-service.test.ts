import { McpService, McpServiceConfig } from '../src/services/McpService';

const originalFetch = (global as any).fetch;

function mockFetch(bodyObj: any, { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}): any {
  const text = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  return jest.fn().mockResolvedValue({
    ok,
    status,
    text: jest.fn().mockResolvedValue(text),
  });
}

describe('McpService', () => {
  const config: McpServiceConfig = { apiKey: 'private-key-123', silent: true };

  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  it('targets the /mcp endpoint', () => {
    const service = new McpService(config);
    expect(service.getApiEndpoint()).toBe('https://coolhandlabs.com/mcp');
  });

  it('returns the JSON-RPC result on success', async () => {
    (global as any).fetch = mockFetch({ jsonrpc: '2.0', id: 1, result: { workloads: [1, 2, 3] } });

    const service = new McpService(config);
    const result = await service.mcpCall('list_workloads', { limit: 10 });

    expect(result).toEqual({ workloads: [1, 2, 3] });
  });

  it('POSTs a JSON-RPC tools/call envelope with the private key as X-API-Key', async () => {
    let capturedUrl: string | undefined;
    let capturedOptions: any;
    (global as any).fetch = jest.fn().mockImplementation(async (url: string, options: any) => {
      capturedUrl = url;
      capturedOptions = options;
      return { ok: true, status: 200, text: jest.fn().mockResolvedValue(JSON.stringify({ result: 'ok' })) };
    });

    const service = new McpService(config);
    await service.mcpCall('get_optimization', { id: 'opt_42' });

    expect(capturedUrl).toBe('https://coolhandlabs.com/mcp');
    expect(capturedOptions.method).toBe('POST');
    expect(capturedOptions.headers['X-API-Key']).toBe('private-key-123');
    const sent = JSON.parse(capturedOptions.body);
    expect(sent).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_optimization', arguments: { id: 'opt_42' } },
    });
  });

  it('throws when the response is not ok', async () => {
    (global as any).fetch = mockFetch('Server boom', { ok: false, status: 500 });

    const service = new McpService(config);
    await expect(service.mcpCall('list_workloads', {})).rejects.toThrow('MCP request failed (500): Server boom');
  });

  it('carries the HTTP status on a non-ok response so callers can react to a 401', async () => {
    (global as any).fetch = mockFetch('Key rejected', { ok: false, status: 401 });

    const service = new McpService(config);
    await expect(service.mcpCall('list_workloads', {})).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining('MCP request failed (401)'),
    });
  });

  it('throws when the body is not valid JSON', async () => {
    (global as any).fetch = mockFetch('<html>not json</html>');

    const service = new McpService(config);
    await expect(service.mcpCall('list_workloads', {})).rejects.toThrow('MCP response was not valid JSON');
  });

  it('throws when the JSON-RPC payload carries an error', async () => {
    (global as any).fetch = mockFetch({ jsonrpc: '2.0', id: 1, error: { message: 'unknown tool' } });

    const service = new McpService(config);
    await expect(service.mcpCall('bogus', {})).rejects.toThrow('MCP error: unknown tool');
  });

  it('throws on a network failure', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const service = new McpService(config);
    await expect(service.mcpCall('list_workloads', {})).rejects.toThrow('MCP request failed: ECONNREFUSED');
  });

  it('throws with the message when a successful envelope carries a tool-execution error', async () => {
    (global as any).fetch = mockFetch({ jsonrpc: '2.0', id: 1, result: { error: 'Cannot rename system workloads' } });

    const service = new McpService(config);
    await expect(service.mcpCall('update_workload', {})).rejects.toThrow('Cannot rename system workloads');
  });

  it('does not misinterpret an array result as a tool-execution error', async () => {
    (global as any).fetch = mockFetch({ jsonrpc: '2.0', id: 1, result: [{ id: '1' }, { id: '2' }] });

    const service = new McpService(config);
    await expect(service.mcpCall('list_workloads', {})).resolves.toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('passes through an object result that has no error field', async () => {
    (global as any).fetch = mockFetch({ jsonrpc: '2.0', id: 1, result: { workload: { id: 'wl-1', name: 'Renamed' } } });

    const service = new McpService(config);
    await expect(service.mcpCall('update_workload', {})).resolves.toEqual({ workload: { id: 'wl-1', name: 'Renamed' } });
  });
});
