import { CappedBuffer } from '../src/utils/capped-buffer';

describe('CappedBuffer', () => {
  it('concatenates chunks under the cap without truncating', () => {
    const onTruncate = jest.fn();
    const buffer = new CappedBuffer(1024, onTruncate);

    buffer.push(Buffer.from('hello '));
    buffer.push(Buffer.from('world'));

    expect(buffer.concat().toString('utf-8')).toBe('hello world');
    expect(onTruncate).not.toHaveBeenCalled();
  });

  it('truncates a single chunk that exceeds the cap to exactly maxBytes', () => {
    const onTruncate = jest.fn();
    const buffer = new CappedBuffer(10, onTruncate);

    buffer.push(Buffer.alloc(20, 'a'));

    expect(buffer.concat()).toHaveLength(10);
    expect(onTruncate).toHaveBeenCalledTimes(1);
  });

  it('truncates byte-exact when the cap falls in the middle of a chunk', () => {
    const buffer = new CappedBuffer(5);

    buffer.push(Buffer.from('abc')); // 3 bytes, under cap
    buffer.push(Buffer.from('defgh')); // would push total to 8, cap is 5

    const result = buffer.concat();
    expect(result).toHaveLength(5);
    expect(result.toString('utf-8')).toBe('abcde');
  });

  it('drops chunks entirely once already at the cap', () => {
    const onTruncate = jest.fn();
    const buffer = new CappedBuffer(5, onTruncate);

    buffer.push(Buffer.from('abcde'));
    buffer.push(Buffer.from('should be dropped'));

    expect(buffer.concat().toString('utf-8')).toBe('abcde');
    expect(onTruncate).toHaveBeenCalledTimes(1);
  });

  it('calls onTruncate only once across multiple over-cap pushes', () => {
    const onTruncate = jest.fn();
    const buffer = new CappedBuffer(5, onTruncate);

    buffer.push(Buffer.alloc(10, 'a'));
    buffer.push(Buffer.alloc(10, 'b'));
    buffer.push(Buffer.alloc(10, 'c'));

    expect(buffer.concat()).toHaveLength(5);
    expect(onTruncate).toHaveBeenCalledTimes(1);
  });

  it('works without an onTruncate callback', () => {
    const buffer = new CappedBuffer(5);
    expect(() => {
      buffer.push(Buffer.alloc(10, 'a'));
    }).not.toThrow();
    expect(buffer.concat()).toHaveLength(5);
  });
});
