import { computeSelfEndpoint, isSelfEndpointURL } from '../src/utils/self-endpoint';

describe('computeSelfEndpoint', () => {
  it('infers the default HTTPS port when none is specified', () => {
    expect(computeSelfEndpoint('https://coolhandlabs.com/api/v2/llm_request_logs')).toEqual({
      hostname: 'coolhandlabs.com',
      port: '443'
    });
  });

  it('infers the default HTTP port when none is specified', () => {
    expect(computeSelfEndpoint('http://localhost/api/v2/llm_request_logs')).toEqual({
      hostname: 'localhost',
      port: '80'
    });
  });

  it('uses an explicit port when present', () => {
    expect(computeSelfEndpoint('http://localhost:3000/api/v2/llm_request_logs')).toEqual({
      hostname: 'localhost',
      port: '3000'
    });
  });

  it('lowercases the hostname', () => {
    expect(computeSelfEndpoint('https://Coolhandlabs.COM/api/v2/llm_request_logs')?.hostname).toBe('coolhandlabs.com');
  });

  it('returns null for an invalid URL', () => {
    expect(computeSelfEndpoint('not a url')).toBeNull();
  });
});

describe('isSelfEndpointURL', () => {
  it('returns false when self is null', () => {
    expect(isSelfEndpointURL('http://localhost:3000/foo', null)).toBe(false);
  });

  it('matches on hostname + explicit port', () => {
    const self = computeSelfEndpoint('http://localhost:3000/api/v2/llm_request_logs');
    expect(isSelfEndpointURL('http://localhost:3000/anything', self)).toBe(true);
  });

  it('does not match a different port on the same hostname', () => {
    // The core repro: a localhost:3000 baseUrl must not blanket-exclude a different
    // localhost service (e.g. a local Ollama proxy on 11434) matched by a custom pattern.
    const self = computeSelfEndpoint('http://localhost:3000/api/v2/llm_request_logs');
    expect(isSelfEndpointURL('http://localhost:11434/api/generate', self)).toBe(false);
  });

  it('does not match a different hostname on the same port', () => {
    const self = computeSelfEndpoint('http://localhost:3000/api/v2/llm_request_logs');
    expect(isSelfEndpointURL('http://example.com:3000/foo', self)).toBe(false);
  });

  it('matches using default ports when neither URL specifies one', () => {
    const self = computeSelfEndpoint('https://coolhandlabs.com/api/v2/llm_request_logs');
    expect(isSelfEndpointURL('https://coolhandlabs.com/anything', self)).toBe(true);
  });

  it('matches case-insensitively on hostname', () => {
    const self = computeSelfEndpoint('https://coolhandlabs.com/api/v2/llm_request_logs');
    expect(isSelfEndpointURL('https://COOLHANDLABS.COM/anything', self)).toBe(true);
  });

  it('returns false for an unparseable URL', () => {
    const self = computeSelfEndpoint('http://localhost:3000/api/v2/llm_request_logs');
    expect(isSelfEndpointURL('not a url', self)).toBe(false);
  });
});
