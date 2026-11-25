import { buildRequestURL } from '../src/utils/build-url';

describe('buildRequestURL', () => {
  it.each([
    ['slash-less path', { hostname: 'bedrock-runtime.us-east-1.amazonaws.com', path: 'v1/messages' }, 'https://bedrock-runtime.us-east-1.amazonaws.com/v1/messages'],
    ['leading-slash path stays unchanged', { hostname: 'api.test.com', path: '/v1/messages' }, 'https://api.test.com/v1/messages'],
    ['query-only path', { hostname: 'api.test.com', path: '?a=1' }, 'https://api.test.com/?a=1'],
    ['no path', { hostname: 'api.test.com' }, 'https://api.test.com/'],
    ['empty-string path', { hostname: 'api.test.com', path: '' }, 'https://api.test.com/'],
    ['port with slash-less path', { hostname: 'api.test.com', port: 8443, path: 'v1/messages' }, 'https://api.test.com:8443/v1/messages'],
    ['IPv6 host with slash-less path', { hostname: '::1', port: 3000, path: 'x' }, 'https://[::1]:3000/x'],
    ['double leading slash is left untouched', { hostname: 'api.test.com', path: '//x' }, 'https://api.test.com//x']
  ])('%s', (_name, options, expected) => {
    expect(buildRequestURL(options, 'https')).toBe(expected);
  });

  it('prefers href over host and path', () => {
    expect(buildRequestURL({ href: 'https://a.test/x', hostname: 'b.test', path: 'y' }, 'https')).toBe('https://a.test/x');
  });

  it('does not throw on a non-string path (Node coerces it; the interceptor must not break the host call)', () => {
    const path = { toString: () => 'v1/messages' } as unknown as string;
    expect(buildRequestURL({ hostname: 'api.test.com', path }, 'https')).toBe('https://api.test.com/v1/messages');
  });
});
