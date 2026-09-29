# APX Web — E2E (Playwright)

End-to-end tests for the admin panel: a real browser against a real daemon.

## Two ways to run them — and only one is the gate

### The gate (what CI and a push to `main` run)

```bash
npm run e2e:gate                  # from the repo root
node scripts/e2e-gate.js 26-usab  # extra args go to `playwright test`
```

`scripts/e2e-gate.js` builds the world the suite runs in, every time:

- a **fresh `APX_HOME`** — a first install, no projects, no history;
- a **daemon of its own** on `:7530` (`APX_E2E_PORT`), booted from this
  checkout — never the one on `:7430`;
- the **production bundle** (`scripts/build-web.js` → `dist/`), served by that
  daemon — what actually ships, no vite;
- an **`apx` shim** on `PATH` pointing at this checkout, for `global-setup`;
- the super-agent on the offline **`mock` engine**, so a journey can send a
  chat message with no key and no network.

It tears everything down afterwards and keeps the temp home + daemon log only
when a run fails. `APX_E2E_SKIP_BUILD=1` reuses an existing `dist/`;
`APX_E2E_KEEP=1` keeps the temp home even on success.

### Development (`pnpm e2e`)

```bash
cd src/interfaces/web
pnpm e2e            # headless, against vite on :7431 → the daemon on :7430
pnpm e2e:ui         # Playwright UI mode
pnpm e2e:report     # open the last HTML report
```

This drives **whatever daemon answers on :7430** — on your machine, the live
install with your real projects. Mutating specs act on a throwaway project, but
it is still your daemon and your config, and it can never show what a new user
sees. Use it for hot-reload iteration; trust only the gate.

Browser, one-time: `pnpm exec playwright install chromium`.

## Isolation

`global-setup.ts` creates a **throwaway project** in a temp dir
(`apx init` + `POST /api/projects`) and records it in `e2e/.runtime.json`;
`global-teardown.ts` unregisters it by PATH and deletes the dir. Auth is
automatic: the panel fetches `/api/admin/web-token` over loopback, and the
fixture seeds `localStorage["apx.token"]`.

## What to write here

The early specs open ONE screen and check it renders. That is how the
add-project dialog shipped closing itself over `/inbox` (2026-09-28): each
screen worked alone, and the bug only existed in the combination — a dialog
that lives in the URL, opened over a screen that also writes the URL.

`26-usability-journeys.spec.ts` is the pattern for new work: do what a person
does across screens, wait for every effect to settle, and assert it **stayed**
— the dialog is still open, the other params survived, the filter is still
applied after Back. A new screen or dialog gets a journey there, not only a
render check.

Rules that apply here as everywhere (AGENTS.md): synthetic data only (rule 3),
no `test.skip`/`test.fixme` (rule 1).

## Reports

`reporter-dated.ts` writes `e2e/reports/REPORT-<ISO>.md` and `LATEST.md` on
every run (gitignored). The HTML report is `e2e/.playwright-report`; CI uploads
it with the daemon log as the `playwright-report` artifact.
