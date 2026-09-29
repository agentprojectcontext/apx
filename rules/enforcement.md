# What is enforced, and by what

> Deep dive for [`AGENTS.md`](../AGENTS.md). Read it before trusting a rule.
>
> The hub states 19 rules in the same voice, so they all read as equally
> binding. They are not. Some are build errors that stop a push; others are
> prose that only review catches. Knowing which is which is the difference
> between "the gate will catch me" and "nobody will notice for three months" —
> and the second one is how the panel accumulated two React crashes that no
> gate could see.
>
> When you add a gate, add its row here. When you write a rule nothing enforces,
> say so in its row rather than leaving the reader to assume.
>
> And when you *raise* a gate, correct its row in the same commit. This table
> claimed a coverage floor of 72/71/65 long after `scripts/test-ci.js` had been
> ratcheted to 77/72/71 — a doc that understates a gate teaches people the gate
> is looser than it is.

## The three checkouts problem

This repo is one git repository and **three separate pnpm projects**:

| Project | Lockfile | Installed by | Linted by |
|---|---|---|---|
| root (core, host, cli, tui, desktop, android) | `pnpm-lock.yaml` | `pnpm install` | root `eslint.config.js` |
| web panel `src/interfaces/web` | its own `pnpm-lock.yaml` **and** its own `pnpm-workspace.yaml` | `cd src/interfaces/web && pnpm install` | its own `eslint.config.js` |
| docs site `docs/` | its own `pnpm-lock.yaml` | `cd docs && pnpm install` | nothing |

This is the single most misleading thing about the layout. `npm run lint` at
the root reports success having never opened a file in the panel — the root
config ignores `src/interfaces/web/**` on purpose, because a config with no
TypeScript parser cannot read `.tsx`. For most of the panel's life that meant
~47k lines with a type check and no linter, which is how a hook called after an
early return survived in two separate components.

**So: two lint commands, not one.** `npm run preflight` runs both.

## Machine-enforced — these fail the build

| What | Rule | Enforced by |
|---|---|---|
| `core/` must not import `#host/*` or `#interfaces/*` | 8 | root `eslint.config.js` (AST selector, not a glob — see the note in that file) |
| `host/` must not import `#interfaces/*` | 8 | root `eslint.config.js` |
| No rebuilding `~/.apx` paths from `os.homedir()` | 13 | root `eslint.config.js` (`NO_HOMEDIR`) |
| Async route handlers wrapped in `asyncRoute()` | 15 | root `eslint.config.js` (`ASYNC_ROUTE`) |
| No skipped or todo tests | 1 | `scripts/test-ci.js` |
| Coverage floor (line 83 / branch 75 / function 77) | 1 | `scripts/test-ci.js` (`COVERAGE_FLOOR`) |
| Every i18n key in **both** `en.ts` and `es.ts` | 11 | `tests/web-guardrails.test.js` |
| No Radix, no `components.json` | 11 | `tests/web-guardrails.test.js` |
| Panel requests go through `src/lib/api/*` | 11 | `tests/web-guardrails.test.js` |
| User-visible labels start with a Capital | 11a | `tests/web-guardrails.test.js` (`SENTENCE_FRAGMENTS` allowlist) |
| React hooks rules; no unused vars in the panel | — | `src/interfaces/web/eslint.config.js` |
| URL query written only as `setParams((prev) => …)` — never a whole new query | 11 | `src/interfaces/web/eslint.config.js` (`no-restricted-syntax`) |
| Commits reach `main` only by merge, or as a marked hotfix | 19 | `.githooks/pre-push` → `scripts/push-policy.js`, pinned by `tests/push-policy.test.js` |
| A push to `main` passes the e2e gate (fresh install, real journeys) | 19 | `.githooks/pre-push` → `scripts/e2e-gate.js`; CI job `e2e` runs the same script |
| No force-push to `main`, no deleting it | 19 | GitHub ruleset on `main` (bypass: repo admin). It does NOT require the checks — see [`workflow/09-reaching-main.md`](workflow/09-reaching-main.md#what-github-enforces) |
| Panel `any` + `exhaustive-deps` count may only fall | — | `scripts/lint-web.js` (baseline 38) |
| Vendored TUI type errors may only fall | — | `scripts/typecheck-tui.js` (baseline 174) |
| Panel types | 11 | `tsc --noEmit` in `src/interfaces/web` |
| SPA fallback matches the `<Routes>` registry | 9 | `tests/web-spa-fallback.test.js` |
| Runtime skill headers, `name` == dir, English-only | 6 | `tests/runtime-skills.test.js` |
| Every link in a tracked doc points at something tracked | — | `tests/docs-links.test.js` |
| Nothing reaches npm over a red CI | 2 | `.github/workflows/ci.yml` (job `release`, `needs: [verify, e2e]`) |
| Commit subject shape — `type(scope): subject`, type from `.releaserc.json` | 18 | `.githooks/commit-msg`, pinned by `tests/commit-msg-hook.test.js` |
| No real-looking WhatsApp number/LID and no `/Users/<name>` or `/Volumes/<disk>` path in a tracked file (public shapes — runs in CI too) | 3 | `scripts/check-private-terms.js` via `npm run preflight` and `.githooks/pre-push`; the repo itself is scanned by `tests/private-terms-check.test.js` |
| No term from the owner's LOCAL private denylist in a tracked file (the list itself is never committed; absent → that half passes, so CI checks only the shapes) | 3 | same script, same test |

### Why i18n parity needed a test rather than types

`web-ui.md` used to say a missing key makes `tsc` fail. It does not, and the
real behaviour is worse than a compile error. `t()` is typed
`DeepKeys<EsStrings>`, so TypeScript checks call sites against **`es.ts` only**;
`en.ts` enters the dictionary map as `unknown` and is never checked against
anything. And `lookupWithFallback()` falls back to the Spanish dictionary when
the active locale lacks a key — so a key missing from `en.ts` is not a crash,
not a build failure, and not even the dev-mode warning (that fires only when
BOTH dictionaries lack it). It is an English-speaking user quietly reading
Spanish, with every gate green. Hence `tests/web-guardrails.test.js`.

### How rule 11a is checked, and why it needed an allowlist first

11a is the one rule here whose gate could not simply be switched on. A naive
"must start with a capital" check reported 279 keys the day it was written, and
most were legitimate — the rule's own fragment exception (`"in {amount}"`,
`"cada {n} horas…"`) plus its data carve-out (a slug, a path, a command). A gate
that fails 279 times is not a gate; it teaches people to edit the check.

So the 279 were classified one at a time. 169 were genuine drift and were
Capitalised in both dictionaries — status chips reading `"running"`, badges
reading `"agents"`, form labels reading `"slug"`, toasts reading `"save failed"`.
The remaining 110 are listed in `SENTENCE_FRAGMENTS` in
`tests/web-guardrails.test.js`, each under the reason it qualifies.

Two things about that list are deliberate. It is **explicit, not a pattern**: a
heuristic like "keys ending in `_ph`" would have re-admitted most of the 169.
And a **stale entry fails the test** — if an allowlisted string is later
reworded to open with a capital, or its key is deleted, the entry has to go.
Without that, an exception list becomes somewhere to put things.

The check uses `\p{Ll}`, not `[a-z]`. Three Spanish labels opened with `"ú"`
(`"última:"`) while their English twins already read `"Last:"`; an ASCII-only
check called that clean, and per-locale drift is exactly what 11a forbids.

### Why dead links needed a gate rather than review

`spec/` and `qa/` are gitignored because planning notes and raw QA logs quote
real ids, real paths and occasionally real credentials, and this is a public
repo with permanent history. Nothing stopped a **tracked** file from linking
into them, and five did: `AGENTS.md`, three files under `rules/`, and the web
panel README all pointed at a survey and at ADRs that were never pushed.

Locally every one of those links worked, which is the whole problem — the
machine that writes the link is the machine that will never notice. On GitHub
and in every fresh clone they were 404s, and the five ADRs behind them were
architecture decisions no outside reader could see. It held for months of
review.

`tests/docs-links.test.js` asserts the stronger property — a link must resolve
to a **tracked** path — so it catches the ordinary broken relative path for
free. Run against `8a244b5` it fails with exactly those six links.

## Convention only — nothing checks these

Real rules. No mechanism. They hold because someone reads the diff.

| What | Rule | Why there is no gate |
|---|---|---|
| One page layout for list screens (`<Section>` slots) | 11b | Structural/visual; no cheap assertion |
| No secrets; no real NAMES, employers or quotes that are on no list | 3 | The shapes catch numbers and paths, the local list catches what the owner wrote down; a name nobody listed needs a reviewer (checklist item 10 in `workflow/03-independent-review.md`) |
| Skills and `docs/` updated with the behaviour they describe | 6 | `tests/runtime-skills.test.js` checks a skill's *shape*, never whether its prose is still true |
| Never inline a tool name — import from `names.js` | 16 | No lint rule exists for it |
| `#aliases` instead of `../../../` | 7 | No lint rule exists for it |
| Prompt budget (~2.5k tok for the super-agent prompt) | 12 | `scripts/inspect-channel-prompts.js` measures it; nothing gates it |
| Restart the daemon before testing by hand | 17 | Inherently manual — and the most expensive rule in the file to skip |
| The Playwright specs on a push that does NOT reach main | 11 | Run in CI's `e2e` job on every PR and every push to `main`/`staging`, and in `pre-push` only when the push reaches `main` — a push to a feature branch runs preflight alone |
| The change workflow (plan → review → verify → brief) | — | Process, not code. [`workflow/`](workflow/) is the playbook; nothing can assert a review happened |
| Commit type matches what the change DOES | 18 | `commit-msg` checks the word is a word, never that it is the RIGHT word. A fix titled `chore` is well-formed, publishes nothing, and only a reader comparing diff to subject catches it — see [`releasing.md`](releasing.md) |

## The gates, and what each one runs

```bash
npm run preflight
```

`lint` → `lint:web` → `test:ci` → `build:web` → panel `tsc --noEmit` → `typecheck:tui`.

- **`.githooks/pre-push`** asks `scripts/push-policy.js` first (rule 19: no
  commit that exists only on main, unless marked a hotfix), then runs lint, web
  lint, backend tests, web build, panel `tsc` — and, when the push reaches
  `main`, the **e2e gate** (`scripts/e2e-gate.js`). Bypass with
  `git push --no-verify`; skip just the web build with `APX_SKIP_WEB_BUILD=1`
  (the e2e gate then builds its own, so it never tests a stale bundle).
- **`.github/workflows/ci.yml`** — job `verify` mirrors preflight; job `e2e`
  runs `scripts/e2e-gate.js`, the same entry point as the hook; job `release`
  needs both, and is the thing that publishes to npm. It runs on pull requests
  and on pushes to `main` and `staging`.
- **The GitHub ruleset on `main`** forbids force-push and deletion (the repo
  admin bypasses it). It does not require `verify`/`e2e`: semantic-release's
  `[skip ci]` release commit would then be blocked, and the Actions app cannot
  be a bypass actor on a repository ruleset — see
  [`workflow/09-reaching-main.md`](workflow/09-reaching-main.md).
- **Publishing waits for that gate**, and until 2026-09-14 it did not. The
  release lived in its own workflow on the same `push: [main]` trigger, so it
  RACED ci.yml rather than following it: 1.108.0 went to the registry on
  `ba511f9` with `e2e` red, as did the two commits after it — three green
  Releases sitting beside three red CIs. Its only check was `npm run test`.
  `needs:` reaches jobs in the same workflow and nothing else, which is why the
  job moved into ci.yml instead of growing a condition.
- The **GitHub Pages** deploy (`pages.yml`) is deliberately NOT gated on CI.
  Nothing in the suite reads a docs page, so coupling them would let a flaky
  Playwright spec block a typo fix; the Astro build inside that workflow is the
  check that actually applies to its content.
- **`.githooks/commit-msg`** checks the SHAPE of the subject — that the type is
  one `.releaserc.json` knows — because that one word decides whether the change
  ever reaches npm, and getting it wrong fails silently. It reads the vocabulary
  from that file rather than repeating it, so the two cannot drift. Bypass with
  `git commit --no-verify`.
- Commits are gated on **that and nothing else**. The expensive half — whether
  the type matches what the change actually does — is still only a reader.

## Adding a gate

Prefer, in order:

1. **A lint rule**, when the violation is visible in one file's AST. Root config
   for backend JS, panel config for the panel. Use AST selectors over
   `no-restricted-imports` globs for anything with a `#` alias — minimatch reads
   a leading `#` as a comment and silently matches nothing.
2. **A test in `tests/`**, when the invariant spans files or lives in the panel.
   Reading panel sources from the backend suite is the established pattern here
   (`chat-turn-shape`, `web-composer`, `web-guardrails`, and a dozen more) and
   costs no new dependency.
3. **A ratchet script**, when the invariant is right but the current count is
   not zero and clearing it would be a refactor rather than a repair. Copy
   `typecheck-tui.js` / `lint-web.js`: the count may fall freely, any rise
   fails, and the baseline is lowered — never raised — in the same commit that
   fixes some.

Never weaken a rule to get green. If a gate is wrong, argue it down in the
config with a comment saying why; do not delete the check.
