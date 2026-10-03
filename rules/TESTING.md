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
pnpm preflight                     # gates + unit tests
pnpm verify                        # preflight, then end to end, then lightness budgets (what CI runs)
```

## 5a. End to end (Playwright)
```bash
pnpm e2e                           # builds the panel, then every spec in e2e/specs against a sandboxed core
pnpm exec playwright test e2e/specs/06-telegram.spec.ts --headed    # one spec, watching
E2E_KEEP=1 node e2e/env.ts         # the sandbox by hand (core :7460, control :7461); its folder stays after
E2E_CHROMIUM=/path/to/chrome pnpm e2e   # a Chromium other than the one Playwright pins (container, distro build)
pnpm e2e:desktop                   # the Electron app (e2e/desktop) against the same sandbox; Linux: xvfb-run -a …
```
The desktop specs launch the real app with a temp `HOME` and `APX_DESKTOP_DATA` (its data folder, sessions and
single-instance lock never touch the owner's running APX; macOS ignores `HOME` for that folder), the panel
served by the sandbox's core, and check the window, the browser it lends to the core as a node, and the quick chat.
`e2e/env.ts` is a whole APX apart from the owner's: a temp home and port, `APX_SECRETS=file`, a fake
OpenAI-compatible model (`e2e/fake-llm.ts`, answers "Got it: <what you wrote>"), an emulated Telegram Bot API
(`APX_TELEGRAM_API`), an APX v1 and Claude Code / Codex sessions to import (`e2e/fixtures.ts`). Specs act as the
outside world through its control API (`world.telegram(...)`, `world.sentTo(chat)`). Specs run in file order on
one core, like one owner from the first-run setup on. Any console error or 5xx response fails the test. Specs
are written in Spanish, as the owner uses the panel. WhatsApp is emulated inside the sandbox's core: it starts
with `--import e2e/baileys-hook.ts`, which resolves the library to an in-memory phone (`e2e/fake-baileys.ts`, driven
through `world.whatsapp`), so the real adapter runs with no test path in the product.

## 5b. Lightness
```bash
pnpm perf                          # builds the panel, then scripts/perf.ts
```
A core on a temp home with the fake model: startup, idle memory and CPU, protocol latency, chat turns, memory
once quiet again, and the panel's first load (gzip). Each number has a budget in `scripts/perf-budget.json`;
going over fails. Raising a budget is a regression: it needs a reason in the commit body.

## CI
`.github/workflows/verify.yml` runs `preflight`, `e2e` and `perf` on every push to main, every `v*` tag and every
pull request; reports (Playwright HTML, failed-test snapshots, `e2e/.out/perf.json`) are kept 14 days. Its
`autofix` job is off by default: with the repo variable `APX_AUTOFIX=true` and the secret `ANTHROPIC_API_KEY`, a
failure on main hands the reports to an agent that fixes the cause and opens a pull request (never merged on its
own, never by weakening a gate).

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
