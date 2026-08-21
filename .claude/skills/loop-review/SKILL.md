---
name: loop-review
description: |
  Iteratively runs code review against the current diff, applies fixes, and
  re-reviews until a round comes back clean (or a safety cap is hit). Use
  when the user types /loop-review, asks to "loop the review", "review
  until clean", "keep reviewing and fixing until nothing's left", or wants
  a self-healing code review cycle instead of a single one-shot pass.
user_invocable: true
version: 0.1.0
---

# Loop Review

This skill runs `/code-review` repeatedly against the working diff, applies
fixes between rounds, and re-reviews until a round finds nothing new or a
safety cap is reached. Use it after a large diff, or whenever a single
review pass isn't enough to converge on a clean state.

## Scope

Review scope is `git diff origin/main` — NOT the triple-dot `origin/main...HEAD`
form. The triple-dot form only sees committed history and silently returns
empty on a branch whose work is still uncommitted, which would make the
reviewer rubber-stamp "LGTM" on real, unreviewed changes. `git diff origin/main`
compares the working tree directly against `origin/main`, so it always covers
whatever mix of commits and uncommitted changes is actually on disk.

`$ARGUMENTS` may contain an effort level to pass through to `/code-review`
(`low`/`medium`/`high`/`max`). Default: `high`.

`$ARGUMENTS` may also contain a round cap override, e.g. `--max-rounds 3`.
Default: 5.

## The round loop

Repeat the following cycle up to the round cap (default 5). Bracket each
round's wall-clock time with `date +%s` before step 1 and after step 3
completes.

1. **Deterministic checks.** Run this repo's verify gate from `CLAUDE.md`
   (mirrors what CI runs as separate lint/typecheck/test jobs):

   ```bash
   npm run lint && npm run typecheck && npm test
   ```

   Treat any failing line (lint error, type error, or test failure) as a
   finding with the same weight as a reviewer-reported issue — the review
   step below does not substitute for this.

   Also run `git status --short`. Brand-new untracked files (`??`) don't
   show up in `git diff origin/main` at all, which would let a new file
   skip review entirely. If there are any, run `git add -N <path>...`
   (intent-to-add — stages the path as an empty file without staging its
   content, so it appears as a full addition in the diff without actually
   changing what would be committed) before the review step.

2. **Review.** Invoke `/code-review <effort> --fix` (via the `Skill` tool)
   against `git diff origin/main`. Every finding must carry a severity:
   - `[CRITICAL]` — security vulnerabilities, wrong/broken behavior,
     performance problems
   - `[NICE-TO-HAVE]` — DRY violations, missing test coverage,
     code-reuse opportunities
   - `[NITPICK]` — documentation, comments, naming, formatting-adjacent
     issues

   If `/code-review`'s own output isn't already severity-tagged, tag each
   finding yourself before logging it. Also record your best estimate of
   tokens used by the review step this round (approximate, not metered).

3. **Disposition.** For every finding this round — deterministic-check
   failures and reviewer findings alike — record exactly one of:
   **fixed** (by `--fix` or your own follow-up Edit/Write/Bash), or
   **rejected: `<one-line reason>`** (false positive / out of scope /
   disagree with the call). None may be silently dropped. Deterministic
   check failures should essentially never be rejected. Log the round
   using the Iteration Log Format below, then append a row to the CSV run
   log.

4. **Dry round (0 findings from both deterministic checks and review) →
   converged.** Stop and move to post-loop verification.

5. **Findings found and fixed** → do not declare victory yet. Go back to
   step 1 for a confirming round — fixes can introduce their own
   regressions, and a clean-looking pass doesn't guarantee convergence.

6. **No-progress detection**: if two consecutive rounds return the same
   non-empty set of findings, `--fix` isn't resolving them mechanically
   (likely a design/architecture call that needs a human). Stop looping,
   list the stuck findings with their rejection reasons, and hand them to
   the user instead of retrying forever.

7. **Safety cap**: if the round cap is reached without converging or
   getting stuck, stop and report the remaining findings — don't loop
   silently past the cap.

Each round's fixes should stay reviewable: don't squash multiple rounds
into one silent edit. Note per-round changes in the final summary so the
user can inspect them with `git diff`.

## Iteration Log Format

Maintain this log as you work:

```
=== Round 1 ===
Deterministic checks: [PASS | FAIL — list of failing checks]
Reviewer found N issues (X critical, Y nice-to-have, Z nitpick):
  1. [CRITICAL] [file:line] description
  2. ...
Fixed: F, Rejected: R
  - Applied: [description of fix]
  - Rejected: [description] — [reason]

=== Round 2 ===
...

=== RESULT ===
[CLEAN after N rounds] or [STOPPED — N issues remain]
```

## Run Log (CSV)

After the loop exits (before Final Summary), append one row per round to
`~/loop-review-outputs/coolhand-node.csv`. Create the directory and file
with this header if they don't already exist:

```
timestamp,branch,round,effort,clock_seconds,tokens_used_approx,critical_found,nice_to_have_found,nitpick_found,total_found,issues_fixed,issues_rejected
```

Use `date -u +%Y-%m-%dT%H:%M:%SZ` for `timestamp` at write time. `branch`
= `git branch --show-current`. `effort` = the effort level used that
round (see Scope). `tokens_used_approx` is your estimate from step 2.
`issues_fixed`/`issues_rejected` are the counts from step 3. Append with
plain `cat >> ~/loop-review-outputs/coolhand-node.csv <<EOF ... EOF` — no
CSV quoting needed.

## Review criteria

Beyond whatever `/code-review` already checks for correctness bugs and
reuse/simplification/efficiency, every round should also flag:

**Correctness & quality**
- Correctness bugs and logic errors
- Missing/broken error handling — in particular, whether error semantics
  match the surrounding convention (services that swallow errors and
  return `null`, e.g. `createFeedback`/`logRequestToAPI`, vs. services
  that throw with a `.status`-carrying error, e.g. `McpService`/
  feedback-read methods)
- Inefficiencies or unnecessary complexity
- Violations of project conventions in `CLAUDE.md`, especially its "Code
  conventions" section:
  - **TypeScript best practices**: `any`/loose typing used where a
    precise interface was possible, non-null assertions (`!`) or casts
    papering over a missing check, over-annotated locals where inference
    already works
  - **DRY**: new fetch/error-handling/request-building logic that
    duplicates something already in `BaseService` or a sibling service,
    or the same logic repeated twice within one class instead of factored
    into a private helper (but don't flag a single, one-off snippet as a
    missing abstraction — see `CLAUDE.md`'s premature-abstraction caveat)

**npm package publishing discipline**
- Follow best practices for TypeScript & Node.js and for npm package
  publishing — don't break public interfaces unless necessary
- If a break is necessary, it must come with: appropriate documentation
  updates and a SemVer-consistent version bump
- Any change to the public API surface (`src/index.ts`, `Coolhand` class
  methods, exported types/classes) that was NOT the stated intention of
  this branch — flag these as breaking changes requiring explicit
  justification
- Removal or rename of exported functions/types/classes from `src/index.ts`
- Changes to `CoolhandOptions` or other config shapes that would break
  existing consumers

**Security**
- Injection vulnerabilities (command injection, SSRF via a user-controlled
  `baseUrl`, etc.)
- Secrets, API keys, or credentials hardcoded or logged
- Unsafe use of user-supplied input
- Public vs. private API key confusion (methods that should require the
  private key silently accepting the public key, or vice versa)

**Coolhand API accuracy**
- Where the diff touches code that calls the Coolhand API (endpoints,
  request/response shapes, auth headers), fetch the current published API
  docs from coolhandlabs.com and verify the implementation matches
- Flag any mismatches between what the code sends/expects and what the
  API actually accepts/returns

**Documentation & cross-SDK alignment**
- Check whether `README.md`, `CHANGELOG.md`, or files under `docs/` need
  updates to reflect the changes on this branch
- Verify any existing documentation touched by this diff is still
  accurate (no stale examples, field names, or descriptions)
- Enforce the README/docs split from `CLAUDE.md` (README stays a
  scannable landing page; anything needing more than one code block
  belongs in `docs/`)
- Flag missing `CHANGELOG.md` entries for user-visible changes
- If this branch makes a structural change (new README section pattern,
  new `docs/` pattern, new configuration option), `CLAUDE.md` asks for a
  companion issue/PR on `coolhand-python` to keep the two SDKs in sync —
  flag if that hasn't been mentioned anywhere

## Post-loop verification

Once the loop converges (or stops early per the rules above), run:

```bash
npm run lint && npm run typecheck && npm test
```

and include the result in the final summary.

## Final Summary

After the loop exits, output:

1. **Overall result**: CLEAN (N rounds) or STOPPED (issues remain)
2. **Per-round breakdown**: What was found (deterministic + reviewer, with
   severity breakdown) vs. what was fixed/rejected each round
3. **All files modified**: Complete list of files touched across all
   rounds
4. **Remaining issues** (if stopped): Unresolved items with context on
   why they're hard to fix automatically
5. **Run log**: Number of CSV rows appended and the path
   (`~/loop-review-outputs/coolhand-node.csv`)

## Rationalizations to resist

- *"The first round already looked clean, I don't need a confirming
  round."* A fix round can introduce its own regression. Always re-review
  after applying fixes before declaring convergence.
- *"Lint and typecheck passed, so the review is done."* Passing
  deterministic checks is not the same as the review being clean — they
  don't check the criteria above (interface breakage, changelog
  discipline, security, API accuracy). Run both.
- *"This finding keeps coming back, I'll just keep re-running --fix and
  it'll eventually take."* If the same non-empty finding set repeats
  across two rounds, `--fix` isn't going to resolve it. Stop and surface
  it — looping past that point just burns rounds for no gain.

## Safety

- Never force-push or amend existing commits as part of this loop.
- The skill only edits the working tree; committing and pushing stays with
  the user.
