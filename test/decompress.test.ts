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

  describe('partial (abandoned stream) buffers', () => {
    // Incompressible-ish text so the compressed stream is long enough to cut mid-way.
    const sse = Array.from({ length: 200 }, (_, i) => `data: {"i":${i},"t":"${(i * 7919).toString(36)}"}\n\n`).join('');
    const compressors: Array<[string, (b: Buffer) => Buffer]> = [
      ['gzip', (b) => zlib.gzipSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH })],
      ['deflate', (b) => zlib.deflateSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH })],
      ['br', (b) => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT } })]
    ];

    it.each(compressors)('recovers the decodable prefix of a truncated %s body', async (encoding, compress) => {
      const full = compress(Buffer.from(sse));
      const truncated = full.subarray(0, Math.floor(full.length * 0.6));

      const result = await decompressBuffer(truncated, encoding, undefined, true);

      expect(result.length).toBeGreaterThan(0);
      expect(sse.startsWith(result)).toBe(true);
    });

    it('still falls back to the raw text for a truncated body when not told it is partial', async () => {
      const full = zlib.gzipSync(Buffer.from(sse));
      const onWarn = jest.fn();

      await decompressBuffer(full.subarray(0, Math.floor(full.length * 0.6)), 'gzip', onWarn);

      expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('Decompression failed'));
    });

    it('decodes a complete body identically when flagged partial', async () => {
      expect(await decompressBuffer(zlib.gzipSync(Buffer.from(sse)), 'gzip', undefined, true)).toBe(sse);
    });
  });
});
