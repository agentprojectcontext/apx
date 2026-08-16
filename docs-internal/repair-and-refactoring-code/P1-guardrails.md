# P1 — Mechanical guardrails

The point of this phase: make the wrong choice bounce automatically, so the
refactors in P2–P4 are safe to do.

## P1-1 — ESLint (+ Prettier)

There is **no linter, formatter, or editorconfig anywhere** in the repo — not in any
of the four `package.json` files. Add a flat ESLint config at the root covering
`src/`, `scripts/` and `tests/`.

Rules that must have teeth from day one:

- `no-unused-vars` — there are 194 exports nobody imports.
- `no-empty` (with `allowEmptyCatch: false`) — there are 80 empty catch blocks;
  legitimate best-effort cleanup gets an explicit comment or a rethrow.
- **`no-restricted-imports` encoding the layer rule** — this is the important one:
  - `src/core/**` may not import `#host/*`, `#interfaces/*`, or reach them relatively.
  - `src/host/**` may not import `#interfaces/*`.
  - This converts the architecture rule from prose into a build error.
- `no-restricted-syntax` / `no-restricted-properties` to ban re-deriving `~/.apx`
  paths from `os.homedir()` outside `core/config/paths.js`.

Prettier for formatting only, with the repo's existing style (2-space, double
quotes, semicolons) so the first run is not a 600-file diff.

**Acceptance.** `npx eslint .` exits 0. The three known layer violations are caught
by the rule before they are fixed (verify the rule actually fires, then fix them in P4).

## P1-2 — CI on pull requests

Today **no workflow has a `pull_request` trigger**. `release.yml` and `pages.yml`
both fire only on `push` to `main`, so tests run *after* the merge: a red test
blocks the release, not the code coming in.

Meanwhile `package.json` already defines a correct composite gate — `preflight`
(backend tests + web build + web `tsc --noEmit`) — **that nothing invokes**.

**Fix.** Add `.github/workflows/ci.yml` on `pull_request` + `push` running lint,
`preflight`, and the TUI typecheck. Node 22 (what the other workflows already use).

## P1-3 — Daemon resilience

- `src/host/daemon/index.js:358` registers `uncaughtException` but **not**
  `unhandledRejection` (the CLI registers both). On Node ≥15 an unhandled rejection
  kills the daemon.
- There is **no Express error middleware** anywhere in `src/host/daemon`
  (zero `(err, req, res, next)` handlers).
- Four async routes await work with no try/catch: `api/artifact-preview.js:53`,
  `api/engines.js:16,31`, `api/runtimes.js:30`.

**Fix.** Add the `unhandledRejection` listener, a shared `asyncRoute()` wrapper, and
a terminal error middleware mounted after all routes that returns `{ error }` with a
real status code. Wrap the unguarded handlers.

## P1-4 — Fix `engines.node`

`package.json` says `>=18`; both workflows use Node 22 and the docs site needs
≥22.12. Three documents, two answers. Align to what is actually supported and tested.
