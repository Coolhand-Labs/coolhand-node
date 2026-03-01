// scripts/sync-version.mjs
// Reads the version from package.json and writes it to src/version.ts.
// Run via `npm run sync-version` or automatically as part of `npm run build`.
import { readFileSync, writeFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

const content = `/**
 * Auto-generated from package.json — do not edit manually.
 * Run \`npm run sync-version\` or \`npm run build\` to regenerate.
 */

export const PACKAGE_VERSION = '${pkg.version}';
export const PACKAGE_NAME = '${pkg.name}';

/**
 * Full package identifier
 */
export const PACKAGE_IDENTIFIER = \`\${PACKAGE_NAME}-\${PACKAGE_VERSION}\`;
`;

writeFileSync('./src/version.ts', content);
console.log(`[sync-version] Synced version to ${pkg.version}`);
