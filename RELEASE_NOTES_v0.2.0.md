# v0.2.0 Release Notes

## 🚀 What's New

This release focuses on reliability, code quality, and developer experience. The headline fix resolves a silent data loss bug affecting Gemini streaming responses, accompanied by a codebase-wide deduplication refactor, a new CI/CD pipeline, and a unified version management system that keeps `package.json` and runtime version identifiers permanently in sync.

---

## 🐛 Bug Fixes

### Gemini Array Response Normalization

`streamGenerateContent` responses from Google's Gemini API return a JSON array (e.g., `[{candidates: [...]}, {candidates: [...]}]`) rather than a single JSON object. The previous `parseJSON` implementation silently returned `null` on array input, causing the Rails ingestor to record requests with blank metrics — no tokens, no model, no response body.

The new `parseBody()` utility correctly handles array responses by normalizing them to newline-delimited JSON before transmission:

```
[{...}, {...}]  →  {...}\n{...}
```

Single objects, non-JSON strings, and null/empty values all continue to work as before.

---

## 🏗️ Code Quality

### Shared `parseBody()` Utility

Three separate `parseJSON` implementations existed across `coolhand.ts`, `global-monitor.ts`, and `RequestMonitoringService.ts` — each slightly different, each missing the array normalization fix. These have been consolidated into a single `src/utils/parse-body.ts` utility, covered by 8 focused unit tests.

`parseBody()` is now exported from the main package entry point for consumers who need direct access.

**💥 Breaking change:** The `parseJSON()` method previously accessible on the `Coolhand` class has been removed. Use the exported `parseBody()` function instead.

---

## ⚙️ PatternMatchingService Enhancements

`PatternMatchingService` now accepts an options object in addition to the existing string constructor, enabling `silent` mode to suppress console output during initialization:

```typescript
// New options object form
const service = new PatternMatchingService({ silent: true });

// Original string form still works
const service = new PatternMatchingService('./custom-patterns.json');
```

This is particularly useful in test environments and production deployments where console noise from pattern loading is undesirable.

---

## 🔧 CI/CD Pipeline

A new GitHub Actions workflow runs on every push to `main` and on all pull requests, with three parallel jobs:

- **Test** — full Jest suite across Node.js 18, 20, and 22; coverage report uploaded as artifact on Node 20
- **Lint** — ESLint + TypeScript type checking on Node 20
- **Build** — compiles the package and verifies that `dist/index.js`, `dist/index.d.ts`, and `dist/api-patterns.json` are all present

---

## 🔗 Version Sync

`src/version.ts` is now auto-generated from `package.json` at build time via `scripts/sync-version.mjs`. The `npm run build` command runs the sync step first, so the version string embedded in SDK collector identifiers always matches the published package version. See [`RELEASING.md`](./RELEASING.md) for the recommended release workflow.

---

## 📚 Documentation

- **CHANGELOG.md** added, documenting v0.1.0-rc1 and v0.1.1 history
- **README** updated with a Related Packages section cross-referencing `coolhand-js` (browser feedback widget), `coolhand-ruby`, and `coolhand-python`
- **RELEASING.md** added with step-by-step release instructions

---

## 📦 Dependency Updates

| Package | From | To |
|---------|------|----|
| `js-yaml` | 4.1.0 | 4.1.1 |
| `glob` | 10.4.5 | 10.5.0 |

---

## 💥 Breaking Changes

| What changed | Migration |
|-------------|-----------|
| `Coolhand#parseJSON()` removed from public API | Use `import { parseBody } from 'coolhand-node'` instead |
