import {
  isRequestLike,
  headersToRecord,
  getFetchURL,
  getFetchMethod,
  getFetchHeaders,
  getFetchRequestBody
} from '../src/utils/fetch-request-helpers';

describe('isRequestLike', () => {
  it('returns true for a real Request instance', () => {
    expect(isRequestLike(new Request('https://api.test.com/v1/test'))).toBe(true);
  });

  it('returns false for a string, URL, null, or plain object missing url/method', () => {
    expect(isRequestLike('https://api.test.com')).toBe(false);
    expect(isRequestLike(new URL('https://api.test.com'))).toBe(false);
    expect(isRequestLike(null)).toBe(false);
    expect(isRequestLike({ url: 'https://api.test.com' })).toBe(false);
  });
});

describe('getFetchURL', () => {
  it('returns a string url unchanged', () => {
    expect(getFetchURL('https://api.test.com/v1/test')).toBe('https://api.test.com/v1/test');
  });

  it('returns URL.toString() for a URL instance', () => {
    expect(getFetchURL(new URL('https://api.test.com/v1/test'))).toBe('https://api.test.com/v1/test');
  });

  it('returns request.url (not "[object Request]") for a Request instance', () => {
    const req = new Request('https://api.test.com/v1/test');
    expect(getFetchURL(req)).toBe('https://api.test.com/v1/test');
    expect(getFetchURL(req)).not.toBe(req.toString());
  });
});

describe('getFetchMethod', () => {
  it('prefers init.method over the Request object method', () => {
    const req = new Request('https://api.test.com', { method: 'POST' });
    expect(getFetchMethod(req, { method: 'PUT' })).toBe('PUT');
  });

  it('falls back to the Request object method when init.method is absent', () => {
    const req = new Request('https://api.test.com', { method: 'POST' });
    expect(getFetchMethod(req, {})).toBe('POST');
  });

  it('defaults to GET for a plain string url with no method anywhere', () => {
    expect(getFetchMethod('https://api.test.com', {})).toBe('GET');
  });
});

describe('getFetchHeaders', () => {
  it('uses init.headers when provided, ignoring the Request object headers entirely', () => {
    const req = new Request('https://api.test.com', { headers: { 'x-stale': 'drop-me' } });
    const headers = getFetchHeaders(req, { headers: { authorization: 'Bearer new' } });
    expect(headers).toMatchObject({ authorization: 'Bearer new' });
    expect(headers).not.toHaveProperty('x-stale');
  });

  it('falls back to the Request object headers when init.headers is absent', () => {
    const req = new Request('https://api.test.com', { headers: { authorization: 'Bearer token' } });
    expect(getFetchHeaders(req, {})).toMatchObject({ authorization: 'Bearer token' });
  });

  it('returns an empty object for a plain string url with no headers anywhere', () => {
    expect(getFetchHeaders('https://api.test.com', {})).toEqual({});
  });
});

describe('getFetchRequestBody', () => {
  it('uses init.body when provided', async () => {
    expect(await getFetchRequestBody('https://api.test.com', { body: '{"a":1}' })).toBe('{"a":1}');
  });

  it('returns null when init.body is explicitly null', async () => {
    expect(await getFetchRequestBody('https://api.test.com', { body: null })).toBeNull();
  });

  it('reads the Request object body when init.body is absent', async () => {
    const req = new Request('https://api.test.com', { method: 'POST', body: '{"a":1}' });
    expect(await getFetchRequestBody(req, {})).toBe('{"a":1}');
  });

  it('returns null for a plain string url with no body anywhere', async () => {
    expect(await getFetchRequestBody('https://api.test.com', {})).toBeNull();
  });
});

describe('headersToRecord', () => {
  it('converts a Headers instance to a plain record', () => {
    expect(headersToRecord(new Headers({ authorization: 'Bearer token' }))).toEqual({ authorization: 'Bearer token' });
  });

  it('converts an array-of-entries form to a plain record', () => {
    expect(headersToRecord([['authorization', 'Bearer token']])).toEqual({ authorization: 'Bearer token' });
  });

  it('returns an empty object for null/undefined', () => {
    expect(headersToRecord(null)).toEqual({});
    expect(headersToRecord(undefined)).toEqual({});
  });

  it('shallow-copies a plain object', () => {
    expect(headersToRecord({ authorization: 'Bearer token' })).toEqual({ authorization: 'Bearer token' });
  });
});
