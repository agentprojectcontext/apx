# Releasing — the commit message is an input to the build

> Deep dive for [`AGENTS.md`](../AGENTS.md) rule 18. Read it before writing a
> commit message here, once.

There is no manual version bump in this repo and no release branch. Every push
to `main` that passes CI runs semantic-release, which reads the commit subjects
since the last tag and decides three things from them alone: whether there is a
new version, what number it gets, and what `CHANGELOG.md` says. `package.json`'s
version is written by a robot, in a commit nobody authored.

So a commit subject here is not a note to a future reader. It is the argument to
a program — and a wrong argument fails **silently**. The code lands on `main`,
every gate is green, no error appears anywhere, and the fix simply never reaches
anyone who installed APX from npm.

That is not hypothetical. `28710e8` is titled
`refactor(agent): improve handling of redacted answers and prevent leaks`. Its
own body says it stops the model repeating redacted information back to the
owner, and it shipped `tests/tool-markup-leak.test.js` to prove it. `refactor`
releases nothing. A leak fix with a regression test sat on `main` and waited for
somebody else's `feat` to carry it out.

## The contract

[`.releaserc.json`](../.releaserc.json) is the source of truth; this table
mirrors it. **If you change that file, change this table in the same commit.**

| Type | Version | Use it when |
|---|---|---|
| `feat` | **minor** | someone can now do something they could not do before |
| `fix` | **patch** | something that was supposed to work already, now does |
| `perf` | **patch** | same behaviour, measurably faster or cheaper |
| `revert` | **patch** | undoing something that shipped |
| `docs` | none | prose only — `docs/`, `rules/`, `README.md`, comments |
| `test` | none | tests and harnesses only, no `src/` behaviour change |
| `refactor` | none | **only** when behaviour is provably identical |
| `chore` | none | tooling, deps, housekeeping |
| `build` | none | build scripts, packaging |
| `ci` | none | workflows and gates |
| `style` | none | formatting |

`BREAKING CHANGE:` in the body releases a **minor**, not a major — an unusual
setting, deliberate, and never yet exercised (zero in the last 400 commits).
Read it as "this project does not use the major number", not as "breaking
changes are cheap".

**The trap is the bottom half of the table, not the top.** Nobody mislabels a
feature. What happens is a fix arriving as `chore`, `refactor` or `test`
because that is what the *diff* looked like to the person writing the message.
Ask what a user of APX would notice, not what the patch touched: if the answer
is "something behaves better than it did", it is `fix`, however small the diff
and however much of it is test code.

## Shape

    type(scope): subject

- **Type** is from the table. There is no other vocabulary.
- **Scope** is free-form and optional; house practice is the subsystem —
  `web`, `chat`, `engines`, `telegram`, `a2a`, `cli`, `daemon`, `e2e`.
- **Subject** is written from the outside, in es-AR: what is true now that was
  not true before, not what you edited. `fix(projects): una carpeta que se
  movió se dice, y se vuelve a enganchar sin perder el id` — not
  `fix(projects): update registry lookup`. Type and scope stay English because
  they are a fixed vocabulary the release tool parses; the subject is prose for
  a human and follows the rest of this project's voice.
- Merge commits (`Merge branch …`) are exempt. They match no rule, release
  nothing, and are the only messages in this history that skip the format.

## What happens after the push

1. `ci.yml` runs `verify` and `e2e`. Red means nothing publishes — the `release`
   job `needs` both. See [`enforcement.md`](enforcement.md).
2. `release` runs semantic-release: analyse commits → notes → `CHANGELOG.md` →
   `npm publish` → tag → GitHub release.
3. It pushes `chore(release): <version> [skip ci]`. The `[skip ci]` is what
   stops that commit from starting the cycle again.
4. The npm tarball takes minutes to propagate after the workflow goes green, so
   a green release with the old version still showing on the registry is normal
   for a few minutes and is not a failed publish.

The local `pre-push` hook is disabled inside that job on purpose: it runs
`lint:web`, which needs the panel's separate pnpm install the release job does
not do, and it used to kill every release *after* tagging.

## Before you push

    git log origin/main..HEAD --format='%s'

Read the types, not the prose. Every line that changes what a user experiences
must be `feat`, `fix` or `perf`, or it will not ship.

`.githooks/commit-msg` checks the shape — that the type is a word the release
tool knows — and reads that vocabulary from `.releaserc.json` so the two cannot
drift. It never checks the judgement: a fix titled `chore` is perfectly
well-formed, ships nothing, and is precisely what no gate can see. That half is
this file, and a reader.
