/**
 * Accumulates Buffer chunks up to a byte cap, silently dropping (or
 * partially truncating) anything beyond it instead of growing unbounded.
 * Shared by global-monitor.ts and RequestMonitoringService.ts to cap raw
 * response buffering independent of decompression (see issue #112).
 */
export class CappedBuffer {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  private truncated = false;

  constructor(private readonly maxBytes: number, private readonly onTruncate?: () => void) {}

  push(chunk: Buffer): void {
    // An empty chunk carries no data, so it can't overflow the cap (a stream may emit one after a
    // body that exactly fills it).
    if (chunk.length === 0) { return; }
    const remaining = this.maxBytes - this.bytes;
    if (remaining <= 0) {
      this.markTruncated();
      return;
    }
    if (chunk.length > remaining) {
      this.chunks.push(chunk.subarray(0, remaining));
      this.bytes += remaining;
      this.markTruncated();
    } else {
      this.chunks.push(chunk);
      this.bytes += chunk.length;
    }
  }

  /** True once a chunk has overflowed the cap (i.e. there was more data than fit). */
  get isTruncated(): boolean {
    return this.truncated;
  }

  concat(): Buffer {
    return Buffer.concat(this.chunks);
  }

  private markTruncated(): void {
    if (this.truncated) { return; }
    this.truncated = true;
    this.onTruncate?.();
  }
}
