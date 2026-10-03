# Testing and runtime verification

Only commands that exist. Report each level separately; anything not exercised is `UNVERIFIED`.

## 1. Build / typecheck
```bash
pnpm typecheck                     # tsc (TS 7) in every package
pnpm --filter @apx/web build       # Vite production build
pnpm --filter @apx/ui build        # design system dist/ (what web and design-sync consume)
```

## 2. Static checks
```bash
pnpm lint                          # Biome; `pnpm lint:fix` applies safe fixes
pnpm check:private                 # public-safe gate (AGENTS.md rule 17)
```

## 3. Tests
```bash
pnpm test                          # node:test in every package that has *.test.ts
node --test apps/core/src/server.test.ts
```
Rules: tests never touch the real home — pass a temp `home` to `createCore` (see `server.test.ts`); bind
`127.0.0.1` with port `0`; run offline (no network, no keys, no live core). No `test.skip`/`todo`: fix or delete
with a reason in the commit body.

## 4. Real path
```bash
pnpm dev                                    # or: APX_HOME=$(mktemp -d) node apps/core/src/main.ts
node apps/terminal/src/main.ts status       # code_sha must match `git rev-parse --short=12 HEAD`
node apps/terminal/src/main.ts ping hola    # proves the WS path
curl -s 127.0.0.1:7440/health               # raw HTTP
pnpm --filter @apx/web dev                  # open http://127.0.0.1:7441 — badge shows the core's code_sha
```
While developing against a scratch state, set `APX_HOME` to a temp dir so `~/.apx/v2` stays clean.

## 5. All at once
```bash
pnpm preflight
```

## 6. Embedded browser (real path)
```bash
pnpm dev                                         # core
pnpm --filter @apx/web dev                       # panel
pnpm --filter @apx/desktop dev                   # Electron; `apx2 status` must show "browser ok — apx-desktop"
node apps/terminal/src/main.ts browser open https://example.com --by Roby
node apps/terminal/src/main.ts browser snapshot t1
node apps/terminal/src/main.ts browser shot t1 /tmp/t1.jpg
```
Profiles: open `https://httpbin.org/cookies/set?probe=1` in `shared`, then `https://httpbin.org/cookies` with another
`--by` (must show it) and with `--profile incognito` (must be empty). Credential guard: `browser type` into a
password field must fail with `credential_field`.
