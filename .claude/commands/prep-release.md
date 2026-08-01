---
description: Pre-release checklist — run the full verify + build gate, refresh docs against everything merged since the last tag, and red-team the entire package (not just this release's diff) for security issues.
---

Run the pre-release checklist. Bump the version if it hasn't already been bumped, but do NOT tag or push — that trigger step stays manual.

## Step 1 — Full Verify + Build Pass

Run the project's full gate — CLAUDE.md's verify gate (`lint && typecheck && test`) plus the build/package smoke tests that `prepublishOnly` runs, so this actually validates the artifact that would ship, not just the source:

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run test:cjs && npm run test:esm
```

If anything fails, stop here and report the failure. Do not proceed to later steps until this is clean — a version bump, docs, and security findings are meaningless against a broken build or a package that doesn't actually import correctly under CJS/ESM.

## Step 2 — Version Bump (if not already done)

1. Find the last tag: `git describe --tags --abbrev=0` (tags are `vX.Y.Z`). Compare its version to `package.json`'s current `"version"`.
2. If `package.json` is already ahead of the last tag (someone already bumped it this cycle), skip this step entirely — do not bump twice.
3. Otherwise, inspect `git log <tag>..HEAD --oneline` to pick the semver bump type: any new exported method/type or new public capability (e.g. a new `Coolhand#`/`*Service#` method) → `minor`; only fixes, docs, internal refactors, or dependency bumps → `patch`; any change documented as breaking (removed/renamed export, narrowed type, changed default behavior) → `major`.
4. Run `npm version <patch|minor|major> --no-git-tag-version` (updates `package.json` and `package-lock.json`; `--no-git-tag-version` is required since tagging is explicitly out of scope here).
5. Run `npm run sync-version` so `src/version.ts` (the generated `PACKAGE_VERSION`/`PACKAGE_IDENTIFIER` used in the SDK's own collector string) matches the new version immediately, rather than only at the next build.
6. Report the old → new version and which bump type you chose and why.

## Step 3 — Docs Update (changes since last tag)

1. Enumerate everything merged since the last tag found in Step 2: `git log <tag>..HEAD --oneline` and `git diff <tag>..HEAD --stat`.
2. For every commit in that range, check whether it's reflected in:
   - `CHANGELOG.md` — a version section for the new version from Step 2 (titled `## [X.Y.Z] - <today's date>`; if an `[Unreleased]` section already exists with matching content, just retitle it) with entries grouped under the categories this file already uses (`### 💥 Breaking Changes`, `### ✨ New Features`, `### 🐛 Bug Fixes`, `### 🔒 Security`, `### 📖 Documentation`, `### 🔧 Internal` / `### 🔧 Build & CI`, `### ⚠️ Upgrade Notes` / `### ⚠️ Deprecation Warning` as applicable) — match the existing tone (user-facing behavior, not commit messages; bold the symbol/method changed; link the PR like `([#123](.../pull/123))` where the commit message has a PR/issue number).
   - `README.md` — only the landing-page bits per CLAUDE.md's "README and docs philosophy": the env vars table, the basic `Coolhand({ apiKey })`/`createFeedback()` snippets, the flat Supported Libraries list, the Integrations table linking out to `docs/frameworks/<name>.md`. Anything needing more than one code block belongs in `docs/`, not here — if a commit added README prose beyond that bar, move the detail into the matching `docs/*.md` file instead of leaving it bloating the README.
   - `docs/*.md` — the per-topic reference files (`feedback-search.md`, `log-search.md`, `framework-integration.md`, `global-monitoring.md`, `manual-submission.md`, `frameworks/*.md`). Any new/changed public method, config option, or integration pattern needs its full reference here, matching the structure of the sibling doc it's closest to (e.g. a new read method mirrors `feedback-search.md`'s/`log-search.md`'s Parameters/Return value/Errors sections).
   - `CLAUDE.md` — its "Code conventions" examples (e.g. the DRY section's pointer to whichever service currently has the canonical shared-helper example) should still point at real, current code, not something renamed or removed since.
3. "Clean" means more than additive: remove stale method/type/field references, fix descriptions that no longer match current behavior, and fix any drift you find even if unrelated to this release's commits — including doc prose that describes backend behavior, which can go stale independent of any code change in this repo (verify a sample of such claims against the actual Coolhand API docs or backend source if you have access, rather than assuming prose that's been sitting in the repo is still accurate).
4. Per CLAUDE.md's "Cross-SDK alignment" section, check whether any structural change since the last tag (new README section pattern, new `docs/` pattern, new configuration option) got a companion issue/PR on `coolhand-python`. If one is missing, flag it in the summary rather than filing it yourself.
5. Apply the doc edits directly (Edit/Write), then summarize what changed and why.

## Step 4 — Security Red-Team (whole package)

This is a full-package audit, not a diff review — scope is all of `src/`, not just what changed since the last tag. This SDK's attack surface is different from a CLI: it has no child-process/shell surface, but it does monkey-patch Node's `http`/`https`/`fetch` globally and forwards third-party API traffic (potentially containing secrets) to Coolhand's backend.

1. Run `npm audit` for known dependency vulnerabilities and note anything high/critical (the CI gate already runs `npm audit --omit=dev` — cross-check dev-only findings separately since those don't block a release the same way).
2. Spawn an Agent (general-purpose, high effort) with a prompt that has it read through `src/` and adversarially review for:
   - **Credential/secret leakage** — `services/PatternMatchingService.ts`'s `sanitizeHeaders` (does every logging path — `console.log` calls across `services/*.ts`, `global-monitor.ts`, `auto-monitor.ts` — actually route through it before printing headers, or could a new code path print an `Authorization`/`X-API-Key` header directly?), and whether the Coolhand `apiKey` itself is ever logged, included in an error message, or serialized into a payload sent anywhere other than the `X-API-Key` header.
   - **SSRF-adjacent** — `services/BaseService.ts`'s `validateBaseUrl`/`normalizeBaseUrl` (the `https://`-only-except-`localhost` allowlist for `baseUrl`): is it applied on every code path that constructs a request, including the HTTPS-module fallback (`sendWithHTTPS`) for pre-fetch Node versions?
   - **Global monkey-patching correctness** — `global-monitor.ts`/`auto-monitor.ts` patching `http`/`https`/`fetch`: could the patch swallow, duplicate, or corrupt the original request/response (e.g. double-send, hang on error, break streaming) in a way that's a reliability or data-integrity issue for the host application, not just this SDK?
   - **ReDoS** — `services/PatternMatchingService.ts`'s domain/path pattern matching and `non-inference-filter.ts`'s filters: any regex built from (or matched against) values that could be attacker-influenced (response headers/bodies from the third-party API being monitored) with catastrophic-backtracking potential.
   - **Unsafe file I/O** — the custom `patternsFile` option (`PatternMatchingService`) and `api-patterns.json` loading: path traversal if `patternsFile` is ever influenced by anything other than the host app's own static config.
   - **Untrusted input parsing** — `utils/decompress.ts` (zlib decompression of response bodies — decompression-bomb potential) and `utils/parse-body.ts`: do these handle a malformed or adversarial upstream API response (the third-party LLM API being monitored, not Coolhand's own backend) without crashing the host process or the SDK swallowing an error path that skips redaction.
   - **ID/URL construction** — any place a service builds a URL from caller-supplied input (the pattern `BaseService#buildResourceUrl` already guards against — dot-segment/blank-string path resolution) to confirm no *other* method builds a single-resource URL without going through it.
   Ask the agent to report each finding with file:line, a concrete exploit or failure scenario (not just "could be risky"), and severity (critical/high/medium/low). No finding, real or not, should be invented — skip speculative "best practice" nits that don't have a concrete failure scenario.
3. Read the agent's findings yourself and sanity-check the top ones against the actual code before reporting them onward — don't relay unverified claims.

## Step 5 — Summary

Report:
1. **Verify + build pass**: pass/fail (lint, typecheck, test, build, test:cjs, test:esm).
2. **Version**: bumped (old → new, and why) or already up to date.
3. **Docs**: what was updated, in which files, confirmation nothing is stale, and whether a `coolhand-python` companion issue is needed and missing.
4. **Security**: `npm audit` result + the agent's findings, ranked by severity, each with file:line and exploit/failure scenario.
5. **Release readiness**: a clear go / no-go, with the blocking items listed if no-go. Remind the user that tagging/pushing (`git tag vX.Y.Z && git push origin main --tags`) is still a manual step, and that CI publishes via npm Trusted Publishing (OIDC) once the tag lands — no local `npm publish` is needed or expected.
