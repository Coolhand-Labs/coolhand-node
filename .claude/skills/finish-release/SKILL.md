---
name: finish-release
description: |
  Finishes a release once its release-prep PR (from /prep-release) has been
  merged: creates and pushes the vX.Y.Z tag on main, then publishes the
  GitHub release notes in the same format as the previous release. Pushing
  the tag triggers the Publish workflow (npm Trusted Publishing), so this is
  the step that ships the package. Use when the user types /finish-release,
  asks to "tag the release", "publish the release notes", "ship v0.x.y", or
  has just merged the release-prep PR.
user_invocable: true
version: 1.0.0
---

# Finish Release

The counterpart to `/prep-release`. That skill stops at an open release PR and
never tags or publishes; this one starts after the user has reviewed and merged
that PR. Running it is the user's go-ahead to tag and publish. Two steps, in
this order: **tag, then release notes**. The release is created with
`--verify-tag`, so the tag has to exist first.

**What pushing the tag does:** `.github/workflows/publish.yml` runs on any
`v*.*.*` tag push. The `build` job runs `npm ci`, typecheck, tests, build and
the CJS/ESM smoke tests, then fails unless the tag matches `package.json`'s
`version`. The `publish` job then runs `npm publish --provenance` (npm Trusted
Publishing, OIDC) in the `npm-publish` environment, which has a **15-minute
wait timer** and no required reviewer, so it proceeds on its own. A full run
takes about 16 minutes. Say so in the final report.

## Phase 1: Preconditions (abort on any failure, change nothing)

1. `git fetch origin main --tags`.
2. Read the version from `origin/main`, not from the working tree:
   `git show origin/main:package.json`. Call it `X.Y.Z`; the tag is `vX.Y.Z`.
   `VERSION.md` is a stale historical doc (stuck at `0.1.0-rc1`), not a source
   of truth: ignore it and do not edit it.
3. Check all of these, and stop and tell the user which one failed:
   - `X.Y.Z` is greater than the latest tag (`git describe --tags --abbrev=0
     origin/main`). If equal, the release PR has not merged yet (or the version
     was never bumped).
   - The version is consistent on `origin/main`: `src/version.ts`
     (`PACKAGE_VERSION`) and both `version` fields at the top of
     `package-lock.json` show `X.Y.Z`. CI only checks `package.json`, so a
     missed `sync-version` or lockfile bump would otherwise publish silently.
   - `git show origin/main:CHANGELOG.md` has a `## [X.Y.Z] - YYYY-MM-DD` heading.
   - The tag does not already exist, locally (`git tag -l vX.Y.Z`) or on the
     remote (`git ls-remote --tags origin 'vX.Y.Z*'`), and no release exists
     (`gh release view vX.Y.Z` fails). If the tag exists but the release does
     not, skip Phase 2 and resume at Phase 3, after confirming the tag points at
     the commit that set the version.
   - The release-prep PR is merged: `gh pr list --state merged --search
     "release vX.Y.Z" --json number,mergeCommit`. Note its merge commit.
4. The tag target is `origin/main` HEAD, and it must contain the version bump
   (it does if step 3 passed). Do not tag a local branch or a stale checkout.

## Phase 2: Tag

1. `git tag vX.Y.Z <sha of origin/main>`. Lightweight, like every tag since
   v0.11.0 (the older v0.3.0, v0.10.0 and v0.10.1 are annotated; the workflow
   doesn't care either way). Check `git cat-file -t v<previous>` if in doubt.
2. `git push origin refs/tags/vX.Y.Z`. Push only that ref, never `--tags`: a
   stray local tag from an aborted release would trigger its own publish run.
3. Verify with `git ls-remote --tags origin 'vX.Y.Z*'`. The `git push` output
   can be swallowed by the shell's output filter, so don't trust its silence;
   the line must show the intended commit (a lightweight tag has no `^{}` line).

Never run `npm publish` locally; CI publishes.

## Phase 3: Release notes

1. Fetch the previous release as the format template:
   `gh release view v<previous> --json body --jq .body`. Releases here are the
   CHANGELOG section for the version, re-headed for the Releases page:
   `## [X.Y.Z] - YYYY-MM-DD` as the first line, then `###` sections with the
   emoji dropped and a few names changed: `✨ New Features` becomes
   `What's New`, and `🧹 Internal` plus `🔧 Build & CI` fold into
   `Maintenance`. `Upgrade Notes`, `Security`, `Bug Fixes`, `Documentation`
   and `Breaking Changes` keep their names. There is no Known Follow-ups or
   Resources section. Include only sections that have content, in changelog
   order, with the same bullet style (bold lead, details, trailing
   `([#N](https://github.com/Coolhand-Labs/coolhand-node/issues/N), [#M](.../pull/M))`).
2. Source the content from the `## [X.Y.Z]` CHANGELOG section on `origin/main`
   and the merged PRs since the previous tag (`git log
   v<previous>..vX.Y.Z --oneline`). Start from the changelog text, but don't
   copy it blind: read the PRs and the diff for anything the changelog
   compresses. Keep full `https://github.com/...` URLs (the notes render on
   the Releases page), and keep new-API examples and migration notes for
   anything behavior-affecting.
3. **Verify every claim and every link before publishing.** Check that each
   `#N` referenced exists (`gh issue view <n> --json state` / `gh pr view <n>`),
   that every method, option and doc path named (for example
   `docs/declared-workloads.md`) exists on `origin/main`, and that anything
   marked as fixed or closed really is. Don't describe a behavior you haven't
   read in the code or the PR. A release note that misstates scope is worse
   than a short one.
4. Write the notes outside the repo, e.g. `/tmp/release-notes-vX.Y.Z.md`
   (there is no gitignored scratch directory, so don't leave a file in the
   working tree).
5. `gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes-file
   /tmp/release-notes-vX.Y.Z.md --latest`. Not a draft and not a prerelease,
   same as the previous release. Confirm with
   `gh release view vX.Y.Z --json name,tagName,isDraft,url`.

## Phase 4: Report

State, in the final message:
- The tag and the commit it points at.
- The release URL.
- The Publish workflow run (`gh run list --workflow publish.yml --limit 1`):
  it sits in the `npm-publish` wait timer for 15 minutes, then publishes. Do
  not publish by any other route. If the user asks whether the package is
  live, check again (`gh run view <id>` and `npm view coolhand-node version`,
  which should print `X.Y.Z`).

## Rationalizations to resist

- *"The version in my working tree says X.Y.Z, close enough."* Read it from
  `origin/main`. Tagging a stale checkout publishes the wrong code.
- *"CI checks the version, so I can skip the consistency check."* CI compares
  the tag to `package.json` only. `src/version.ts` and `package-lock.json`
  can still be stale, and npm versions can never be republished.
- *"I'll publish the notes first and tag after."* `--verify-tag` exists so a
  release can't point at nothing; GitHub would otherwise create the tag itself
  from the default branch tip, unreviewed, and start a publish run.
- *"The changelog is already written, I'll paste it as the notes."* Check it
  against the merged PRs first, and confirm every referenced issue, PR and
  doc path exists.
- *"`git push` printed nothing, so it probably worked."* Verify with
  `git ls-remote`.
