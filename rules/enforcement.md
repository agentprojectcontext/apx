# What is enforced, and by what

> Deep dive for [`AGENTS.md`](../AGENTS.md). Read it before trusting a rule.
>
> The hub states 17 rules in the same voice, so they all read as equally
> binding. They are not. Some are build errors that stop a push; others are
> prose that only review catches. Knowing which is which is the difference
> between "the gate will catch me" and "nobody will notice for three months" —
> and the second one is how the panel accumulated two React crashes that no
> gate could see.
>
> When you add a gate, add its row here. When you write a rule nothing enforces,
> say so in its row rather than leaving the reader to assume.

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
| Coverage floor (line 72 / branch 71 / function 65) | 1 | `scripts/test-ci.js` |
| Every i18n key in **both** `en.ts` and `es.ts` | 11 | `tests/web-guardrails.test.js` |
| No Radix, no `components.json` | 11 | `tests/web-guardrails.test.js` |
| Panel requests go through `src/lib/api/*` | 11 | `tests/web-guardrails.test.js` |
| React hooks rules; no unused vars in the panel | — | `src/interfaces/web/eslint.config.js` |
| Panel `any` + `exhaustive-deps` count may only fall | — | `scripts/lint-web.js` (baseline 38) |
| Vendored TUI type errors may only fall | — | `scripts/typecheck-tui.js` (baseline 174) |
| Panel types | 11 | `tsc --noEmit` in `src/interfaces/web` |
| SPA fallback matches the `<Routes>` registry | 9 | `tests/web-spa-fallback.test.js` |
| Runtime skill headers, `name` == dir, English-only | 6 | `tests/runtime-skills.test.js` |

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

## Convention only — nothing checks these

Real rules. No mechanism. They hold because someone reads the diff.

| What | Rule | Why there is no gate |
|---|---|---|
| User-visible labels start with a Capital | 11a | 275 strings currently start lowercase and **most are legitimate** — the documented "fragment" exception (`"in {amount}"`, `"cada {n} horas…"`). A naive check is 275 false-ish positives; a real one needs a curated allowlist, which is judgment work nobody has done yet. Known drift: `daemon.running`, `admin.agents_badge`, `settings.profile.active`. |
| One page layout for list screens (`<Section>` slots) | 11b | Structural/visual; no cheap assertion |
| No secrets, no real data in fixtures or docs | 3 | Needs human judgment about what is real |
| Skills and `docs/` updated with the behaviour they describe | 6 | `tests/runtime-skills.test.js` checks a skill's *shape*, never whether its prose is still true |
| Never inline a tool name — import from `names.js` | 16 | No lint rule exists for it |
| `#aliases` instead of `../../../` | 7 | No lint rule exists for it |
| Prompt budget (~2.5k tok for the super-agent prompt) | 12 | `scripts/inspect-channel-prompts.js` measures it; nothing gates it |
| Restart the daemon before testing by hand | 17 | Inherently manual — and the most expensive rule in the file to skip |
| The 14 Playwright specs | 11 | Now run in CI's `e2e` job, but **not** in `preflight` or `pre-push` (they need a booted daemon and a browser) |

## The gates, and what each one runs

```bash
npm run preflight
```

`lint` → `lint:web` → `test:ci` → `build:web` → panel `tsc --noEmit` → `typecheck:tui`.

- **`.githooks/pre-push`** runs lint, web lint, backend tests, web build, panel
  `tsc`. Bypass with `git push --no-verify`; skip just the web build with
  `APX_SKIP_WEB_BUILD=1`.
- **`.github/workflows/ci.yml`** — job `verify` mirrors preflight; job `e2e`
  boots a daemon, shims `apx` onto PATH and runs Playwright.
- Commits are **not** gated. Only pushes are.

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
