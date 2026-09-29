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
- **Coverage measures `src/**` and `tests/**` — nothing else.** `test:ci` passes
  `--test-coverage-include` for both, and it has to: `--experimental-test-coverage`
  works by exporting `NODE_V8_COVERAGE`, and **every child process a test spawns
  inherits it**. A spawned CLI that happens to be a Node program writes its own
  coverage into the run, and the reporter merges it as if it were ours. That is
  how a runtime probe falling through to `detectAll()` pulled in a 9 MB
  cursor-agent bundle and dropped `all files` from ~72.9% functions to 15.98% —
  red on a clean tree here, green in CI, where none of those CLIs are installed.
  The symptom reads exactly like a Node-version difference and is not one. When
  the ratchet moves for no reason, look for a test that spawned something first.
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
   const srv = app.listen(0, "127.0.0.1");   // the host is not optional — see below
   // fetch(`http://127.0.0.1:${srv.address().port}/api/...`)
   ```
   **Pass the host.** `app.listen(0)` without one binds the wildcard `[::]`, and
   these apps are built with `token: ""`, which mounts no auth wall at all — so
   every such server spends the run reachable on the LAN and the tailnet, not
   just on loopback. It is also how one test file ends up answering another's
   requests: a second process can bind `127.0.0.1:<the same port>` **on top of a
   wildcard with no `EADDRINUSE`**, and the specific socket then wins every
   loopback connection. Two specific binds collide loudly instead, which is the
   point. The kernel never hands the same ephemeral port out twice on its own
   (measured: 0 collisions in 3300 binds, within and across processes), so this
   needs someone binding an EXPLICIT port — which is why **you never probe for a
   free port to bind later**: `listen(0)` → read it → close → re-bind that number
   leaves a gap the kernel can fill with another process. Bind first, then read
   the port off the socket you actually hold.
2. **Project trees** — `makeTempProject()` builds a throwaway `.apc` project;
   never point tests at the real checkout.
3. **`~/.apx` state** — set `process.env.APX_HOME` to your own temp `.apx` dir
   **BEFORE importing the module under test**, e.g.
   `process.env.APX_HOME = path.join(tmpHome, ".apx")` (keep `HOME`/`USERPROFILE`
   pointed at `tmpHome` too, for `~/.claude`-style lookups). Two gotchas make
   `APX_HOME` — not `HOME` alone — the thing to set:
   - Paths resolve at import time, so setting it after the import silently tests
     the shared sandbox.
   - The `test`/`test:ci` runners pin ONE `APX_HOME` for the whole run, and
     `computeHome()` reads `APX_HOME` before `os.homedir()`. A test that only
     moves `HOME` is overridden by that shared sandbox and races every other
     HOME-only test running in parallel — the source of the memory/telegram/
     inbox flakes fixed by giving each file its own `APX_HOME`.
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

- `npx tsc --noEmit` is part of preflight and type-checks the panel — but it is
  NOT the i18n gate (it only checks call sites against `es.ts`);
  `tests/web-guardrails.test.js` is. `vite build` does NOT type-check.
- Every new screen/rail module gets a Playwright spec in
  `src/interfaces/web/e2e/` — and a **journey**, not only a render check.

## The e2e gate

```bash
npm run e2e:gate                      # the whole suite, as CI and a push to main run it
node scripts/e2e-gate.js 26-usab      # one spec (extra args go to `playwright test`)
```

`scripts/e2e-gate.js` gives Playwright a world of its own: a fresh `APX_HOME`
(a first install), a daemon from this checkout on `:7530`, the production
bundle served by that daemon, an `apx` shim, and the super-agent on the offline
`mock` engine. It is the gate for `main` (rule 19) and the exact script CI's
`e2e` job runs. `pnpm e2e` inside the panel drives your LIVE daemon on `:7430`
instead — fine for iterating with hot reload, never evidence.

**Why journeys.** Until 2026-09-28 every spec opened one screen and checked it
rendered. The add-project dialog then shipped closing itself a second after it
opened over `/inbox`: each screen worked alone; the bug existed only in the
combination — a dialog kept in the URL (`?action=add-project`), opened over a
screen that also writes the URL. `26-usability-journeys.spec.ts` is the
pattern: do what a person does across screens, wait for every effect to settle
(`SETTLE_MS`), and assert the thing **stayed** — the dialog is still open, the
other params survived, the filter is still applied after Back.

A journey that needs data creates it the way a user would (the inbox thread is
made by sending a chat message to the `mock` super-agent), or through the
daemon's own API. Never paste a real transcript into a fixture (rule 3).

## Worktrees need a real install

A worktree has no `node_modules`. **Do not symlink them to the main
checkout's.** `scripts/build-web.js` runs `pnpm install` in the panel, and
through a symlink pnpm decides the modules directory is foreign and tries to
PURGE it — the main checkout's, the one the live daemon runs from. It stopped
only because it had no TTY to ask on. Run `pnpm install --frozen-lockfile
--prefer-offline` at the root and in `src/interfaces/web` instead; with the
pnpm store warm it takes seconds.

## Preflight

`npm run preflight` = lint + `lint:web` + `test:ci` + web build + web
`tsc --noEmit` + TUI ratchet. The pre-push hook and CI both run it; a push that
reaches `main` also runs the e2e gate (rule 19). The TUI stays at its frozen
typecheck baseline (vendored fork — the ratchet only stops it getting worse).
Docs (`docs/`) are NOT in preflight — build them explicitly when touched.

## Reading a red CI

`ci.yml` runs two jobs and they fail for different reasons. Before treating a
red run as a break, read WHICH job died:

- **`verify`** — lint, `lint:web`, `test:ci`, web build, web `tsc`, TUI ratchet.
  This one is deterministic: preflight covers it, so a red `verify` means the
  pre-push hook was bypassed. Believe it.
- **`e2e`** — a real browser against a real daemon. Two failure shapes, and only
  one is yours:
  - A spec fails at a *different point* on each attempt while the suite is green
    locally: a timing margin on a runner ~2.5x slower than a laptop. That is why
    `playwright.config.ts` sets `retries: 2` on CI and `0` locally; a genuine
    break fails all three attempts, so a run that goes green on retry is not a
    break being hidden.
  - `Install Playwright browser` fails before any spec runs — usually
    `Hash Sum mismatch` from Google's apt repo on the runner. That is the
    runner's network, not the panel; the step retries three times.

Neither retry excuses a spec that fails *the same way* every attempt. That is a
break, and the trace from the first retry is in the `playwright-report`
artifact.
