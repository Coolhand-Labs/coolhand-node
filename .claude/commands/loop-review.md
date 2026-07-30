---
description: Automated review → fix → repeat loop. Spawns a reviewer agent each round, fixes findings in this session, and repeats until the review comes back clean.
argument-hint: [low|medium|high|max]
---

Run an automated code review + fix loop on the current branch. Keep iterating until the deterministic checks pass and the reviewer reports no issues.

## Setup

- Effort level: `$ARGUMENTS` (default: `high` if blank)
- Max iterations: 5
- Review scope: `git diff origin/main` (NOT `origin/main...HEAD` — the triple-dot form only sees committed history and silently returns empty on a branch whose work is still uncommitted, which would make the reviewer rubber-stamp "LGTM" on real, unreviewed changes. `git diff origin/main` compares the working tree directly against `origin/main`, so it always covers whatever mix of commits and uncommitted changes is actually on disk.)

## Loop Instructions

Repeat the following cycle up to 5 times:

### Step 1 — Deterministic checks (Bash)

Run this repo's single verify gate (from `CLAUDE.md` — mirrors what CI runs as separate lint/typecheck/test jobs):

```bash
npm run lint && npm run typecheck && npm test
```

Treat any failing line (lint error, type error, or test failure) as a finding with the same weight as a reviewer-reported issue — the reviewer step below does not substitute for this.

Also run `git status --short` here. Brand-new untracked files (`??`) don't show up in `git diff origin/main` at all, which would let a new file skip review entirely. If there are any, run `git add -N <path>...` (intent-to-add — stages the path as an empty file without staging its content, so it appears as a full addition in the diff without actually changing what would be committed) before the reviewer step, and tell the reviewer agent this was done.

### Step 2 — Review (Agent)

Spawn an Agent using the Agent tool with `thinking: "high"` enabled and this prompt (substitute ITERATION_NUM, EFFORT, and PREVIOUS_FIXES):

---
You are a code reviewer doing pass ITERATION_NUM of an automated review loop on the `coolhand-node` SDK.

Run `git diff origin/main` to get the current branch diff — do NOT use `origin/main...HEAD`, which only sees committed history and returns empty (causing a false "LGTM") if this branch's work is still uncommitted. Read `CLAUDE.md` for this repo's conventions before judging anything. Review it for:

**Correctness & quality**
- Correctness bugs and logic errors
- Missing/broken error handling — in particular, whether error semantics match the surrounding convention (services that swallow errors and return `null`, e.g. `createFeedback`/`logRequestToAPI`, vs. services that throw with a `.status`-carrying error, e.g. `McpService`/feedback-read methods)
- Inefficiencies or unnecessary complexity
- Violations of project conventions in `CLAUDE.md`, especially its "Code conventions" section:
  - **TypeScript best practices**: `any`/loose typing used where a precise interface was possible, non-null assertions (`!`) or casts papering over a missing check, over-annotated locals where inference already works
  - **DRY**: new fetch/error-handling/request-building logic that duplicates something already in `BaseService` or a sibling service, or the same logic repeated twice within one class instead of factored into a private helper (but don't flag a single, one-off snippet as a missing abstraction — see CLAUDE.md's premature-abstraction caveat)

**Security**
- Injection vulnerabilities (command injection, SSRF via a user-controlled `baseUrl`, etc.)
- Secrets, API keys, or credentials hardcoded or logged
- Unsafe use of user-supplied input
- Public vs. private API key confusion (methods that should require the private key silently accepting the public key, or vice versa)

**Backwards compatibility**
- Any change to the public API surface (`src/index.ts`, `Coolhand` class methods, exported types/classes) that was NOT the stated intention of this branch — flag these as breaking changes requiring explicit justification
- Removal or rename of exported functions/types/classes from `src/index.ts`
- Changes to `CoolhandOptions` or other config shapes that would break existing consumers

**Coolhand API accuracy**
- Where the diff touches code that calls the Coolhand API (endpoints, request/response shapes, auth headers), fetch the current published API docs from coolhandlabs.com and verify the implementation matches
- Flag any mismatches between what the code sends/expects and what the API actually accepts/returns

**Documentation & cross-SDK alignment**
- Check whether `README.md`, `CHANGELOG.md`, or files under `docs/` need updates to reflect the changes on this branch
- Verify any existing documentation touched by this diff is still accurate (no stale examples, field names, or descriptions)
- Enforce the README/docs split from `CLAUDE.md` (README stays a scannable landing page; anything needing more than one code block belongs in `docs/`)
- Flag missing `CHANGELOG.md` entries for user-visible changes
- If this branch makes a structural change (new README section pattern, new `docs/` pattern, new configuration option), `CLAUDE.md` asks for a companion issue/PR on `coolhand-python` to keep the two SDKs in sync — flag if that hasn't been mentioned anywhere

Effort: EFFORT

Already fixed in prior iterations — do NOT re-flag these:
PREVIOUS_FIXES

Return a numbered list of issues with file path and line numbers. Be specific about what to fix and why.
If there are NO issues (and the deterministic checks passed), respond with exactly: LGTM: No issues found.
---

### Step 3 — Check Result

- If the deterministic checks passed AND the agent says `LGTM: No issues found.` → exit the loop, go to Final Summary
- If iteration count has reached 5 → exit the loop, go to Final Summary (partial)
- Otherwise → proceed to Step 4

### Step 4 — Fix

Fix every issue from both the deterministic checks and the reviewer. Use Edit, Write, and Bash tools to apply fixes directly. Do not skip any finding.

### Step 5 — Log & Continue

Record this iteration in your running log (see format below), then go back to Step 1 with the next iteration number.

## Iteration Log Format

Maintain this log as you work:

```
=== Iteration 1 ===
Deterministic checks: [PASS | FAIL — list of failing checks]
Reviewer found N issues:
  1. [file:line] description
  2. ...
Fixed:
  - Applied: [description of fix]
  - Applied: [description of fix]

=== Iteration 2 ===
...

=== RESULT ===
[CLEAN after N iterations] or [STOPPED at max iterations — N issues remain]
```

## Final Summary

After the loop exits, output:

1. **Overall result**: CLEAN (N iterations) or STOPPED (issues remain)
2. **Per-iteration breakdown**: What was found (deterministic + reviewer) vs. what was fixed each round
3. **All files modified**: Complete list of files touched across all iterations
4. **Remaining issues** (if stopped at max): Unresolved items with context on why they're hard to fix automatically
