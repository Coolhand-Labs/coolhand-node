import { IGNORED_GET_PATH_PATTERNS, IGNORED_ANY_METHOD_PATH_PATTERNS, isNonInferenceURL } from '../src/non-inference-filter';

describe('IGNORED_GET_PATH_PATTERNS', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(IGNORED_GET_PATH_PATTERNS)).toBe(true);
  });

  it('contains exactly two patterns', () => {
    expect(IGNORED_GET_PATH_PATTERNS).toHaveLength(2);
  });

  it('matches /api/directory/servers', () => {
    expect(IGNORED_GET_PATH_PATTERNS[0].test('/api/directory/servers')).toBe(true);
  });

  it('matches /api/directory/servers with query string', () => {
    expect(IGNORED_GET_PATH_PATTERNS[0].test('/api/directory/servers?foo=bar')).toBe(true);
  });

  it('does not match /api/directory/servers/extra', () => {
    expect(IGNORED_GET_PATH_PATTERNS[0].test('/api/directory/servers/extra')).toBe(false);
  });

  it('matches /v1/environments/:id/work/poll', () => {
    expect(IGNORED_GET_PATH_PATTERNS[1].test('/v1/environments/abc123/work/poll')).toBe(true);
  });

  it('matches /v1/environments/:id/work/poll with query string', () => {
    expect(IGNORED_GET_PATH_PATTERNS[1].test('/v1/environments/abc123/work/poll?timeout=20')).toBe(true);
  });

  it('does not match env id containing a slash (two-segment env id)', () => {
    expect(IGNORED_GET_PATH_PATTERNS[1].test('/v1/environments/abc/123/work/poll')).toBe(false);
  });

  it('does not match /v1/environments/:id/work/poll/extra', () => {
    expect(IGNORED_GET_PATH_PATTERNS[1].test('/v1/environments/abc123/work/poll/extra')).toBe(false);
  });
});

describe('IGNORED_ANY_METHOD_PATH_PATTERNS', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(IGNORED_ANY_METHOD_PATH_PATTERNS)).toBe(true);
  });

  it('contains exactly one pattern', () => {
    expect(IGNORED_ANY_METHOD_PATH_PATTERNS).toHaveLength(1);
  });

  it('matches /api/event_logging/v2/batch', () => {
    expect(IGNORED_ANY_METHOD_PATH_PATTERNS[0].test('/api/event_logging/v2/batch')).toBe(true);
  });

  it('matches any path under /api/event_logging/', () => {
    expect(IGNORED_ANY_METHOD_PATH_PATTERNS[0].test('/api/event_logging/v3/other')).toBe(true);
  });

  it('does not match /api/event_logging (missing trailing slash)', () => {
    expect(IGNORED_ANY_METHOD_PATH_PATTERNS[0].test('/api/event_logging')).toBe(false);
  });
});

describe('isNonInferenceURL', () => {
  describe('drops event_logging paths regardless of method', () => {
    it('drops POST to /api/event_logging/v2/batch', () => {
      expect(isNonInferenceURL('https://api.anthropic.com/api/event_logging/v2/batch', 'POST')).toBe(true);
    });

    it('drops GET to /api/event_logging/v2/batch', () => {
      expect(isNonInferenceURL('https://api.anthropic.com/api/event_logging/v2/batch', 'GET')).toBe(true);
    });

    it('does not drop POST to a different host with event_logging path', () => {
      expect(isNonInferenceURL('https://api.openai.com/api/event_logging/v2/batch', 'POST')).toBe(false);
    });

    it('does not drop POST to a different Anthropic path', () => {
      expect(isNonInferenceURL('https://api.anthropic.com/v1/messages', 'POST')).toBe(false);
    });
  });

  describe('drops ignored Anthropic GET paths', () => {
    it('drops GET /api/directory/servers', () => {
      expect(isNonInferenceURL('https://api.anthropic.com/api/directory/servers', 'GET')).toBe(true);
    });

    it('drops GET /api/directory/servers with query string', () => {
      expect(isNonInferenceURL('https://api.anthropic.com/api/directory/servers?page=1', 'GET')).toBe(true);
    });

    it('drops GET /v1/environments/:id/work/poll', () => {
      expect(isNonInferenceURL('https://api.anthropic.com/v1/environments/env_abc123/work/poll', 'GET')).toBe(true);
    });

    it('drops GET /v1/environments/:id/work/poll with query string', () => {
      expect(isNonInferenceURL('https://api.anthropic.com/v1/environments/env_abc123/work/poll?timeout=20', 'GET')).toBe(true);
    });

    it('is case-insensitive for method', () => {
      expect(isNonInferenceURL('https://api.anthropic.com/api/directory/servers', 'get')).toBe(true);
    });
  });

  describe('does NOT drop non-matching cases', () => {
    it('does not drop POST to an ignored path', () => {
      expect(isNonInferenceURL('https://api.anthropic.com/api/directory/servers', 'POST')).toBe(false);
    });

    it('does not drop POST to the poll endpoint', () => {
      expect(isNonInferenceURL('https://api.anthropic.com/v1/environments/env_abc123/work/poll', 'POST')).toBe(false);
    });

    it('does not drop GET to a different host (openai.com)', () => {
      expect(isNonInferenceURL('https://api.openai.com/api/directory/servers', 'GET')).toBe(false);
    });

    it('does not drop GET to a different Anthropic path', () => {
      expect(isNonInferenceURL('https://api.anthropic.com/v1/messages', 'GET')).toBe(false);
    });

    it('does not drop GET /api/directory/servers/extra (suffix not allowed)', () => {
      expect(isNonInferenceURL('https://api.anthropic.com/api/directory/servers/extra', 'GET')).toBe(false);
    });

    it('does not drop GET to Bedrock (different host, similar path)', () => {
      expect(isNonInferenceURL('https://bedrock.amazonaws.com/v1/environments/abc/work/poll', 'GET')).toBe(false);
    });

    it('does not drop GET to a subdomain of api.anthropic.com (exact host match)', () => {
      expect(isNonInferenceURL('https://foo.api.anthropic.com/api/directory/servers', 'GET')).toBe(false);
    });

    it('does not drop GET to a host that merely contains api.anthropic.com as a substring', () => {
      expect(isNonInferenceURL('https://api.anthropic.com.evil.com/api/directory/servers', 'GET')).toBe(false);
    });

    it('returns false for malformed URL', () => {
      expect(isNonInferenceURL('not-a-url', 'GET')).toBe(false);
    });
  });
});
