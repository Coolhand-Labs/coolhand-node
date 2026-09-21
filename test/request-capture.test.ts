import { CappedBuffer } from '../src/utils/capped-buffer';
import { captureRequestChunk, parseAndSanitizeBody, settleWithin, toChunkBuffer } from '../src/utils/request-capture';

describe('toChunkBuffer', () => {
  it('returns null for the callback in req.end(callback) and other non-chunk args', () => {
    expect(toChunkBuffer(() => undefined, undefined)).toBeNull();
    expect(toChunkBuffer(undefined, undefined)).toBeNull();
    expect(toChunkBuffer({}, undefined)).toBeNull();
  });

  it('honors the encoding of a string chunk', () => {
    expect(toChunkBuffer('68656c6c6f', 'hex')?.toString('utf-8')).toBe('hello');
  });

  it('ignores an encoding argument that is really a callback', () => {
    expect(toChunkBuffer('hi', () => undefined)?.toString('utf-8')).toBe('hi');
  });

  it('respects the window of a typed array view', () => {
    const backing = Buffer.from('xxhiyy');
    expect(toChunkBuffer(new Uint8Array(backing.buffer, backing.byteOffset + 2, 2), undefined)?.toString('utf-8')).toBe('hi');
  });
});

describe('captureRequestChunk', () => {
  it('reports but never throws when the buffer rejects a chunk', () => {
    const buffer = { push: () => { throw new Error('boom'); } } as unknown as CappedBuffer;
    const onError = jest.fn();

    expect(() => captureRequestChunk(buffer, 'x', undefined, onError)).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('parseAndSanitizeBody', () => {
  it('fails closed (null) when the sanitizer throws', () => {
    const onError = jest.fn();
    const result = parseAndSanitizeBody('{"a":1}', () => { throw new Error('boom'); }, onError);

    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('settleWithin', () => {
  it('resolves when the promise settles, including on rejection', async () => {
    await expect(settleWithin(Promise.resolve(1), 1000)).resolves.toBeUndefined();
    await expect(settleWithin(Promise.reject(new Error('x')), 1000)).resolves.toBeUndefined();
  });

  it('gives up waiting on a promise that never settles, and says so via onTimeout', async () => {
    const onTimeout = jest.fn();
    const start = Date.now();
    await settleWithin(new Promise(() => undefined), 20, onTimeout);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('does not call onTimeout when the promise settles in time', async () => {
    const onTimeout = jest.fn();
    await settleWithin(Promise.resolve(), 1000, onTimeout);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
