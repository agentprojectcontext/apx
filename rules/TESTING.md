# Testing and runtime verification

Only commands that exist. Report each level separately; anything not exercised is `UNVERIFIED`.

## Fix regression contract

Apply this to product fixes and test repairs (AGENTS.md rule 24). Documentation-only edits need relevant link,
command and static checks; they do not require rerunning application suites unless executable behavior changes.

1. **Map the failure before editing.** State the trigger, expected result and observed result. Trace entry point →
   protocol/operation → state or side effect → affected clients. Find existing tests for that path and its callers;
   an existing test file is not evidence that the broken behavior is asserted.
2. **Prove the regression.** Prefer a focused test that fails on the old behavior for the reported reason and passes
   with the fix. Keep the test and fix in the same change. If reproducing the original failure is unavailable or
   unsafe, record the limitation and the strongest substitute evidence; do not claim a red run that never happened.
3. **Assert an observable contract.** Check returned/persisted data, emitted events, visible UI, protocol arguments,
   exit status or resource cleanup as appropriate. A successful import, render, snapshot or mock call alone does
   not prove an action works. Mock hardware, transport and external services at their boundaries; keep the logic
   under test real. Validate recording-client requests against the real protocol registry.
4. **Protect the affected seam.** Add the relevant cases below, including the failure or lifecycle transition that
   caused the bug. Extend shared contract tests and affected consumers when changing shared code; testing one
   client alone does not establish compatibility for the others.
5. **Repair the cause, then integrate.** Classify a failure as product behavior, an intentionally changed contract,
   fixture/test defect or environment failure before changing expectations. For an intentional contract change,
   explain the before/after behavior and update producers and consumers together. Preserve unrelated assertions.
   Never resolve a red test by skipping it, swallowing its error, removing its meaningful assertion or weakening
   a timeout, budget or gate. Synchronize on real completion/events with bounded waits instead of arbitrary sleeps.
6. **Verify the resulting change.** Run the focused regression, affected suites and required repository gates.
   After a merge or conflict resolution, rerun the affected path on the integrated state. Broaden or repeat checks
   when changes, failures or unresolved risks justify it; unchanged passing suites need no repeated runs for counts.

| Changed seam | Regression evidence to include when affected |
|---|---|
| Core / protocol / SDK | Params and result shapes, errors, persisted effects, auth/scope and idempotency; HTTP/WS parity when transport behavior changes. SDK cancellation, timeout and connection failure must settle and close resources. |
| CLI | Exact protocol intent and meaningful output/exit status; failure cannot print success or leave sockets/processes open. Keep command quoting and fixtures portable. |
| Web / mobile React | Mount the real hook or component, trigger the user action and assert its result plus failure recovery. Preserve drafts and unrelated/concurrent state; test duplicate submissions when the action can be repeated. |
| Async chat / task / routine / preferences | Resolve requests out of order, switch entity or request scope, fail a later operation and unmount while pending. Old responses cannot overwrite the current entity or latest confirmed state; acknowledgements cannot erase newer live events. |
| Subscriptions / reconnects | Remove the exact listeners, cancel timers/retries and close late connections after cleanup. Revoked credentials must stop reconnecting and unpair once. |
| Desktop / preload | Strip native event objects, return working unsubscribe functions and test native restore/minimize/focus transitions in Electron. A renderer-only check or forced focus is not native transition proof. |
| Test tooling / coverage | Use synthetic fixtures for inventory, assertions and mappings. Cover replaced/missing build maps and chained library maps; do not read production source in behavioral tests. |

### Evidence and run isolation

- Use the CI-supported Node version from `.nvmrc` and a frozen dependency install. Mobile has its own install,
  typecheck and mounted React suite; an Android export proves bundling, not camera, audio, notifications or phone UI.
- Run against a stable checkout. Parallel edits, branch switches or app builds can change the code/assets being
  exercised: use an isolated checkout and sandbox ports rather than stopping another task's app or replacing its work.
  Missing or mismatched source maps invalidate coverage evidence; do not report omitted counters as unexecuted code.
- For native failures, check the display session, window manager and runtime dependencies. Repair the environment
  and rerun the affected check; do not convert an environment failure into a skip or a weaker focus assertion.
- Record the tested revision (and relevant uncommitted changes), exact commands, platform/runtime, passed/failed
  counts and any unverified paths in the change description or local verification report. A configured CI job is
  not a completed platform run. Evidence from before later edits is not verification of those edits.
- Passing suites, execution coverage and meaningful regression assertions are separate evidence. The default
  coverage command does not require every function to execute; strict coverage does. Inspect the current report
  for changed code, add tests for uncovered changed behavior and state remaining gaps. Never infer full coverage
  from zero skips, a historic green run or the test-quality gate. Keep reports and machine-specific logs out of rules.

## Portable tests

AGENTS.md rule 26. CI runs the unit tests on macOS and Windows as well as Linux; a test that holds only on the
machine it was written on is a broken test. The helpers live in `apps/core/src/testkit/platform.ts` (and
`engine/testkit.ts` for a sandbox core):

| Need | Use | Never |
|---|---|---|
| Wait until something is true | `waitFor(check, what, { ms })`: fails after `ms` of wall-clock time × `TEST_TIME_SCALE` | A loop of N tries, or a local `until` |
| A run's input or its end | `pendingInput(client, thread)`, `inputOrEnd(…)` | Polling `runs.pending` by hand |
| Idle, cap, deadline, burst | `manualTimers()` passed as `runTimers`; `tick(ms)`, or `autoAdvance` when runs chain | A window of real milliseconds |
| A temp folder | `tempDir(prefix)` → `{ path, remove() }`; `removeDir(dir)` for a folder made otherwise | `fs.rmSync(dir, { recursive: true })` |
| A child to be gone | `await stopped(child)` (or the product's `await stopTree(pid)`) before removing its folder | Removing the folder while it runs |
| Compare paths | `isInside`, `samePath` (`paths.ts`), `assertPath` in tests | ``startsWith(`${root}/`)``, `===` on paths |
| End a process | `exitWhenClosed(code)` (`@apx/protocol/exit`) | `process.exit` with handles open |

`TEST_TIME_SCALE` (default 1) stretches every `waitFor`, `stopped` and `removeDir` budget on a slow runner; it
never changes what a test decides. A failure seen only on Windows is first classified: product (the probe read a
timeout as "gone", a path compared case-sensitively) or test (a real-time window, a folder still held). Fix the
class, not the instance.

`pnpm check:tests` runs `scripts/test-portability.ts`, an AST lint for these classes. Today's remaining hits are
counted per file and rule in `scripts/test-portability-allowlist.json`; a new hit fails, and so does an allowance
a file no longer needs. To shrink it, migrate a file, then run `node scripts/test-quality.ts --shrink`: it lowers
the counts to what is left and never adds one. A deliberate exception carries `// portable: <why>` on its line or
the line above, and review reads that reason; a real-time window under 2 s has none: inject the clock, or the
runner that would time out.

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
pnpm check:commits HEAD              # the same gate over commits (public-safe history), see rules/RELEASE.md
pnpm check:schema                  # apps/core/src/db/schema.ts matches the migrations (`node apps/core/scripts/schema.ts` rewrites it)
```

## 3. Tests
```bash
pnpm exec playwright install chromium   # required by the headless core test; CI also installs OS dependencies
npm --prefix apps/mobile ci         # separate Expo install, including native component test dependencies
pnpm test                          # quality gate, workspace tests (UI included), mobile logic and React tests, scripts
pnpm check:tests                   # AST lint: disabled/exclusive/empty tests and unawaited Node assertions
pnpm test:coverage                 # all unit suites, then coverage/unit/functions.json and functions.md
pnpm test:coverage:all             # unit + browser + desktop execution, then coverage/all/ reports
pnpm test:coverage:strict          # fails if any inventoried function was not executed
pnpm test:coverage:all:strict      # the same requirement after unit, browser and desktop execution
node --test apps/core/src/server.test.ts
node --test e2e/install/onboarding.test.ts  # POSIX installer against a loopback feed and a temporary home
```
Rules: tests never touch the real home — pass a temp `home` to `createCore` (see `server.test.ts`); bind
`127.0.0.1` with port `0`; run offline (no network, no keys, no live core). No `test.skip`/`todo`: fix or delete
with a reason in the commit body.

The quality gate also rejects `t.skip()`, aliased test controls, conditional skip options, `only`, `fixme`,
literal-only assertions and empty callbacks. It parses TypeScript rather than matching comments or fixtures.
Promise assertions must be awaited or returned, including Jest's chained `.resolves` and `.rejects` matchers.
Browser coverage inventories repository source, not compiler-owned helpers. Coverage builds record each chunk's actual module IDs. Only a chunk containing exactly Rolldown's runtime module, or a module-free compiler facade whose parsed statements contain only static imports and re-exports, is excluded from the browser inventory; filenames alone never identify it. Mixed, application, executable and unknown chunks retain their counters and must have source maps. Missing or invalid provenance keeps every chunk, so the mapping gate still fails closed.

`typescript-parser` pins the TypeScript 5 parser for this lint and coverage inventory: the TypeScript 7 compiler
used by the workspace does not expose that parser through its default export.

Coverage includes tracked and new non-ignored JavaScript/TypeScript sources, including modules never imported.
It merges function execution across processes and maps compiled UI functions back through the build's source maps.
Chained maps are followed through compiled libraries to their original sources; missing intermediate maps fail collection.
Mobile React tests run with Jest Expo and React Native Testing Library; Babel instrumentation supplies original
TSX function declarations, including nested callbacks, to the same inventory. Never-loaded native screens remain
explicit zeroes. Tests replace only hardware and transport boundaries; React, hooks and the shared SDK execute.
The all-suites command builds browser source maps, collects Chromium function counters, and includes the sandbox
core and Electron processes. On Linux without a display it runs desktop tests under `xvfb-run` and Openbox
(CI installs both): native focus and minimization checks need a window manager as well as a display server.
Electron also needs the GTK 3 runtime (`libgtk-3-0` on Debian, `libgtk-3-0t64` on Ubuntu 24.04); the Chromium
dependency installer may supply GTK 4 without GTK 3, so CI installs Electron's runtime explicitly.
The headless browser test disables Chromium's sandbox only when the test process runs as root in a disposable
container; production browser launches retain it. On macOS, desktop coverage uses `caffeinate` for the test
process so the display does not sleep. Start native window tests in an unlocked graphical session with an
awake display; a sleeping or locked display cannot supply reliable native focus events.
The coverage sandbox picks separate loopback ports so parallel checkouts do not collide; `E2E_PORT`,
`E2E_CONTROL_PORT` and `E2E_WA_PORT` override them when debugging.
Reports identify each unexecuted function by file and line. An executed function still needs meaningful assertions;
unit coverage does not replace Playwright or a real phone. The default coverage command fails on suite failures;
the separate strict command additionally requires every inventoried function to execute. CI runs all suites with
coverage and keeps the JSON and Markdown reports.
Build text and source maps are snapshotted before each suite, so a concurrent app build cannot silently erase
browser execution from the report. Missing mappings for repository build counters fail collection.
CI also runs preflight and mounted mobile tests on macOS and Windows; Linux runs browser and desktop E2E too.
Package test globs use double quotes so Node receives the same pattern in POSIX shells and Windows cmd.exe.

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
pnpm preflight                     # check:private, check:schema, lint, typecheck, unit tests
pnpm verify                        # preflight, all-suite execution coverage, then lightness budgets
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
one core, like one owner from the first-run setup on. CI splits them into three parts (`--shard=i/3`), each on a core
of its own, so a spec may build only on what the `setup` project leaves (`01-setup`, `06-telegram`, `10-whatsapp`,
replayed first in every part; `playwright.config.ts`), never on another spec: set up anything else in the spec itself. Any console error or 5xx response fails the test. Specs
are written in Spanish, as the owner uses the panel. WhatsApp is emulated inside the sandbox's core: it starts
with `--import e2e/baileys-hook.ts`, which resolves the library to an in-memory phone (`e2e/fake-baileys.ts`, driven
through `world.whatsapp`), so the real adapter runs with no test path in the product.

## 5a'. Mobile
```bash
cd apps/mobile && npm install && npm run typecheck && npm test
npm run test:unit                       # pure logic under node:test
npm run test:ui                         # React hooks and native components under Jest Expo
npx expo export --platform android     # Metro bundles the app: proof it resolves, without a device
```
It installs outside the pnpm workspace (React Native never weighs on the rest). On a device: pair it from
Config › Devices with the core listening on the network (`APX_HOST=0.0.0.0` and `APX_TOKEN`, or Tailscale).
Jest Expo, its Jest version, Jest types and React Native Testing Library are development dependencies required to
exercise mounted hooks, component events and effect cleanup. Plain Node tests cannot execute React Native's
native modules or TSX screens. Their install does not change production dependency versions.

## 5b. Lightness
```bash
pnpm perf                          # builds the panel, then scripts/perf.ts
```
A core on a temp home with the fake model: startup, idle memory and CPU, protocol latency, chat turns, memory
once quiet again, and the panel's first load (gzip). Each number has a budget in `scripts/perf-budget.json`;
going over fails. Raising a budget is a regression: it needs a reason in the commit body.

The first load is read from the built `apps/web/dist` (`scripts/bundle.ts`), never from source:
`initial_bundle_gzip_kb` is what `index.html` names plus the chunks it imports statically; `boot_gzip_kb` adds the
heavier language chunk `main.tsx` waits for, with its own static imports — what a first screen really downloads.
`perf.ts` also fails when zod reaches that set or a named lazy screen (`ProjectScreen`, `ConfigModal`…) loses its own
chunk. Over budget or failing, it prints each first-load chunk's size and, with a sourcemap (CI's perf job builds
with `APX_TEST_COVERAGE=1`), the five packages or files that weigh the most: split the module it names.
Code loaded late is declared only in `apps/web/src/lazy.ts` (AGENTS.md rule 27); `biome.json` fails a first-screen
file (`App`, `main`, `shell/`, `inbox/`, `chat/`) that imports one of its modules directly, and
`e2e/specs/89-first-load.spec.ts` checks what opening the inbox fetches, its own late parts included.

## CI
`.github/workflows/verify.yml` runs on every push to `main` and every pull request. Every job starts from
`.github/actions/setup` (Node, `pnpm install`, and when the job needs them Playwright's Chromium and `apps/mobile`'s
own install, both cached: the browser by Playwright's version, the mobile `node_modules` by its lockfile). The jobs
start together:

| Job | What | Machines |
|---|---|---|
| Static checks and lightness budgets | commits, `pnpm preflight:static` (private terms, schema, lint, typecheck, test quality), mobile types, Android bundle; then `pnpm build:web` with coverage maps and `scripts/perf.ts` | 1 Linux |
| Unit tests | every package's tests, `node scripts/test-shard.ts <i>/2`, plus the POSIX installer onboarding | 2 Linux |
| Coverage | `node scripts/test-coverage.ts --e2e --part=…`: unit, panel in three (`--part=web --shard=i/3`), desktop | 5 Linux |
| Coverage report | merges the parts (`--merge --expect-parts=5`: a function ran if any part ran it; a part that never uploaded fails it) | 1 Linux |
| Unit tests (portability) | the unit tests only, `test-shard.ts` over 4 Windows and 2 macOS machines | 6 |

Static checks and unit tests together are `pnpm preflight`; coverage does not replace them (it runs the suites
another way, with instrumentation). The budgets share the static job: a separate one sat in the runner queue for a
quarter of an hour while taking one minute. `test-shard.ts` reads each package's own `test` script and deals the
files out in turn; every part runs each package's build step first. The aggregate `verify` job requires every
other job, so branch protection that requires it waits for all of them; a failed job can be retried on its own.

Windows: tests that wait scale their waits by `TEST_TIME_SCALE=3`, and a failed file runs once more
(`--rerun-failed`): passing then, it is reported as flaky (a warning annotation and a row in the job summary) and
the job stays green; failing again, the job is red ([D-145](DECISIONS.md#d-145)). Linux and macOS never rerun.
`.github/workflows/windows.yml` runs the same Windows parts on every push to `feat/**` and `fix/**` (or by hand),
so Windows sees a branch before it merges.

Tags: release tags build installers, and publication waits for the verify run of the exact commit on `main`,
without running the suites again. Tag only a commit that run already passed: `pnpm release:check --tag v2.x.y`
([RELEASE.md](RELEASE.md#tagging-a-release), AGENTS.md rule 28).

Reports are kept 14 days: `verify-reports` carries Playwright HTML, failed-test snapshots and coverage;
`perf-reports` explicitly includes `e2e/.out/perf.json`, even though its directory is hidden. The `autofix` job is
off by default: with the repo variable `APX_AUTOFIX=true` and the secret `ANTHROPIC_API_KEY`, a failure on main
hands the reports to an agent that fixes the cause and opens a pull request (never merged on its own, never by
weakening a gate).

## 6. Embedded browser (real path)
```bash
pnpm dev                                         # core
pnpm --filter @apx/web dev                       # panel
pnpm --filter @apx/desktop dev                   # Electron; `apx status` must show "browser ok — apx-desktop"
node apps/terminal/src/main.ts browser open https://example.com --by Roby
node apps/terminal/src/main.ts browser snapshot t1
node apps/terminal/src/main.ts browser shot t1 /tmp/t1.jpg
```
Profiles: open `https://httpbin.org/cookies/set?probe=1` in `shared`, then `https://httpbin.org/cookies` with another
`--by` (must show it) and with `--profile incognito` (must be empty). Credential guard: `browser type` into a
password field must fail with `credential_field`.
