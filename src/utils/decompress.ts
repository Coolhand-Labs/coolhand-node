import * as zlib from 'zlib';

/**
 * Decompresses a response buffer according to its Content-Encoding.
 * Handles gzip, x-gzip, deflate (RFC 1950 with raw RFC 1951 fallback), and br.
 * Unknown or absent encodings are returned as-is (UTF-8 string).
 *
 * @param onWarn  Optional callback for decompression failure warnings.
 */
export function decompressBuffer(
  buffer: Buffer,
  encoding: string | undefined,
  onWarn?: (msg: string) => void
): Promise<string> {
  return new Promise((resolve) => {
    if (!encoding) {
      resolve(buffer.toString('utf-8'));
      return;
    }

    const enc = encoding.trim().toLowerCase();

    if (enc === 'gzip' || enc === 'x-gzip') {
      zlib.gunzip(buffer, (err, result) => {
        if (err) {
          onWarn?.(`⚠️ Decompression failed for encoding '${enc}': ${err.message}`);
          resolve(buffer.toString('utf-8'));
        } else {
          resolve(result.toString('utf-8'));
        }
      });
    } else if (enc === 'deflate') {
      // RFC 1950 (zlib-wrapped) first; fall back to RFC 1951 (raw deflate)
      // as some servers (older IIS, some load balancers) send raw deflate despite
      // the content-encoding header implying the zlib wrapper.
      zlib.inflate(buffer, (err, result) => {
        if (!err) {
          resolve(result.toString('utf-8'));
          return;
        }
        zlib.inflateRaw(buffer, (rawErr, rawResult) => {
          if (rawErr) {
            onWarn?.(`⚠️ Decompression failed for encoding 'deflate': ${rawErr.message}`);
            resolve(buffer.toString('utf-8'));
          } else {
            resolve(rawResult.toString('utf-8'));
          }
        });
      });
    } else if (enc === 'br') {
      zlib.brotliDecompress(buffer, (err, result) => {
        if (err) {
          onWarn?.(`⚠️ Decompression failed for encoding '${enc}': ${err.message}`);
          resolve(buffer.toString('utf-8'));
        } else {
          resolve(result.toString('utf-8'));
        }
      });
    } else {
      resolve(buffer.toString('utf-8'));
    }
  });
}
