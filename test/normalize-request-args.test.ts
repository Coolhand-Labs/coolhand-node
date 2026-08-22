import { normalizeRequestArgs } from '../src/utils/normalize-request-args';

describe('normalizeRequestArgs', () => {
  it('handles the legacy (options, callback) form', () => {
    const options = { hostname: 'api.test.com', path: '/v1/test', method: 'POST' };
    const callback = jest.fn();

    const result = normalizeRequestArgs(options, callback);

    expect(result.options).toBe(options);
    expect(result.callback).toBe(callback);
  });

  it('handles the (url, callback) form', () => {
    const callback = jest.fn();

    const result = normalizeRequestArgs('https://api.test.com/v1/test', callback);

    expect(result.options).toBe('https://api.test.com/v1/test');
    expect(result.callback).toBe(callback);
  });

  it('handles the (url, options, callback) form, merging url and options', () => {
    const callback = jest.fn();
    const options = { method: 'POST', headers: { 'x-test': '1' } };

    const result = normalizeRequestArgs('https://api.test.com:8443/v1/chat/completions?a=1', options, callback);

    expect(result.callback).toBe(callback);
    expect(result.options).toMatchObject({
      hostname: 'api.test.com',
      port: 8443,
      path: '/v1/chat/completions?a=1',
      method: 'POST',
      headers: { 'x-test': '1' }
    });
  });

  it('does not confuse the real options object for a callback in the 3-arg form', () => {
    const realOptions = { method: 'POST' };
    const realCallback = jest.fn();

    const result = normalizeRequestArgs('https://api.test.com/v1/test', realOptions, realCallback);

    expect(typeof result.callback).toBe('function');
    expect(result.callback).toBe(realCallback);
    expect(result.options).not.toBe(realOptions);
  });

  it('handles the (url, options) form with no callback', () => {
    const result = normalizeRequestArgs('https://api.test.com/v1/test', { method: 'PUT' });

    expect(result.callback).toBeUndefined();
    expect(result.options).toMatchObject({ hostname: 'api.test.com', path: '/v1/test', method: 'PUT' });
  });

  it('handles the (url) form alone', () => {
    const result = normalizeRequestArgs('https://api.test.com/v1/test');

    expect(result.options).toBe('https://api.test.com/v1/test');
    expect(result.callback).toBeUndefined();
  });

  it('accepts a URL instance as the first argument', () => {
    const callback = jest.fn();
    const url = new URL('https://api.test.com/v1/test');

    const result = normalizeRequestArgs(url, { method: 'DELETE' }, callback);

    expect(result.callback).toBe(callback);
    expect(result.options).toMatchObject({ hostname: 'api.test.com', path: '/v1/test', method: 'DELETE' });
  });

  it('strips brackets from IPv6 hostnames', () => {
    const result = normalizeRequestArgs('https://[::1]:8443/v1/test', { method: 'GET' });

    expect(result.options).toMatchObject({ hostname: '::1', port: 8443, path: '/v1/test' });
  });

  it('omits href so downstream URL reconstruction reflects any path override', () => {
    const result = normalizeRequestArgs('https://api.test.com/v1/original', { path: '/v1/overridden' });

    expect(result.options).toMatchObject({ hostname: 'api.test.com', path: '/v1/overridden' });
    expect((result.options as { href?: string }).href).toBeUndefined();
  });

  it('carries URL userinfo through as `auth` when merging the 3-arg form', () => {
    const result = normalizeRequestArgs('https://user:pass@api.test.com/v1/test', { method: 'POST' });

    expect(result.options).toMatchObject({ hostname: 'api.test.com', path: '/v1/test', auth: 'user:pass' });
  });

  it('does not drop the real 3rd-position callback when the middle arg is null/undefined', () => {
    const realCallback = jest.fn();

    const nullResult = normalizeRequestArgs('https://api.test.com/v1/test', null as any, realCallback);
    expect(nullResult.callback).toBe(realCallback);

    const undefinedResult = normalizeRequestArgs('https://api.test.com/v1/test', undefined, realCallback);
    expect(undefinedResult.callback).toBe(realCallback);
  });
});
