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
 * Upper bound on decompressed/buffered response bodies, shared by zlib's
 * `maxOutputLength` here and by the raw response-chunk buffering in
 * global-monitor.ts / RequestMonitoringService.ts. Caps decompression-bomb
 * amplification and unbounded in-memory buffering to a single sane number.
 */
export const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB

// A throw here would otherwise escape the zlib callback as an uncaughtException
// (it runs after the wrapping Promise executor has already returned, so the
// Promise machinery can't catch it) — guard it and degrade gracefully instead.
function resolveDecompressed(result: Buffer, resolve: (value: string) => void, onWarn?: (msg: string) => void): void {
  try {
    resolve(result.toString('utf-8'));
  } catch (err: any) {
    onWarn?.(`⚠️ Decompressed output too large to convert to a string: ${err?.message}`);
    resolve('');
  }
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
      zlib.gunzip(buffer, { maxOutputLength: MAX_DECOMPRESSED_BYTES }, (err, result) => {
        if (err) {
          onWarn?.(`⚠️ Decompression failed for encoding '${enc}': ${err.message}`);
          resolve(buffer.toString('utf-8'));
        } else {
          resolveDecompressed(result, resolve, onWarn);
        }
      });
    });
  }

  if (enc === 'deflate') {
    // RFC 1950 (zlib-wrapped) first; fall back to RFC 1951 (raw deflate)
    // as some servers (older IIS, some load balancers) send raw deflate despite
    // the content-encoding header implying the zlib wrapper.
    return new Promise((resolve) => {
      zlib.inflate(buffer, { maxOutputLength: MAX_DECOMPRESSED_BYTES }, (err, result) => {
        if (!err) {
            resolveDecompressed(result, resolve, onWarn);
            return;
          }
        zlib.inflateRaw(buffer, { maxOutputLength: MAX_DECOMPRESSED_BYTES }, (rawErr, rawResult) => {
          if (rawErr) {
            onWarn?.(`⚠️ Decompression failed for encoding 'deflate': ${rawErr.message}`);
            resolve(buffer.toString('utf-8'));
          } else {
            resolveDecompressed(rawResult, resolve, onWarn);
          }
        });
      });
    });
  }

  if (enc === 'br') {
    return new Promise((resolve) => {
      zlib.brotliDecompress(buffer, { maxOutputLength: MAX_DECOMPRESSED_BYTES }, (err, result) => {
        if (err) {
          onWarn?.(`⚠️ Decompression failed for encoding '${enc}': ${err.message}`);
          resolve(buffer.toString('utf-8'));
        } else {
          resolveDecompressed(result, resolve, onWarn);
        }
      });
    });
  }

  return buffer.toString('utf-8');
}
