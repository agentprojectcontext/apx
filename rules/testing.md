# Testing

> Deep dive for [`AGENTS.md`](../AGENTS.md). The always-read constraint is
> rule **1** (tests ship with behavior). This is how tests are actually built
> here.

## Non-negotiables

- **No skipped tests, ever.** `test.skip`/`it.skip`/`describe.skip`/`test.todo`
  are forbidden; `npm test` must report `skipped 0`, `todo 0`, and
  `scripts/test-ci.js` fails the build otherwise. A test that can't run is
  fixed or deleted with the reason in the commit body.
- **Every bug fix lands with a regression test that failed before the fix**,
  named in the commit body.
- **Coverage only ratchets up.** `COVERAGE_FLOOR` lives in `scripts/test-ci.js`
  (line/branch/function). When your change pushes coverage higher, raise the
  floor in the same commit; never lower it.
- **Offline and hermetic.** No network, no API keys, no live daemon. CI runs
  Node ≥22 with `npm run test:ci` (recursive discovery under `tests/`).
- **Fixtures are invented, never observed** (rule 3). The tempting move when
  fixing a leak or a formatting bug is to paste the turn that broke it —
  the real Telegram reply, the real memory note, the real project name. Don't:
  a copied turn carries whatever the live install knew, and this repo is public
  with a permanent history. Retype it as synthetic content that reproduces the
  same shape, with placeholder names (`acme`, `northwind`), ids (`1234567890`),
  and paths (`/path/to/project`).

## The four standard harnesses

1. **HTTP route** — never start the real daemon:
   ```js
   const app = buildApi(ctx);
   const srv = app.listen(0);
   // fetch(`http://127.0.0.1:${srv.address().port}/api/...`)
   ```
2. **Project trees** — `makeTempProject()` builds a throwaway `.apc` project;
   never point tests at the real checkout.
3. **`~/.apx` state** — set `process.env.HOME` to a temp dir **BEFORE importing
   the module under test** (paths are resolved at import time; setting HOME
   after the import silently tests your real home).
4. **Memory/RAG** — force the offline backends: TF embedder, JSON vector store,
   mock engine, temp HOME (see `tests/memory-rag*` and `memory-compaction*`).

## What MUST have a direct test (dangerous surfaces)

Any handler or core function that: writes files, runs a shell, changes a
permission mode (chmod!), or sends a message to a human. If the operation exists
in two places (a route and a command), the test covers the **shared core
function** — a dangerous surface with two copies means the test covers only one
while the other drifts (this happened; see the survey's artifacts entry).

## What to assert

Behavior, not implementation: drive the route through `buildApi()` or call the
command/core function, and assert on responses, files written, and records
appended — not on internal call order. Prefer one test per contract clause
("returns 404 on unknown id", "refuses to clear credentials without
`_allowClear`") over one mega-test.

## Web

- `npx tsc --noEmit` is part of preflight and is the i18n enforcement mechanism
  (`t()` keys are typed from `es.ts`) — `vite build` does NOT type-check.
- Every new screen/rail module gets a Playwright spec in
  `src/interfaces/web/e2e/`.

## Preflight

`npm run preflight` = lint + `test:ci` + web build + web `tsc --noEmit` + TUI
ratchet. The pre-push hook and PR CI both run it. The TUI stays at its frozen
typecheck baseline (vendored fork — the ratchet only stops it getting worse).
Docs (`docs/`) are NOT in preflight — build them explicitly when touched.
