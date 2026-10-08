import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_API_PATTERNS } from '../src/default-api-patterns';

// src/default-api-patterns.ts is generated from src/api-patterns.json (scripts/generate-default-patterns.mjs,
// run by `npm run build`). If this fails, run `npm run generate-patterns` and commit the result.
describe('DEFAULT_API_PATTERNS', () => {
  it('matches src/api-patterns.json exactly (single source of truth, #235)', () => {
    const json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'api-patterns.json'), 'utf-8'));

    expect(DEFAULT_API_PATTERNS).toEqual(json.patterns);
  });
});
