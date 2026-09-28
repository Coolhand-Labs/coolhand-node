import { readCappedResponseText } from '../src/utils/capped-fetch-body';

describe('readCappedResponseText', () => {
  it('reads a streamed body up to the cap and reports truncation', async () => {
    const onTruncate = jest.fn();
    const text = await readCappedResponseText(new Response('a'.repeat(100)), 10, onTruncate);

    expect(text).toBe('a'.repeat(10));
    expect(onTruncate).toHaveBeenCalledTimes(1);
  });

  it('skips reading a polyfilled body whose Content-Length exceeds the cap (#254)', async () => {
    const onTruncate = jest.fn();
    const text = jest.fn(() => Promise.resolve('c'.repeat(100)));
    const responseLike = { body: {}, headers: new Headers({ 'content-length': '100' }), text } as unknown as Response;

    expect(await readCappedResponseText(responseLike, 10, onTruncate)).toBe('');
    expect(text).not.toHaveBeenCalled();
    expect(onTruncate).toHaveBeenCalledTimes(1);
  });

  it('does not flag truncation for a bodyless response (HEAD/204) that carries a large Content-Length (#254)', async () => {
    const onTruncate = jest.fn();
    const responseLike = { body: null, headers: new Headers({ 'content-length': '100' }), text: () => Promise.resolve('') } as unknown as Response;

    expect(await readCappedResponseText(responseLike, 10, onTruncate)).toBe('');
    expect(onTruncate).not.toHaveBeenCalled();
  });

  it('still reads a polyfilled body whose Content-Length is within the cap (#254)', async () => {
    const text = jest.fn(() => Promise.resolve('short'));
    const responseLike = { body: {}, headers: new Headers({ 'content-length': '5' }), text } as unknown as Response;

    expect(await readCappedResponseText(responseLike, 10)).toBe('short');
    expect(text).toHaveBeenCalledTimes(1);
  });

  it('truncates the .text() fallback when the body is not a readable stream (polyfilled fetch)', async () => {
    const onTruncate = jest.fn();
    const responseLike = { body: null, text: () => Promise.resolve('b'.repeat(100)) } as unknown as Response;

    const text = await readCappedResponseText(responseLike, 10, onTruncate);

    expect(text).toBe('b'.repeat(10));
    expect(onTruncate).toHaveBeenCalledTimes(1);
  });

  it('leaves a body under the cap untouched in the fallback path', async () => {
    const onTruncate = jest.fn();
    const responseLike = { body: null, text: () => Promise.resolve('short') } as unknown as Response;

    expect(await readCappedResponseText(responseLike, 10, onTruncate)).toBe('short');
    expect(onTruncate).not.toHaveBeenCalled();
  });
});
