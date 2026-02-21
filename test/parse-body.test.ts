import { parseBody } from '../src/utils/parse-body';

describe('parseBody', () => {
  it('should parse a valid JSON object', () => {
    const result = parseBody('{"test": "value"}');
    expect(result).toEqual({ test: 'value' });
  });

  it('should return the raw string for non-JSON input', () => {
    const result = parseBody('not json');
    expect(result).toBe('not json');
  });

  it('should return null for null', () => {
    expect(parseBody(null)).toBeNull();
  });

  it('should return null for undefined', () => {
    expect(parseBody(undefined)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(parseBody('')).toBeNull();
  });

  it('should normalize a JSON array to newline-delimited JSON', () => {
    const input = JSON.stringify([
      { candidates: [{ content: 'chunk1' }] },
      { candidates: [{ content: 'chunk2' }] }
    ]);
    const result = parseBody(input);
    expect(typeof result).toBe('string');
    const lines = (result as string).split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ candidates: [{ content: 'chunk1' }] });
    expect(JSON.parse(lines[1])).toEqual({ candidates: [{ content: 'chunk2' }] });
  });

  it('should normalize a single-element array to a single JSON line', () => {
    const input = JSON.stringify([{ candidates: [{ content: 'only' }] }]);
    const result = parseBody(input);
    expect(typeof result).toBe('string');
    expect(JSON.parse(result as string)).toEqual({ candidates: [{ content: 'only' }] });
  });

  it('should normalize an empty array to empty string', () => {
    const result = parseBody('[]');
    expect(result).toBe('');
  });
});
