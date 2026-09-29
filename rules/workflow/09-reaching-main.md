# 09 — Reaching `main`: branches, the e2e gate, hotfixes

> Deep dive for [`AGENTS.md`](../../AGENTS.md) rule 19. Read it before you push
> anything whose destination is `main`, and before you merge a branch into it.

`main` is not a working branch. Every push to it that passes CI **publishes to
npm** (see [`../releasing.md`](../releasing.md)), so it only takes code that has
already passed the whole suite, including a real browser against a first
install.

## Where work happens

| Branch | What goes there | Who merges it |
|---|---|---|
| `staging` | integration: several features, the end of a test cycle | merged into `main` when the gate is green |
| `feat/*`, `fix/*`, `test/*`, … | one change | merged into `staging` (or into `main` directly, through the same gate) |
| `hotfix/<slug>` | one urgent fix to something already broken on `main` | pushed to `main` directly — see below |
| `main` | only merges and hotfixes | nobody commits here |

CI (`ci.yml`) runs `verify` + `e2e` on every pull request and on every push to
`main` and `staging`, so a red integration branch is visible **before** anyone
merges it.

## The gate

```bash
npm run preflight        # lint, lint:web, test:ci, web build, panel tsc, TUI ratchet
npm run e2e:gate         # Playwright against a fresh install (scripts/e2e-gate.js)
```

`e2e:gate` boots a daemon of its own on `:7530` with an empty `APX_HOME`, serves
the production bundle from it, and runs every spec in
`src/interfaces/web/e2e/` — including `26-usability-journeys`, which drives the
panel the way a person does (open a dialog from each screen that can open it,
wait, check it stayed; navigate and come back; submit a form). It never touches
your `~/.apx` or the daemon on `:7430`. About three minutes.

**`pnpm e2e` is not the gate.** It drives your live daemon, with your real
projects, and cannot show what a new user sees — which is precisely where the
add-project dialog broke on 2026-09-28. Use it to iterate; trust the gate.

## Merging into `main`

```bash
git fetch origin
git log --oneline <branch>..origin/main   # what main has that you don't — another fix may already be there
git switch main && git pull --ff-only
git merge --no-ff <branch>
git push origin main                      # pre-push runs preflight AND the e2e gate
```

The pre-push hook asks `scripts/push-policy.js` about every ref you push. For
`main` it:

1. **refuses** any commit that exists only on main — i.e. was not first on
   `staging` or a feature branch — and says how to mark a real hotfix;
2. runs preflight (as for every push), then **the e2e gate**. Red means the
   push does not happen.

The same end-of-cycle rule applies to test and infrastructure work: the branch
that built a gate merges into `main` only after that gate is green.

## Hotfixes

A hotfix is a fix to something already broken on `main` that cannot wait for the
next integration. It may skip `staging`. **It does not skip the tests**: the
same preflight + e2e gate run. The bug that started this rule was itself a
hotfix to the web panel, and three minutes of e2e would have caught it.

Mark it explicitly — one of:

```bash
git push origin hotfix/inbox-dialog:main    # from a hotfix/<slug> branch
APX_HOTFIX=1 git push origin main           # a commit made on main
```

Then merge `main` back into `staging` so the fix is not lost at the next merge.

## What GitHub enforces

The ruleset `main: no force-push, no deletion (rule 19)` forbids exactly
that on `main`; the repository admin bypasses it. Both rules leave the
fast-forward push semantic-release makes untouched.

It does **not** require the `verify` and `e2e` checks, and that is a known gap,
not an oversight. semantic-release pushes `chore(release): x.y.z [skip ci]` to
`main` with the workflow's `GITHUB_TOKEN`; a `[skip ci]` commit never gets
checks, so requiring them would block every release after tagging — and a
repository ruleset refuses the GitHub Actions app as a bypass actor ("must be
part of the ruleset source or owner organization"). Closing the gap needs the
release job to push with a credential that CAN bypass (a deploy key or an
admin's token as a secret). Until then "green before main" is held by the
pre-push hook, by CI on every PR and `staging` push, and by `release`
refusing to publish unless `verify` and `e2e` passed on that exact commit.

## What is NOT enforced

- `git push --no-verify` skips the hook entirely. It is there for a broken hook,
  not for a red gate; using it to land red code on `main` is the thing this
  file exists to stop, and CI will still block the release.
- Nothing checks that a branch called `hotfix/*` really is one. The label is a
  claim the reviewer reads.
