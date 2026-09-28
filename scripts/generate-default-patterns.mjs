// Generates src/default-api-patterns.ts from src/api-patterns.json.
// api-patterns.json is the single source of truth for the built-in provider patterns; the
// generated module lets every runtime (CJS, native ESM, Edge, any Node version) get them
// without touching the filesystem. tsup runs with bundle:false, so importing the JSON directly
// would not inline it. Run via `npm run generate-patterns` or automatically as part of `npm run build`.
import { readFileSync, writeFileSync } from 'fs';

// Resolved relative to this script (not process.cwd()) so it works from any working directory.
const srcDir = new URL('../src/', import.meta.url);
const { patterns } = JSON.parse(readFileSync(new URL('api-patterns.json', srcDir), 'utf-8'));

const content = `/**
 * Auto-generated from src/api-patterns.json — do not edit manually.
 * Run \`npm run generate-patterns\` or \`npm run build\` to regenerate.
 */

import type { CoolhandAPIPattern } from './types.js';

export const DEFAULT_API_PATTERNS: readonly CoolhandAPIPattern[] = ${JSON.stringify(patterns, null, 2)};
`;

writeFileSync(new URL('default-api-patterns.ts', srcDir), content);
