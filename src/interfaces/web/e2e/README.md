# APX Web — E2E (Playwright)

End-to-end tests for the admin panel. They run against `vite dev` on **:7431**,
which proxies every daemon API prefix to the real daemon on **:7430**.

## Prereqs

- The daemon must be running: `apx daemon status` (start with `apx daemon start`).
- `apx` must be on `PATH` (used by global-setup to scaffold a throwaway project).
- Browser: `pnpm exec playwright install chromium` (one-time).

## Run

```bash
cd src/interfaces/web
pnpm e2e            # headless, full suite (auto-starts vite if needed)
pnpm e2e:ui         # Playwright UI mode
pnpm e2e:report     # open the last HTML report
```

## Safety: isolation

`global-setup.ts` creates a **throwaway project** in a temp dir
(`apx init` + `POST /projects`) and records its id in `e2e/.runtime.json`.
All mutating specs (`03-crud-isolated`) act only on that project.
`global-teardown.ts` unregisters it and deletes the temp dir. Your real
registered projects are never modified.

Auth is automatic: the panel fetches `/admin/web-token` over the loopback
proxy, and the fixture also seeds `localStorage["apx.token"]`.

## Coverage

| Spec | What it validates |
|---|---|
| `01-shell-auth` | boots authenticated, sidebar rail, breadcrumb, theme toggle |
| `02-navigation-smoke` | every Settings panel, every Base screen, every per-project screen renders with no uncaught error |
| `03-crud-isolated` | task lifecycle (add→done→reopen→drop) + agent creation, on the throwaway project |
| `04-usability` | Roby floating chat open/close, add-project dialog open/dismiss, task a11y affordances |

## Dated reports

`reporter-dated.ts` writes a timestamped Markdown ledger to
`e2e/reports/REPORT-<ISO>.md` on every run, plus `e2e/reports/LATEST.md`.
These are committed so the testing history stays "dateado".
