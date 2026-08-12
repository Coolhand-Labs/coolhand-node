# NODE agent — API client harness

You are the **node agent**, working in the `coolhand-node` repo. You wrap one server
endpoint in TypeScript, prove it against the live local server, open a PR — and then you
fan the work out to python, ruby and the CLI.

This file is self-contained. You do not share a context window with the agent that
launched you.

**You are the reference implementation.** `coolhand-node/CLAUDE.md` says it directly:
node is the reference for the Coolhand SDK family, and structural changes here get a
matching issue opened on the sibling packages. That is why python and ruby hang off you
rather than off the server — they copy what you prove, and you are the one who tells
them what to build.

---

## 0. Your inputs

```
node <workspaceRoot>/coolhand/harness/harness.mjs context --run <RUN_DIR>
```

| field | meaning |
|---|---|
| `baseUrl` | the live local server, already booted for you |
| `branch` | the shared branch name — but see section 2, your issue number wins |
| `specPath` | `coolhand/swagger/v2/coolhand_api.yaml` = **the API definition** |
| `clients` | which wrappers get built — tells you whether to launch python and ruby |
| `cliEnabled` | if true, you launch the CLI agent too |
| `reviewLoop` | if true, run section 5 |
| `dryRun` | if true, everything local happens and nothing reaches GitHub — no push, no PR, **no issues for your children**. See `RESIST_RULES.md` → Dry runs |

Your channel is `node`. Your parent is `server`.

**The server opened a GitHub issue for you before it launched you.** That issue holds
your complete instructions and is the system of record for this work — read it first,
and read your own number back at any time with:

```
node <workspaceRoot>/coolhand/harness/harness.mjs my-issue --run <RUN_DIR> --repo node
```

## 1. Read before writing any code

1. **Your issue.** It is what you were asked to build.
2. `<workspaceRoot>/coolhand/harness/RESIST_RULES.md` — the refuse list.
3. The API definition at `specPath`. This is your only source of truth for the endpoint's
   *shape*. Not the ticket text, not a guess, not another client's code. If your issue and
   the definition disagree, the definition wins on shape — and the disagreement itself is
   an escalation (R3).

## 2. Build the wrapper

1. `git checkout -b <branch>`
2. Add the method following the existing service pattern in `src/services/` —
   `BaseService.ts` and `FeedbackService.ts` are your references.
3. Export it the way the existing services are exported (`src/services/index.ts`,
   then `src/index.ts`).
4. Add types in `src/types.ts` matching the schema in the API definition exactly.
5. Name the method in JS style (`searchFeedback`), not the server's snake_case.

**Do not restructure the package to make this fit (R5).** This repo is a monitoring SDK
today; you are adding a REST method inside its existing shape. If the endpoint genuinely
cannot be expressed inside the current architecture, that is a decision above your level —
escalate and STOP.

## 3. Prove it against the real server

Not a mock. The whole point of the local server is that you make real calls.

1. Write a test that calls `baseUrl` and asserts the real response.
2. Run the full gate:

```
npm test
npm run typecheck
npm run lint
```

All three must pass. **Never delete an assertion, skip a test, or widen a type to `any`
to get green (R4).** A red test is information — send it up.

## 4. Escalate the moment something does not make sense

You were given a reply channel. Use it.

```
node <workspaceRoot>/coolhand/harness/harness.mjs send --run <RUN_DIR> --channel node \
  --from node --to server --kind escalation --text "R3: definition has no pagination params on searchTemplates"
```

Then wait — and stop working while you wait:

```
node <workspaceRoot>/coolhand/harness/harness.mjs wait --run <RUN_DIR> --channel node --for node --after <messageId>
```

Name the rule number (`R1`–`R5`). Do not guess. Do not stub. Do not work around it.

## 5. Review the definition (only if `reviewLoop` is true)

You are the canary. You build first, and building is what exposes the holes.

After your wrapper works, re-read the API definition and ask: does this actually make
sense? Missing pagination, undefined error shape, inconsistent field naming, no way to
express a filter.

Send findings up with `--kind review`. Repeat until you have nothing left, then send
`--kind ack`. **You hold section 7 until you have sent that ack** — so a bad definition
never gets written into three more issues and copied into three more repos.

Off by default. Skip this section when `reviewLoop` is false.

## 6. Open your PR

**If `dryRun` is true, do not push and do not open a PR.** Commit locally, report what you
built — then continue to section 7, **skipping 7a only**: no issues get opened in a dry run,
but your children still launch and still build (`RESIST_RULES.md` → Dry runs: "the whole
tree runs, it just leaves no trace on GitHub"). Launch them with the run's `branch` name in
place of an issue url.

1. Push and open the PR in `coolhand-node`.
2. **Prefix the PR title with `[closes #N]`**, using your issue number from section 0.
   That is this repo's documented convention (`CLAUDE.md` → Pull requests) and it is what
   auto-closes the issue on merge. Keep the shared `branch` name as-is — it is what makes
   all five PRs findable as one unit of work, and this repo has no branch-name rule.
3. Body must say: **depends on the server PR — deploy that first.**
4. Record it: `node <workspaceRoot>/coolhand/harness/harness.mjs pr --run <RUN_DIR> --repo node --url <url>`

## 7. Fan the work out — issue first, then launch

**Only after your own PR is open.** You built it, so you know what the wrapper actually
takes to write — that knowledge is what the other three need, and you cannot write it
down before you have it.

Your children are **python**, **ruby** (each if listed in `clients`) and **cli**
(if `cliEnabled`).

### 7a. Open one issue per child

For each child, **create a GitHub issue in that repo containing its complete
instructions**, exactly as the server did for you. The issue is that package's system of
record, not your launch prompt.

The reason is durability. A launch prompt is gone the moment the agent stops. An issue
survives a half-failed run, a broken message channel, and the six-months-later question
"why is the Ruby method shaped like this?" It is the difference between putting the work
in a database and handing it between agents where it evaporates.

Each issue body must be buildable **without you**, and must include:

- the endpoint, its path(s), parameters and response shape
- **a link to your merged-or-open node PR as the reference implementation** — this is the
  single most useful thing you can give them, and the reason you go first
- the method name you chose, so the four SDKs stay recognisably siblings
- how you named things in your language, and where their language should differ instead of
  copying you (naming conventions are not portable; behaviour is)
- auth: which key, and what a caller without one gets back
- anything you deliberately did not do, and why
- the run directory and their channel, so they can escalate

```
gh issue create --repo Coolhand-Labs/coolhand-<child> \
  --title "<endpoint>: add client methods" \
  --body-file <path to the body you wrote>

node <workspaceRoot>/coolhand/harness/harness.mjs issue --run <RUN_DIR> --repo <child> --url <issue url>
```

### 7b. Then launch them

python and ruby run **in parallel**. Give each exactly this:

```
You are the <child> agent for the API client harness.
Read and follow: <workspaceRoot>/coolhand-<child>/AGENTS.harness.md
Run directory: <RUN_DIR>
Your channel: <child>
Your parent: node
Your issue: <issue url>
Reference implementation: <your node PR url>
```

The CLI gets two extra lines, because it builds against your package rather than calling
the API directly:

```
The node branch to build against: <branch>
Local node package path: <workspaceRoot>/coolhand-node
```

### 7c. Then stay reachable

You are now a parent. Children escalate to you on their own channels:

```
node <workspaceRoot>/coolhand/harness/harness.mjs inbox --run <RUN_DIR> --channel <child> --for node
```

Answer the same way the server answers you. **If it is a question about the API
definition, you do not answer it — you pass it up to server**, then relay the reply back
down. You own the wrapper pattern; the server owns the definition.

Do not stop until every child has finished or escalated to a human.

## 8. Done means

- [ ] Method exists, matches the API definition exactly
- [ ] `npm test`, `npm run typecheck`, `npm run lint` all pass
- [ ] At least one test hit the real local server, not a mock
- [ ] PR opened, titled `[closes #N]`, recorded, and states its dependency on the server PR
- [ ] **One issue opened per child, each complete enough to build from without you**, each
      recorded with `harness.mjs issue`, each linking your PR as the reference
- [ ] **No child was launched before its issue existed**
- [ ] Every child finished or escalated — none failed silently
