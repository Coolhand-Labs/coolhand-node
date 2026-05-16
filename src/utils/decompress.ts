// zlib is loaded lazily so this module is safe to import in Edge/fetch-only
// runtimes where Node core modules are unavailable at load time.
let _zlib: typeof import('zlib') | null | undefined;

async function loadZlib(): Promise<typeof import('zlib') | null> {
  if (_zlib !== undefined) { return _zlib; }
  try {
    _zlib = await import('zlib');
  } catch {
    _zlib = null;
  }
  return _zlib;
}

/**
 * Decompresses a response buffer according to its Content-Encoding.
 * Handles gzip, x-gzip, deflate (RFC 1950 with raw RFC 1951 fallback), and br.
 * Unknown or absent encodings are returned as-is (UTF-8 string).
 * Falls back to the raw UTF-8 string when zlib is unavailable (Edge runtime).
 *
 * @param onWarn  Optional callback for decompression failure warnings.
 */
export async function decompressBuffer(
  buffer: Buffer,
  encoding: string | undefined,
  onWarn?: (msg: string) => void
): Promise<string> {
  if (!encoding) { return buffer.toString('utf-8'); }

  const zlib = await loadZlib();
  if (!zlib) { return buffer.toString('utf-8'); }

  const enc = encoding.trim().toLowerCase();

  if (enc === 'gzip' || enc === 'x-gzip') {
    return new Promise((resolve) => {
      zlib.gunzip(buffer, (err, result) => {
        if (err) {
          onWarn?.(`⚠️ Decompression failed for encoding '${enc}': ${err.message}`);
          resolve(buffer.toString('utf-8'));
        } else {
          resolve(result.toString('utf-8'));
        }
      });
    });
  }

  if (enc === 'deflate') {
    // RFC 1950 (zlib-wrapped) first; fall back to RFC 1951 (raw deflate)
    // as some servers (older IIS, some load balancers) send raw deflate despite
    // the content-encoding header implying the zlib wrapper.
    return new Promise((resolve) => {
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
    });
  }

  if (enc === 'br') {
    return new Promise((resolve) => {
      zlib.brotliDecompress(buffer, (err, result) => {
        if (err) {
          onWarn?.(`⚠️ Decompression failed for encoding '${enc}': ${err.message}`);
          resolve(buffer.toString('utf-8'));
        } else {
          resolve(result.toString('utf-8'));
        }
      });
    });
  }

  return buffer.toString('utf-8');
}
