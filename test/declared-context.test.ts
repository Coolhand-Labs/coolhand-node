import { withContext, getCurrentDeclared, snapshotDeclared, consumeDeclared } from '../src/utils/declared-context';
import { keyProblem } from '../src/utils/entity-key';
import { LoggingService } from '../src/services/LoggingService';
import { RequestMonitoringService, _resetActiveOwner } from '../src/services/RequestMonitoringService';
import { PatternMatchingService } from '../src/services/PatternMatchingService';
import { CoolhandAPIPattern, CoolhandCallData, CoolhandMatchedPattern } from '../src/types';

const nodeHttps = require('https');
const nodeHttp = require('http');
const originalHttpsRequest = nodeHttps.request;
const originalHttpsGet = nodeHttps.get;
const originalHttpRequest = nodeHttp.request;
const originalHttpGet = nodeHttp.get;
const originalFetch = (global as any).fetch;

function callData(overrides: Partial<CoolhandCallData> = {}): CoolhandCallData {
  return {
    id: 1,
    timestamp: '2026-01-01T00:00:00Z',
    method: 'POST',
    url: 'https://api.test.com/v1/test',
    headers: {},
    request_body: { prompt: 'hi' },
    response_body: { ok: true },
    response_headers: {},
    status_code: 200,
    protocol: 'fetch',
    ...overrides
  };
}

afterEach(() => {
  (global as any).fetch = originalFetch;
  Object.defineProperty(nodeHttps, 'request', { value: originalHttpsRequest, writable: true, configurable: true });
  Object.defineProperty(nodeHttps, 'get', { value: originalHttpsGet, writable: true, configurable: true });
  Object.defineProperty(nodeHttp, 'request', { value: originalHttpRequest, writable: true, configurable: true });
  Object.defineProperty(nodeHttp, 'get', { value: originalHttpGet, writable: true, configurable: true });
  jest.restoreAllMocks();
});

describe('withContext', () => {
  it('has no declaration outside a block', () => {
    expect(getCurrentDeclared()).toBeUndefined();
  });

  it('declares reporter, workload and template inside the block and returns fn result', () => {
    const result = withContext(
      { reporter: 'squishling', workload: { key: 'Parser#call', name: 'Parser#call' }, template: { key: 'Parser#call/squish:L2' } },
      () => getCurrentDeclared()
    );
    expect(result).toEqual({
      reporter: 'squishling',
      workload: { key: 'Parser#call', name: 'Parser#call' },
      template: { key: 'Parser#call/squish:L2' }
    });
    expect(getCurrentDeclared()).toBeUndefined();
  });

  it('keeps the declaration across awaits', async () => {
    const seen = await withContext({ workload: { key: 'w' } }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      await Promise.resolve();
      return getCurrentDeclared();
    });
    expect(seen).toEqual({ workload: { key: 'w' } });
  });

  it('forwards only the permitted fields', () => {
    const seen = withContext(
      { workload: { key: 'w', description: 'd', extra: 1 } as any, template: { key: 't', description: 'nope' } as any } as any,
      () => getCurrentDeclared()
    );
    expect(seen).toEqual({ workload: { key: 'w', description: 'd' }, template: { key: 't' } });
  });

  describe('nesting', () => {
    it('lets the innermost value win per top-level field', () => {
      const seen = withContext({ reporter: 'a', workload: { key: 'w1' } }, () =>
        withContext({ reporter: 'b' }, () => getCurrentDeclared())
      );
      expect(seen).toEqual({ reporter: 'b', workload: { key: 'w1' } });
    });

    it('replaces workload/template wholesale instead of key-merging', () => {
      const seen = withContext({ workload: { id: 'x', name: 'N' }, template: { id: 't1' } }, () =>
        withContext({ workload: { key: 'y' }, template: { key: 't2' } }, () => getCurrentDeclared())
      );
      expect(seen).toEqual({ workload: { key: 'y' }, template: { key: 't2' } });
    });

    it('does not inherit the outer template when only a workload is set', () => {
      const seen = withContext({ workload: { key: 'w1' }, template: { key: 't1' } }, () =>
        withContext({ workload: { key: 'w2' } }, () => getCurrentDeclared())
      );
      expect(seen).toEqual({ workload: { key: 'w2' } });
    });

    it('inherits the outer workload and template when the inner block sets neither', () => {
      const seen = withContext({ workload: { key: 'w1' }, template: { key: 't1' } }, () =>
        withContext({ reporter: 'r' }, () => getCurrentDeclared())
      );
      expect(seen).toEqual({ reporter: 'r', workload: { key: 'w1' }, template: { key: 't1' } });
    });

    it('lets an inner template key use the enclosing workload', () => {
      const seen = withContext({ workload: { key: 'w1' } }, () =>
        withContext({ template: { key: 't1' } }, () => getCurrentDeclared())
      );
      expect(seen).toEqual({ workload: { key: 'w1' }, template: { key: 't1' } });
    });
  });

  describe('validation (thrown before fn runs)', () => {
    const cases: Array<[string, any]> = [
      ['a non-object context', 'nope'],
      ['a non-object workload', { workload: 'w' }],
      ['an array template', { workload: { key: 'w' }, template: ['t'] }],
      ['a workload with neither id nor key', { workload: { name: 'n' } }],
      ['a blank id with no key', { workload: { id: '   ' } }],
      ['a non-string key with no id', { workload: { key: 42 } }],
      ['a key over 255 chars', { workload: { key: 'a'.repeat(256) } }],
      ['a key with a control char', { workload: { key: 'a\nb' } }],
      ['a key with a zero-width char', { workload: { key: 'a​b' } }],
      ['a key with leading whitespace', { workload: { key: ' a' } }],
      ['a key with trailing whitespace', { workload: { key: 'a ' } }],
      ['a key with a leading slash', { workload: { key: '/a' } }],
      ['a key with a trailing slash', { workload: { key: 'a/' } }],
      ['a key with a doubled slash', { workload: { key: 'a//b' } }],
      ['a key with a lone surrogate', { workload: { key: 'a\uD800b' } }],
      ['a description over 1000 chars', { workload: { key: 'w', description: 'd'.repeat(1001) } }],
      ['a template key with no workload', { template: { key: 't' } }],
      ['a non-string reporter', { reporter: 5, workload: { key: 'w' } }]
    ];

    it.each(cases)('rejects %s', (_label, ctx) => {
      const fn = jest.fn();
      expect(() => withContext(ctx, fn)).toThrow();
      expect(fn).not.toHaveBeenCalled();
    });

    it('throws synchronously even when fn is async', () => {
      expect(() => withContext({ workload: 'bad' } as any, async () => 1)).toThrow(/workload/);
    });

    it('accepts #, :, · and inner slashes in keys', () => {
      expect(() => withContext({ workload: { key: 'Parser#call' }, template: { key: 'Parser#call/squish:L2 · x' } }, () => 1)).not.toThrow();
    });

    it('accepts a template id with no workload', () => {
      expect(withContext({ template: { id: 'abc123' } }, () => getCurrentDeclared())).toEqual({ template: { id: 'abc123' } });
    });

    it('treats a blank id as not given when a key is present', () => {
      expect(withContext({ workload: { id: ' ', key: 'w' } }, () => getCurrentDeclared())).toEqual({ workload: { key: 'w' } });
    });

    it('counts the 255-character limit in code points, not UTF-16 units', () => {
      expect(keyProblem('😀'.repeat(255))).toBeNull();
      expect(keyProblem('😀'.repeat(256))).toMatch(/at most 255/);
    });

    it('treats an empty declaration as nothing declared', () => {
      expect(withContext({}, () => getCurrentDeclared())).toBeUndefined();
    });

    it('keyProblem returns null for a good key', () => {
      expect(keyProblem('Parser#call/squish:L2')).toBeNull();
    });
  });
});

describe('LoggingService payload', () => {
  function captureFetch(response: any = { id: 1 }): { body: () => any } {
    let body: any;
    (global as any).fetch = jest.fn().mockImplementation(async (_url: string, init: any) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => response, text: async () => JSON.stringify(response) };
    });
    return { body: () => body };
  }

  it('puts declared at the top level of llm_request_log, beside raw_request and collector', async () => {
    const seen = captureFetch();
    const service = new LoggingService({ apiKey: 'k', silent: true });

    await withContext({ reporter: 'squishling', workload: { key: 'W' }, template: { key: 'W/t' } }, () =>
      service.logRequestToAPI(callData())
    );

    const log = seen.body().llm_request_log;
    expect(log.declared).toEqual({ reporter: 'squishling', workload: { key: 'W' }, template: { key: 'W/t' } });
    expect(Object.keys(log).sort()).toEqual(['collector', 'declared', 'raw_request']);
    expect(log.raw_request.declared).toBeUndefined();
  });

  it('omits declared entirely when no context is active', async () => {
    const seen = captureFetch();
    await new LoggingService({ apiKey: 'k', silent: true }).logRequestToAPI(callData());
    expect('declared' in seen.body().llm_request_log).toBe(false);
  });

  it('logs response warnings without throwing', async () => {
    captureFetch({ id: 1, warnings: ['declaration ignored: cap reached'] });
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const service = new LoggingService({ apiKey: 'k', silent: false });
    jest.spyOn(console, 'log').mockImplementation();

    await expect(service.logRequestToAPI(callData())).resolves.toEqual(expect.objectContaining({ id: 1 }));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('declaration ignored: cap reached'));
  });

  it('logs object-shaped warnings by message', async () => {
    captureFetch({ id: 1, warnings: [{ message: 'cap reached' }] });
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();

    await new LoggingService({ apiKey: 'k', silent: false }).logRequestToAPI(callData());

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cap reached'));
  });

  it('uses the interception-time snapshot, not the context active when sending', async () => {
    const seen = captureFetch();
    const service = new LoggingService({ apiKey: 'k', silent: true });
    const data = callData();

    withContext({ workload: { key: 'captured' } }, () => snapshotDeclared(data));

    // Sent later, outside (and under a different) context.
    await withContext({ workload: { key: 'sending' } }, () => service.logRequestToAPI(data));

    expect(seen.body().llm_request_log.declared).toEqual({ workload: { key: 'captured' } });
  });

  it('does not attach a later context to a call snapshotted with no declaration', () => {
    const data = callData();
    snapshotDeclared(data);
    withContext({ workload: { key: 'later' } }, () => {
      expect(consumeDeclared(data)).toBeUndefined();
    });
  });
});

describe('snapshot survives async, detached sending', () => {
  const pattern: CoolhandAPIPattern = { name: 'TestAPI', domains: ['api.test.com'], paths: ['/v1/test'], headers: {} };
  const matched: CoolhandMatchedPattern = { pattern, matchType: 'domain', matchValue: 'api.test.com' };

  it('keeps the declaration for a fetch whose body finishes after the block has exited', async () => {
    const posts: any[] = [];
    let resolveBody: (text: string) => void = () => {};
    const bodyPromise = new Promise<string>((resolve) => { resolveBody = resolve; });

    (global as any).fetch = jest.fn().mockImplementation(async (url: string, init: any) => {
      if (String(url).includes('coolhandlabs.com')) {
        posts.push(JSON.parse(init.body));
        return { ok: true, status: 200, json: async () => ({ id: 1 }), text: async () => '{"id":1}' };
      }
      return {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: () => ({ text: () => bodyPromise })
      };
    });

    const patterns = {
      matchesAPIPattern: jest.fn(),
      matchesAPIPatternFromURL: jest.fn().mockReturnValue(matched),
      sanitizeHeaders: jest.fn((h: any) => ({ ...h })),
      sanitizeURL: jest.fn((u: string) => u),
      sanitizeBody: jest.fn((b: any) => b)
    } as unknown as PatternMatchingService;

    _resetActiveOwner();
    const monitor = new RequestMonitoringService(patterns, true);
    const logging = new LoggingService({ apiKey: 'k', silent: true });
    monitor.setSelfApiEndpoint(logging.getApiEndpoint());
    // A background batcher: completed calls are queued and sent later by a flush that runs outside
    // any context (as a timer or worker would). Reading the store at send time would find nothing.
    const queue: Array<[CoolhandCallData, CoolhandMatchedPattern | undefined]> = [];
    monitor.onRequestComplete = (data, mp) => { queue.push([data, mp]); };
    monitor.setupMonitoring();

    // The host call happens inside the block; the block (and its store) is gone before the body ends.
    await withContext({ reporter: 'squishling', workload: { key: 'Parser#call' } }, async () => {
      await (globalThis as any).fetch('https://api.test.com/v1/test', { method: 'POST', body: '{"a":1}' });
    });
    expect(getCurrentDeclared()).toBeUndefined();

    resolveBody('{"result":"ok"}');
    const start = Date.now();
    while (queue.length === 0 && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(queue).toHaveLength(1);
    await new Promise<void>((resolve) => setImmediate(() => {
      expect(getCurrentDeclared()).toBeUndefined();
      void Promise.all(queue.map(([data, mp]) => logging.logRequestToAPI(data, mp, 'manual'))).then(() => resolve());
    }));

    expect(posts).toHaveLength(1);
    expect(posts[0].llm_request_log.declared).toEqual({ reporter: 'squishling', workload: { key: 'Parser#call' } });
    expect(posts[0].llm_request_log.raw_request.response_body).toEqual({ result: 'ok' });
  });
});
