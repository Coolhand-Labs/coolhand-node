'use strict';
// tsup bundle:false leaves relative .js paths in require() calls of .cjs output.
// With "type":"module" in package.json, Node treats those .js files as ESM and fails
// to load them from a CJS context. This script rewrites the paths in-place.
const { readFileSync, writeFileSync, readdirSync, statSync } = require('fs');
const { join } = require('path');

function fixDir(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      fixDir(full);
    } else if (entry.endsWith('.cjs')) {
      const original = readFileSync(full, 'utf8');
      // Only rewrite relative paths (starting with ./ or ../) — leave package imports alone
      const fixed = original.replace(/require\("(\.[^"]+)\.js"\)/g, 'require("$1.cjs")');
      if (fixed !== original) writeFileSync(full, fixed);
    }
  }
}

fixDir(join(__dirname, '..', 'dist'));
