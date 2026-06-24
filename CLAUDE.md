# coolhand-node

## Setup

```bash
npm ci
```

This is the only setup command needed. In CI contexts, always use `npm ci` — it installs from the lock file and will error if the lock file is out of date. Do not use `npm install`, which may silently update the lock file.

## Verify before committing

```bash
npm run lint && npm run typecheck && npm test
```

This mirrors what CI runs (`.github/workflows/ci.yml` runs lint, typecheck, and tests as separate jobs). A green run of all three means a green CI run. Do not substitute individual checks — run all three as the single gate.

## Running individual tools

```bash
npm run lint              # ESLint on src/ and test/
npm run typecheck         # TypeScript type check (tsc --noEmit)
npm test                  # Full Jest test suite
npm test -- path/to/test  # Run a single test file
npm run build             # Build dist/ (sync-version + tsup + fix-cjs-imports)
npm run test:cjs          # Smoke test CommonJS build
npm run test:esm          # Smoke test ESM build
```

## Other npm scripts

| Script | What it does |
|--------|-------------|
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run test:coverage` | Jest with coverage report |
| `npm run test:watch` | Jest in watch mode |
| `npm run build` | Build dist/ (sync-version + tsup + CJS import fix + copy patterns) |
| `npm run clean` | Remove dist/ and coverage/ |

## README and docs philosophy

The README is a landing page — install, quick start, what it supports, where to go next. Keep it scannable. When in doubt, link rather than expand.

**Three rules:**

- **Config**: env vars table and the basic `Coolhand({ apiKey })` snippet belong in the README. Anything requiring more than one code block (exclude patterns, self-hosted endpoints, custom intercept addresses) goes in `docs/`.
- **Feedback**: the two basic `createFeedback()` examples belong in the README. The full field table, matching strategies, and sentiment conversion details go in `docs/`.
- **Supported libraries**: a flat bulleted list belongs in the README. The interception mechanism breakdown (https vs fetch vs streaming behavior) goes in `docs/`.

**Integrations** each get their own `docs/frameworks/<name>.md` file. The README links to them from both the Integrations table and the Documentation section at the bottom.

**Align with coolhand-python.** When adding a section that exists in the Python README, match its structure and tone. The two READMEs should feel like siblings.

## Cross-SDK alignment

coolhand-node is the reference implementation for the Coolhand SDK family. When making structural changes here — new README sections, new `docs/` patterns, new configuration options — open a corresponding issue or PR on [coolhand-python](https://github.com/Coolhand-Labs/coolhand-python) to keep the two in sync.

## Discoverability (SEO / AEO)

The README is indexed by search engines and consumed by AI agents doing package research. Write headings, the package description, and the supported-libraries list with this in mind: use the full names of supported providers and frameworks — "OpenAI", "Anthropic", "LangChain", "Google AI", "Vertex AI", "Cloudflare AI Gateway" — rather than abbreviations, and make the one-line description accurate and keyword-rich. The goal is that both humans and AI agents searching for "Node.js LLM monitoring", "OpenAI request logging", or "Anthropic observability" land here.
