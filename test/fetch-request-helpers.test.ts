import {
  isRequestLike,
  headersToRecord,
  getFetchURL,
  getFetchMethod,
  getFetchHeaders,
  getFetchRequestBody
} from '../src/utils/fetch-request-helpers';
import { MAX_DECOMPRESSED_BYTES } from '../src/utils/decompress';

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

  it('decodes a Uint8Array body as text instead of "123,34,..." (#250)', async () => {
    const body = new TextEncoder().encode('{"a":1}');
    expect(await getFetchRequestBody('https://api.test.com', { body })).toBe('{"a":1}');
  });

  it('decodes only the viewed window of a Buffer/typed array body (#250)', async () => {
    const backing = Buffer.from('xx{"a":1}yy');
    const view = new Uint8Array(backing.buffer, backing.byteOffset + 2, 7);
    expect(await getFetchRequestBody('https://api.test.com', { body: view })).toBe('{"a":1}');
  });

  it('decodes an ArrayBuffer and URLSearchParams body (#250)', async () => {
    const ab = new TextEncoder().encode('hello').buffer as ArrayBuffer;
    expect(await getFetchRequestBody('https://api.test.com', { body: ab })).toBe('hello');
    expect(await getFetchRequestBody('https://api.test.com', { body: new URLSearchParams({ a: '1' }) })).toBe('a=1');
  });

  it('reads a text Blob body, capped at the byte limit (#254)', async () => {
    expect(await getFetchRequestBody('https://api.test.com', { body: new Blob(['{"a":1}'], { type: 'application/json' }) })).toBe('{"a":1}');
    expect(await getFetchRequestBody('https://api.test.com', { body: new Blob(['{"a":1}']) })).toBe('{"a":1}');
    const big = new Blob(['x'.repeat(MAX_DECOMPRESSED_BYTES + 100)]);
    expect((await getFetchRequestBody('https://api.test.com', { body: big }))?.length).toBe(MAX_DECOMPRESSED_BYTES);
  });

  it('does not read binary Blob bodies (#254)', async () => {
    expect(await getFetchRequestBody('https://api.test.com', { body: new Blob(['x'], { type: 'image/png' }) })).toBeNull();
  });

  it('serializes FormData string fields, skipping file parts (#254)', async () => {
    const form = new FormData();
    form.append('model', 'gpt-4');
    form.append('tag', 'a');
    form.append('tag', 'b');
    form.append('file', new Blob(['binary']), 'x.bin');
    expect(JSON.parse((await getFetchRequestBody('https://api.test.com', { body: form })) as string))
      .toEqual({ model: 'gpt-4', tag: ['a', 'b'] });
  });

  it('serializes a FormData with a very large number of repeated keys in linear time', async () => {
    const form = new FormData();
    for (let i = 0; i < 50_000; i++) { form.append('k', 'v'); }
    const start = Date.now();
    const parsed = JSON.parse((await getFetchRequestBody('https://api.test.com', { body: form })) as string);
    expect(parsed.k).toHaveLength(50_000);
    // The quadratic version took seconds at this size (3.6 s measured); linear is a few ms.
    expect(Date.now() - start).toBeLessThan(1500);
  });

  it('keeps FormData fields named like Object.prototype members (#254)', async () => {
    const form = new FormData();
    form.append('constructor', 'a');
    form.append('toString', 'b');
    expect(JSON.parse((await getFetchRequestBody('https://api.test.com', { body: form })) as string))
      .toEqual({ constructor: 'a', toString: 'b' });
  });

  it('caps FormData field capture at the byte limit (#254)', async () => {
    const form = new FormData();
    form.append('small', 'ok');
    form.append('huge', 'x'.repeat(MAX_DECOMPRESSED_BYTES + 1));
    expect(JSON.parse((await getFetchRequestBody('https://api.test.com', { body: form })) as string)).toEqual({ small: 'ok' });
  });

  it('does not capture ReadableStream bodies (#254)', async () => {
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x')); c.close(); } });
    expect(await getFetchRequestBody('https://api.test.com', { body, duplex: 'half' } as RequestInit)).toBeNull();
  });

  it('does not throw for a null init body (#250)', async () => {
    expect(await getFetchRequestBody('https://api.test.com', { body: null })).toBeNull();
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
