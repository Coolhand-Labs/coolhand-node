---
name: finish-release
description: |
  Finishes a release from its open release-prep PR (from /prep-release):
  squash-merges that PR, creates and pushes the vX.Y.Z tag on the merge
  commit, then publishes the GitHub release notes in the same format as the
  previous release. Pushing the tag triggers the Publish workflow (npm
  Trusted Publishing), so this is the step that ships the package. Use when
  the user types /finish-release, asks to "merge and tag the release", "publish
  the release notes", "ship v0.x.y", or has just reviewed the release-prep PR.
user_invocable: true
version: 2.0.0
---

# Finish Release

The counterpart to `/prep-release`. That skill stops at an open release PR and
never merges, tags or publishes; this one starts once the user has reviewed
that PR. **Invoking `/finish-release` is the user's authorization to merge the
release PR, tag, and publish.** Three steps, in this order: **merge, tag,
release notes**. The release is created with `--verify-tag`, so the tag has to
exist first.

**What pushing the tag does:** `.github/workflows/publish.yml` runs on any
`v*.*.*` tag push: typecheck, tests, build and CJS/ESM smoke tests, a check
that the tag matches `package.json`'s `version`, then `npm publish
--provenance` (Trusted Publishing, OIDC) in the `npm-publish` environment. That
environment has a **15-minute wait timer** and no required reviewer, so it
proceeds on its own; a full run takes about 16 minutes.

## Phase 1: Preconditions (abort on any failure, change nothing)

1. `git fetch origin main --tags`.
2. Find the release PR: `gh pr list --state open --json
   number,title,headRefName,isDraft,mergeStateStatus,url` and pick the one whose
   head is `release/vX.Y.Z` (title `chore: release vX.Y.Z`). Zero or several
   candidates: stop and ask. If none is open but a merged one exists
   (`gh pr list --state merged --search "release vX.Y.Z" --json
   number,mergeCommit`), the user merged it by hand: skip Phase 2 and use its
   merge commit. If the tag exists but no release does, resume at Phase 4
   (after confirming the tag is on the merge commit).
3. Read everything from the PR head, not the working tree:
   `git fetch origin release/vX.Y.Z`, then `git show
   origin/release/vX.Y.Z:package.json`. Call the version `X.Y.Z`; the tag is
   `vX.Y.Z`. `VERSION.md` is a stale historical doc (stuck at `0.1.0-rc1`),
   not a source of truth: ignore it. On a resume path (PR already merged), read
   from the merge commit instead, and skip the checks that no longer apply.
4. Check all of these, and stop and tell the user which one failed:
   - `X.Y.Z` is greater than the latest tag (`git describe --tags --abbrev=0
     origin/main`).
   - `src/version.ts` (`PACKAGE_VERSION`) and both `version` fields at the top
     of `package-lock.json` show `X.Y.Z` on the PR head. CI only checks
     `package.json`, so a missed `sync-version` or lockfile bump would
     otherwise publish silently.
   - `CHANGELOG.md` on the PR head has a `## [X.Y.Z] - YYYY-MM-DD` heading.
   - The PR is open, not a draft, `mergeStateStatus` is `CLEAN`, and
     `gh pr checks <n>` shows every check passed (none pending or failing).
     `main` has no branch protection, so this is the only gate.
   - The tag does not exist locally (`git tag -l vX.Y.Z`) or on the remote
     (`git ls-remote --tags origin 'vX.Y.Z*'`), and `gh release view vX.Y.Z`
     fails.

## Phase 2: Merge

1. Save the PR's current description outside the repo:
   `gh pr view <n> --json body --jq .body > /tmp/release-pr-body-vX.Y.Z.md`.
2. `gh pr merge <n> --squash --delete-branch --subject "release vX.Y.Z
   (#<n>)" --body-file /tmp/release-pr-body-vX.Y.Z.md`. The squash title has no
   `chore:` prefix (the PR's own title does); `--subject` is used verbatim, so
   keep the `(#<n>)` suffix. The default squash body would be the
   commit list, hence the explicit PR body. Add no AI attribution. Never use
   `--admin` or bypass checks; if the merge is refused, stop and report.
3. `git fetch origin main --tags`. Get the merge commit with `gh pr view <n>
   --json mergeCommit --jq .mergeCommit.oid` and confirm it is on
   `origin/main`. Re-read `package.json`, `src/version.ts`, `package-lock.json`
   and the CHANGELOG heading at that sha (`git show <sha>:...`): they must
   still say `X.Y.Z`.

## Phase 3: Tag

1. `git tag vX.Y.Z <merge commit sha>`. Tag the merge commit, not `origin/main`
   HEAD, in case `main` moved. Lightweight, like every tag since v0.11.0 (a few
   older ones are annotated; the workflow doesn't care).
2. `git push origin refs/tags/vX.Y.Z`. Push only that ref, never `--tags`: a
   stray local tag from an aborted release would trigger its own publish run.
   Never run `npm publish` locally; CI publishes.
3. Verify with `git ls-remote --tags origin 'vX.Y.Z*'`. The `git push` output
   can be swallowed by the shell's output filter, so don't trust its silence;
   the line must show the merge commit.

## Phase 4: Release notes

1. Fetch the previous release as the format template:
   `gh release view v<previous> --json body --jq .body`. Releases here are the
   CHANGELOG section for the version, re-headed for the Releases page:
   `## [X.Y.Z] - YYYY-MM-DD` as the first line, then `###` sections with the
   emoji dropped and a few names changed: `✨ New Features` becomes
   `What's New`, and `🧹 Internal` plus `🔧 Build & CI` fold into
   `Maintenance`. Other names (`Upgrade Notes`, `Security`, `Bug Fixes`,
   `Documentation`, `Breaking Changes`) are kept. There is no Known Follow-ups
   or Resources section. Include only sections with content, in changelog order.
2. Start from the `## [X.Y.Z]` CHANGELOG section at the tag, and read the PRs
   since the previous tag (`git log v<previous>..vX.Y.Z --oneline`) for
   anything it compresses. Keep full `https://github.com/...` URLs.
3. **Verify every claim and every link before publishing.** Check that each
   `#N` referenced exists (`gh issue view <n> --json state` / `gh pr view <n>`),
   that every method, option and doc path named (for example
   `docs/declared-workloads.md`) exists at the tag, and that anything marked as
   fixed or closed really is. Don't describe a behavior you haven't read in the
   code or the PR. A release note that misstates scope is worse than a short one.
4. Write the notes to `/tmp/release-notes-vX.Y.Z.md`, outside the repo
   (`.context/` is not gitignored here).
5. `gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes-file
   /tmp/release-notes-vX.Y.Z.md --latest`. Not a draft and not a prerelease,
   same as the previous release. Confirm with
   `gh release view vX.Y.Z --json name,tagName,isDraft,url`.

## Phase 5: Report

State, in the final message:
- The merged PR number and its merge commit (or that the user had already
  merged it), and the tag on that commit.
- The release URL.
- The Publish workflow run (`gh run list --workflow publish.yml --limit 1`):
  it waits 15 minutes in `npm-publish`, then publishes. Never publish by
  another route. If asked whether it's live, check `gh run view <id>` and
  `npm view coolhand-node version` (should print `X.Y.Z`).

## Rationalizations to resist

- *"The version in my working tree says X.Y.Z, close enough."* Read it from the
  PR head, then re-check at the merge commit. Tagging a stale checkout
  publishes the wrong code.
- *"The checks are probably green."* `main` is unprotected, so nothing stops a
  red merge. Run `gh pr checks` and read it.
- *"CI checks the version, so I can skip the consistency check."* CI compares
  the tag to `package.json` only, and npm versions can't be republished.
- *"I'll use the default squash message."* The title and body are the record of
  the release. Use `release vX.Y.Z (#N)` and the PR description.
- *"I'll tag `origin/main` HEAD, it's the same thing."* Not if `main` moved.
- *"I'll publish the notes first and tag after."* `--verify-tag` exists so a
  release can't point at nothing; GitHub would otherwise create the tag itself
  from the default branch tip, unreviewed, and start a publish run.
- *"The changelog is already written, I'll paste it as the notes."* Check it
  against the merged PRs and confirm every link and doc path exists.
- *"`git push` printed nothing, so it probably worked."* Run `git ls-remote`.
