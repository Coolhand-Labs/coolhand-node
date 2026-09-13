---
name: prep-release
description: |
  Runs an entire release event for this package: triages every open PR into
  a quality/risk-rated merge recommendation, waits for the user's sign-off,
  squash-merges the chosen PRs, writes the release's changelog and version
  bump plus a whole-package security red-team on its own release branch,
  validates that branch with the full lint/typecheck/test/build gate and
  live-key example scripts, then opens a single release-prep PR for the
  user's final review. Never merges that PR, tags, or publishes. Use when
  the user types /prep-release, asks to "prep a release", "cut a release",
  "release checklist", or wants the open PRs triaged and merged into a
  release.
user_invocable: true
version: 1.0.0
---

# Prep Release

Five phases, run in order. This is a whole-release audit, not a
single-branch review — Phase 3 onward operates on the whole `src/` tree and
everything merged since the last tag, not just one diff. For an iterative
diff-scoped review during normal development, use `/loop-review` instead;
this skill is for the release event itself.

Per `CLAUDE.md`, feature/fix branches never touch `CHANGELOG.md` or
`package.json`'s `version` field — this skill is the only place those get
written. If a chosen PR's diff does touch either file, treat it as a normal
part of that PR's diff (don't strip it), but don't let it change how
Phase 3 writes its own entry — Phase 3's changelog write-up is authoritative
regardless of what an individual PR's diff already contains.

## Phase 1: Survey open PRs, recommend a release set

1. `gh pr list --state open --json number,title,author,isDraft,mergeable,mergeStateStatus,statusCheckRollup,additions,deletions,changedFiles,body,headRefName`.
2. For each PR, pull `gh pr diff <n>` and `gh pr checks <n>` — these are
   independent, read-only lookups across PRs (and within a PR), so issue
   them concurrently rather than one PR at a time — and rate two
   independent axes:
   - **Quality** (High/Medium/Low): does the diff include test coverage
     proportional to the `src/` change, is the code consistent with this
     repo's conventions (`CLAUDE.md`'s TypeScript/DRY rules), does the PR
     description read as complete work rather than a stub or "WIP, not
     ready" note.
   - **Risk** (High/Medium/Low): does it touch a security- or
     interception-critical path (`RequestMonitoringService.ts`,
     `global-monitor.ts`, `BaseService.ts`, `PatternMatchingService.ts`,
     anything under `src/utils/` that parses or caps response/request
     bodies, `src/api-patterns.json`, `default-exclude-api-patterns.ts`)
     — weight those higher regardless of size; failing CI checks or a
     non-clean `mergeable` state also push risk up; an isolated additive
     feature or docs-only change is lower risk.
3. Present one table: PR number, title, quality, risk, CI status,
   mergeable state, and a one-line recommendation (include / exclude /
   needs work before it can be considered). Call out anything that looks
   unfinished — draft, a WIP-sounding title, failing checks, an empty or
   placeholder description, visible `TODO`/`FIXME` in the diff — as
   "exclude, not ready" rather than rating it neutrally.
4. Stop here and ask the user which PRs to include in this release — do
   not merge, write changelog entries, or touch `package.json`'s version
   until the user answers. (The red-team in Phase 3 has its own planned
   stop for findings that are a behavior/architecture decision rather than
   a safe mechanical fix; this step is the first planned stop, not the
   only one.)

## Phase 2: Merge the chosen PRs

Process the user's chosen PRs one at a time, not as a batch:

1. Before each merge, re-check that PR's `mergeable`/`mergeStateStatus`
   (`gh pr view <n> --json mergeable,mergeStateStatus`) — an earlier merge
   in this same run can newly conflict a later one. If a chosen PR now
   conflicts, skip it, note it in the running list as "skipped — needs
   rebase," and continue with the rest. Don't resolve conflicts on someone
   else's branch unilaterally.
2. `gh pr merge <n> --squash --delete-branch` for each surviving PR.
3. After each merge, sync local `main` before evaluating the next PR.
   First check `git status --porcelain` — if it's not empty, stop and
   surface it to the user rather than discarding unknown local state. Also
   check `git log origin/main..main --oneline` — if that's non-empty,
   `main` carries local commits `origin/main` doesn't have (a manual
   hotfix, or a prior `/prep-release` run that committed to `main` and was
   interrupted); stop and surface those commits too rather than silently
   discarding them. Only when both checks are empty is `git fetch origin
   main && git checkout main && git reset --hard origin/main` safe — it
   then only overwrites a working tree and branch pointer that carry
   nothing `origin/main` doesn't already have.

Keep a running list of what actually merged vs. what got skipped — Phase 5
reports both.

## Phase 3: Build the release branch — docs/changelog/version + red-team

### Determine the version, then create the branch

1. Sync local `main` to `origin/main` first, unconditionally — using the
   same clean-working-tree and no-unpushed-commits checks as Phase 2 step
   3 — even if Phase 2 merged nothing this run. Phase 2's sync only runs
   as a side effect of a successful merge iteration, so if the user chose
   zero PRs, or every chosen PR was skipped for a conflict, `main` was
   never synced this run and everything below would otherwise operate
   against a stale local `main`.
2. Find the last release tag: `git describe --tags --abbrev=0`.
3. Diff **everything since that tag** on the now-updated `main` —
   `git log <last-tag>..HEAD --oneline` and `git diff <last-tag>..HEAD -- src/`
   — not just the PRs this run merged in Phase 2. `main` can carry
   unreleased changes Phase 2 never touched (a hotfix committed directly,
   a PR merged manually outside this skill, or a prior `/prep-release` run
   that merged PRs but was interrupted before finishing this phase); all
   of those still need a changelog entry, so treat this diff, not Phase
   2's merge list, as the source of truth for what's covered.
4. Determine the SemVer bump that diff implies (patch = fix, minor =
   backward-compatible addition or breaking change while pre-1.0, major =
   breaking change once the package is at 1.0.0 or later) and the
   resulting `X.Y.Z`. Check `package.json`'s current `version` against the
   last tag first as a defensive sanity check in case something bumped it
   out of band: if it's already ahead of the last tag, use that version
   instead of computing a new one; if it's behind the last tag (e.g. a
   manual revert after tagging), that's a corrupted state — stop and
   surface it to the user rather than guessing which version is correct.
5. Create `release/vX.Y.Z` off the now-synced `main` using that version
   number. If a branch with that name already exists (a prior
   `/prep-release` run got partway through Phase 3 or later and was
   interrupted), don't blindly recreate it — check it out, review what's
   already committed there, and continue from that state instead of
   silently overwriting or duplicating it. Otherwise, do all of the
   following as commits on the new branch — never
   on `main` directly.

### Docs, changelog, version

1. For each change identified above, check it's reflected in:
   - `CHANGELOG.md` — exactly one entry per change under an `[Unreleased]`
     heading (add one at the top, above the last version heading, if the
     file doesn't already have one — this repo's `CHANGELOG.md` currently
     goes straight from the header into `## [X.Y.Z]` entries), in Keep a
     Changelog format matching this repo's existing entries (see the
     `0.12.0` section for the
     emoji-headed category style this repo uses — `✨ New Features`,
     `⚠️ Upgrade Notes`, `🧹 Internal`, `🔒 Security`) — plain-English
     migration notes for anything behavior-affecting. Attribute each entry
     to its PR number where one exists: check Phase 2's merge list first,
     then fall back to the squash-merge commit message (`git log --grep`,
     which carries the PR number in its title) for anything not merged in
     this run. If a change genuinely has no discoverable PR (a direct
     commit to `main`), write the entry without one rather than skipping
     it. If a merged PR's diff already added its own `CHANGELOG.md` entry
     (the preamble above says not to strip it), fold it into — don't
     duplicate alongside — the one authoritative entry you write here for
     that change, so a change never ends up with two entries describing
     it.
   - `README.md` / `docs/*.md` — any new config option, public method, or
     behavior change needs the relevant section updated. Follow this
     repo's docs philosophy from `CLAUDE.md`: the README stays a scannable
     landing page (basic config/feedback snippets only); anything needing
     more than one code block belongs in `docs/`; each integration gets
     its own `docs/frameworks/<name>.md`.
   - `CLAUDE.md` itself — its "Code conventions" examples (e.g. the DRY
     section's pointer to whichever service currently has the canonical
     shared-helper example) should still name real, current code, not
     something renamed or removed since.
2. **Cross-SDK alignment.** Per `CLAUDE.md`'s "Cross-SDK alignment"
   section, check whether any structural change since the last tag (same
   trigger list as that section — and as `/loop-review` applies per-PR)
   got a companion issue/PR on `coolhand-python`. This re-checks the whole
   range since the last tag, not just what loop-review saw per-PR, so it
   also catches a direct commit to `main` or a PR merged outside the
   normal review flow. If one is missing, flag it in the Phase 5 report
   rather than filing it yourself.
3. **Clean, don't just append.** Look for docs that are now stale,
   contradictory, or redundant given the accumulated changes since the
   last tag — consolidate/rewrite rather than layering a new paragraph on
   top of an outdated one. Remove docs for anything removed from the
   package.
4. **Write the version.** Write the `X.Y.Z` determined above to
   `package.json`, turn the `[Unreleased]` CHANGELOG heading into
   `## [X.Y.Z] - <today's date>`, run `npm run sync-version` so
   `src/version.ts` matches (this also runs automatically as part of
   `npm run build` in Phase 4, but run it explicitly here so the commit is
   self-consistent), and run `npm install --package-lock-only` so
   `package-lock.json`'s top-level `version` field matches too.

### Red-team

Adversarially review the entire `src/` tree (not just what merged in
Phase 2) for security issues. This package intercepts outgoing LLM API
traffic and logs it to Coolhand, so hunt specifically for:

- **Credential/secret leakage**: does any interceptor, logger, or error
  handler write an API key, bearer token, or provider auth header value
  into a `console.log`/`console.error` line, an error message, or the
  payload sent to Coolhand? Check every header-redaction path (the
  `DEFAULT_REDACTED_HEADERS` list in `PatternMatchingService.ts`, the
  per-pattern `headers` maps in `src/api-patterns.json`) actually strips
  what it claims to, rather
  than redacting a differently-cased or differently-named header — this
  class of bug has recurred here before (`openai-api-key`,
  `x-goog-api-key`, `cf-aig-authorization` were each added after being
  found unredacted).
- **SSRF / hostname matching**: `PatternMatchingService`'s
  `matchesAPIPatternFromURL`/`matchesAPIPatternSync` and the self-endpoint
  exclusion (`src/utils/self-endpoint.ts`) — can a crafted URL (redirect,
  unicode homograph, userinfo trick, subdomain confusion, trailing-dot
  FQDN) match or evade the intended host-matching logic in a way that
  intercepts (or fails to intercept, or recursively self-logs) the wrong
  destination? Also re-check that `BaseService`'s `fetch` calls still pass
  `redirect: 'error'` so a compromised/misconfigured `baseUrl` can't
  exfiltrate the `X-API-Key` header via a followed redirect.
- **ReDoS**: any regex built from configurable or user-influenced input
  (custom `patternsFile` entries, `excludeApiPatterns`) — check for
  catastrophic backtracking shapes (nested quantifiers, overlapping
  alternation).
- **Unbounded buffering**: this package caps response/request body
  buffering at 50 MB via `CappedBuffer`/`MAX_DECOMPRESSED_BYTES`
  (`src/utils/capped-buffer.ts`, `src/utils/capped-fetch-body.ts`) on both
  the `http`/`https` and `fetch` interception paths, and on both Coolhand's
  own capture and the host-facing response tee
  (`src/utils/tee-response.ts`). Any new capture path added since the last
  release needs the same cap — an uncapped `+=`/`.text()`/buffer
  accumulation reopens the unbounded-memory class of bug this repo has
  fixed multiple times.
- **Unhandled rejections in fire-and-forget paths**: every call site that
  triggers logging from the monitoring path
  (`coolhand.ts`'s `onRequestComplete`, both `global-monitor.ts`
  interception paths) is fire-and-forget by design — confirm they still
  `.catch()` and that `BaseService#sendRequest`/`LoggingService#logRequestToAPI`
  still swallow internal failures rather than throwing into an unawaited
  promise, which can crash the host process.
- **Fail-open vs fail-closed**: when Coolhand's API is unreachable, rate
  limited, or returns malformed data, does the package fail open in a way
  that silently drops security-relevant logging, or fail in a way that
  breaks the host application's actual LLM call (the interceptor must
  never break the underlying request)? Also check a missing/malformed
  `patternsFile` still falls back to the built-in default patterns rather
  than leaving the pattern list empty.
- **Monkey-patching correctness**: could the `http`/`https`/`fetch`
  patches in `global-monitor.ts`/`RequestMonitoringService.ts` swallow,
  duplicate, or corrupt the original request/response for the host
  application (a double-send, a hang on an error path, broken streaming)
  — a reliability/data-integrity issue for the host, not just a Coolhand
  logging gap.
- **Unsafe deserialization / input parsing**: any `JSON.parse` of a
  webhook/batch-result or response-body payload (`src/utils/parse-body.ts`,
  `src/utils/decompress.ts`) that trusts attacker-controlled shape without
  a type check before use, or that could crash the host process on a
  malformed upstream API response.
- **URL/ID construction**: confirm every service still builds a
  single-resource URL through `BaseService#buildResourceUrl` (its
  dot-segment/blank-string guard) rather than a new method hand-rolling
  its own URL from caller-supplied input — check any service method added
  since the last release for this.
- **Unsafe file I/O**: the custom `patternsFile` option
  (`PatternMatchingService`) — path traversal if `patternsFile` is ever
  derived from something other than the host app's own static config
  (an env var, a request-influenced value).

For each finding, report file, line, a concrete failure scenario, and
severity. Apply safe, mechanical, low-risk fixes directly, as commits on
`release/vX.Y.Z` (e.g. a missing header-redaction pattern, a missing cap).
Flag but do not silently apply anything that's a behavior/architecture
decision (e.g. changing a fail-open security default, adding replay
protection, moving synchronous work off the hot path) — surface these to
the user for a decision, the same "hand it to a human" rule `/loop-review`
uses for stuck findings.

## Phase 4: Validate the release branch

1. Run `npm run lint && npm run typecheck && npm test` on `release/vX.Y.Z`
   — this mirrors CI's `lint` and `test` jobs and is the same gate
   `CLAUDE.md` requires before any commit. Then run `npm run build` and
   confirm it succeeds (this also re-runs `sync-version` and regenerates
   `dist/`, matching CI's `build` job), then `npm run test:cjs && npm run
   test:esm` to smoke-test both published module formats — this is part
   of `prepublishOnly` and is what actually validates the artifact that
   would ship, not just the source. All of lint, typecheck, tests, build,
   and the CJS/ESM smoke tests must be clean before continuing — a release
   doesn't ship on a red build. If any fail, stop here and report the
   failures; fixing genuine bugs takes priority over the rest of this
   phase and Phase 5.

   Also run `npm audit` (full, not just `--omit=dev`) and note anything
   high/critical — CI's lint job only runs `npm audit --omit=dev
   --audit-level=high`, so this is the one point that also catches a
   high/critical vulnerability in a dev-only dependency before it ships.

   Then judge coverage on quality, not just the `npm run test:coverage`
   percentage: find the gaps and weight by risk (an uncovered
   error-handling or security-check branch matters more than an uncovered
   getter); audit existing tests for meaningfulness, not just count (flag
   tests that only assert a mock returns what it was mocked to return,
   missing negative/error-path cases, missing domain edge cases);
   recommend specific tests for the highest-risk gaps, named by
   `file:describe/it` — don't add tests purely to move the percentage.

2. If Phase 4.1 is green, run each script listed under "Live smoke tests"
   in `examples/README.md` (`node examples/<name>.js`) against real
   provider keys — that section is the authoritative list of scripts with
   the skip/pass/fail contract this step relies on; other files in
   `examples/` (demo scripts, framework example apps) don't have it and
   aren't part of this step. These scripts import from `dist/`, so they
   exercise whatever Phase 4.1's `npm run build` just produced — don't
   skip straight to this step against a stale `dist/` from before this
   run. Each script also hits a different, unrelated provider, so they're
   safe to run concurrently rather than one at a time — issue them as
   parallel tool calls (or background each `node examples/<name>.js &`
   and `wait`), each with its own captured stdout, so output from
   different scripts can't interleave when you attribute a pass/skip/fail
   to a specific script below. Each script follows the skip/pass/fail
   contract documented in `examples/README.md` (exit 0 with a clear
   message = skip, not a failure). A script that exits non-zero with its
   keys present is worth investigating before continuing to Phase 5 — but
   check *why* before concluding the provider call or interception itself
   is broken: a 401/403 from the provider most likely means an expired or
   rotated test credential in this environment, not an SDK regression,
   while a network/interception error (or the SDK's own thrown error
   about missing content) is the real signal to chase. Exit code alone
   isn't enough to confirm the *log delivery* half, though, since that
   happens asynchronously and swallows its own errors — read the script's
   output for the delivery-confirmed vs. delivery-failed markers
   documented in `examples/README.md` and record pass/skip/fail per
   script based on that, not just the exit code. If `examples/README.md`
   lists no live-key scripts yet, say so explicitly in the Phase 5 report
   rather than silently skipping this step — it's a gap to flag, not
   something to paper over.

## Phase 5: Open the release-prep PR, report everything

1. Push `release/vX.Y.Z` and `gh pr create` (e.g. "chore: release
   vX.Y.Z") targeting `main`. This PR is the user's final checkpoint
   before the changelog/version/red-team commit lands — never merge it,
   tag it, or run `npm publish`/push a `v*.*.*` tag yourself (tag push is
   what triggers `.github/workflows/publish.yml`'s npm Trusted Publishing
   flow).
2. Report one consolidated summary covering the whole run:
   - Phase 1's PR table and which PRs the user chose.
   - Phase 2's outcome: which PRs merged, which were skipped for new
     conflicts (and need a rebase before the next release).
   - The release-prep PR link, the version bump and why.
   - Coverage-quality gaps plus recommended tests.
   - Docs updated, and whether a `coolhand-python` companion issue/PR is
     needed and missing.
   - Red-team findings split into fixed vs. flagged-for-decision.
   - Phase 4's lint/typecheck/test/build result and the live-example
     script results (pass/skip/fail per script).
   - A reminder of the concrete next step, since this skill stops short of
     it: once the user reviews and merges the Phase 5 PR, tagging
     (`git tag vX.Y.Z && git push origin main --tags`) and publishing are
     their action — the tag push is what triggers
     `.github/workflows/publish.yml`'s npm Trusted Publishing flow, no
     local `npm publish` needed.

## Safety

- Bumping `package.json`'s version, running `sync-version` and `npm
  install --package-lock-only`, and finalizing the CHANGELOG heading are
  all in scope and don't need a stop-and-ask — they're mechanical and
  reversible, being commits on a disposable `release/vX.Y.Z` branch rather
  than `main`. They happen in Phase 3, before Phase 4 validates the
  branch; it's opening the Phase 5 PR that's gated on Phase 4 being green,
  not the Phase 3 commits themselves.
- Squash-merging PRs the user explicitly chose in Phase 1, and pushing the
  `release/vX.Y.Z` branch to open its own PR, are both in scope.
- Never push a commit directly to `main`. All release-branch work lands on
  `main` only via the Phase 5 PR, which the user reviews and merges
  themselves.
- Never create or push a git tag, never run `npm publish`, and never merge
  the Phase 5 PR yourself. Tagging and publishing are the user's action
  once they've reviewed and merged this skill's PR, not something this
  skill does — the tag push is what triggers the npm publish workflow.

## Rationalizations to resist

- *"This PR's CI is green and the diff is small, I don't need to look at
  the actual diff."* CI passing doesn't rule out unfinished work — a
  small, green diff can still be a stub that leaves a feature half-built.
  Read the diff.
- *"The diff since the last tag is small, I'll skip the red-team."* Small
  diffs can still sit on top of latent issues in code nobody's touched
  recently — that's exactly what "whole package, not just the diff" means.
- *"Tests pass, so coverage is fine."* Passing tests and meaningful
  coverage are different questions. A red build blocks release; a green
  build with hollow tests doesn't guarantee anything.
- *"Docs are close enough, I'll skip the cleanup pass."* Accumulated
  changes since the last tag are exactly when docs drift from behavior —
  this phase exists because per-PR doc updates miss the cross-cutting
  view.
- *"The example scripts are just smoke tests, I'll skip them since tests
  passed."* Unit tests mock the provider APIs and Coolhand's own backend;
  the live-key example scripts are the only step in this skill that
  exercises a real API call through real interception code — that's a
  different failure mode than a unit test can catch.
