import * as zlib from 'zlib';
import { decompressBuffer, MAX_DECOMPRESSED_BYTES } from '../src/utils/decompress';

describe('decompressBuffer', () => {
  const payload = '{"model":"gpt-4","choices":[{"message":{"content":"hello"}}]}';

  it('returns plain text as-is when no encoding is given', async () => {
    const result = await decompressBuffer(Buffer.from(payload), undefined);
    expect(result).toBe(payload);
  });

  it('decompresses gzip', async () => {
    const compressed = zlib.gzipSync(Buffer.from(payload));
    const result = await decompressBuffer(compressed, 'gzip');
    expect(result).toBe(payload);
  });

  it('decompresses x-gzip', async () => {
    const compressed = zlib.gzipSync(Buffer.from(payload));
    const result = await decompressBuffer(compressed, 'x-gzip');
    expect(result).toBe(payload);
  });

  it('decompresses deflate (RFC 1950 zlib-wrapped)', async () => {
    const compressed = zlib.deflateSync(Buffer.from(payload));
    const result = await decompressBuffer(compressed, 'deflate');
    expect(result).toBe(payload);
  });

  it('decompresses deflate (RFC 1951 raw deflate fallback)', async () => {
    const compressed = zlib.deflateRawSync(Buffer.from(payload));
    const result = await decompressBuffer(compressed, 'deflate');
    expect(result).toBe(payload);
  });

  it('decompresses br', async () => {
    const compressed = zlib.brotliCompressSync(Buffer.from(payload));
    const result = await decompressBuffer(compressed, 'br');
    expect(result).toBe(payload);
  });

  it('passes through an unrecognized encoding as plain text', async () => {
    const result = await decompressBuffer(Buffer.from(payload), 'identity');
    expect(result).toBe(payload);
  });

  it('falls back to the raw buffer text when gzip decompression fails', async () => {
    const notGzip = Buffer.from('this is not gzip data');
    const onWarn = jest.fn();
    const result = await decompressBuffer(notGzip, 'gzip', onWarn);
    expect(result).toBe(notGzip.toString('utf-8'));
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('Decompression failed'));
  });

  it('falls back to the raw buffer text when a gzip payload exceeds MAX_DECOMPRESSED_BYTES', async () => {
    // Highly compressible: a single repeated byte compresses to a tiny buffer
    // but decompresses to more than the cap, exercising zlib's maxOutputLength.
    const oversized = Buffer.alloc(MAX_DECOMPRESSED_BYTES + 1024, 'a');
    const compressed = zlib.gzipSync(oversized);
    const onWarn = jest.fn();

    const result = await decompressBuffer(compressed, 'gzip', onWarn);

    // Should resolve (not hang/throw/crash) and gracefully degrade to the
    // raw compressed bytes rather than the full decompressed payload.
    expect(result).toBe(compressed.toString('utf-8'));
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('Decompression failed'));
  }, 20000);
});
