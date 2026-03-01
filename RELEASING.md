# Releasing

## Release Process

1. **Bump the version** in `package.json`:

   ```bash
   npm version patch   # 0.2.0 → 0.2.1
   npm version minor   # 0.2.0 → 0.3.0
   npm version major   # 0.2.0 → 1.0.0
   ```

   Or edit `"version"` in `package.json` directly.

2. **Build** — automatically syncs `src/version.ts` from `package.json`, then compiles:

   ```bash
   npm run build
   ```

3. **Update `CHANGELOG.md`** with the new version section.

4. **Commit** both updated files together:

   ```bash
   git add package.json src/version.ts CHANGELOG.md
   git commit -m "Bump version to vX.Y.Z"
   ```

5. **Tag and push**:

   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```

6. **Publish to npm**:

   ```bash
   npm publish
   ```

   `prepublishOnly` calls `npm run build` automatically, so the package is always built fresh before publishing.

---

## Version File

`src/version.ts` is **auto-generated** from `package.json` — do not edit it manually. The `scripts/sync-version.mjs` script (called automatically by `npm run build`) rewrites the file with the current version from `package.json`. This ensures the collector identifier sent with every logged request always matches the published package version.

To sync manually without a full build:

```bash
npm run sync-version
```
