# 05 — Test and runtime verification

> This is the stage that decides whether "done" is true. It is also the one this
> repo has historically got wrong, in the same way, repeatedly.

## Four different claims — never conflate them

| Claim | What proves it | What it does **not** prove |
|---|---|---|
| It compiles / lints / types | `npm run preflight` | that any of it runs |
| The tests pass | `npm run test:ci` | that the **daemon** runs your code |
| The process loaded the new code | `apx restart` + fresh `uptime_s` | that your path works |
| **The changed path actually worked** | exercising it end to end | — this is the only one that counts |

Reporting claim 1 or 2 as if it were claim 4 is the single most common way work
here is reported wrong.

## The gates

```bash
npm run preflight
```

`lint` → `lint:web` → `test:ci` → `build:web` → panel `tsc --noEmit` → `typecheck:tui`.

**Two lint commands, not one.** The root ESLint run ignores
`src/interfaces/web/**` — it is a separate pnpm project and the root config has
no TS parser — so `npm run lint` reports success having never opened a panel
file. `preflight` runs both; `lint` alone is not a gate.

Not in preflight, and you have to remember them:

```bash
cd src/interfaces/web && pnpm exec playwright test   # 14 specs; need a booted daemon
cd docs && pnpm build                                # only if you touched docs/
```

## The runtime step — do not skip it

```bash
apx restart                            # from the MAIN checkout
curl -s 127.0.0.1:7430/api/health      # uptime_s back near zero
apx daemon logs --tail 30              # clean boot, plugins initialized, no stack trace
```

Then **exercise the path you changed**: `apx exec "…"` for anything in the agent
or tool loop, the route itself for an API change, the screen for a web change.

Two traps, both of which have cost whole sessions:

- **The daemon runs from the MAIN checkout.** A change committed only on a
  worktree branch never reaches it — worktrees have no `node_modules` and cannot
  run the daemon. Confirm which checkout is live:
  ```bash
  ps -o command= -p "$(pgrep -f 'src/host/daemon/index.js' | head -1)"
  ```
- **"The daemon booted" is not evidence your change works.** A fresh `uptime_s`
  proves a process restarted, nothing more.

**Exceptions are data, not code:** files a running daemon reads on demand (a
bundled profile, a skill) and `~/.apx/config.json`, which
`POST /api/admin/reload` re-reads. Runtime skills
(`src/core/runtime-skills/`) are live on save. Engine skills (`skills/`) need
`apx skills sync` — and a dev checkout must never run `apx update`, which
replaces the global symlink with the npm tarball and silently stops you testing
your own code.

## Reporting

Say **which command you ran and what it returned**. If you could not verify —
no quota, no credentials, an external service down, a surface you cannot reach —
write `UNVERIFIED` and the reason.

> **Anything not verified is UNVERIFIED.** That is an acceptable answer.
> Implying it works is not.
