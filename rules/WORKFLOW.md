<!-- guardrails-workflow:start v2 node-fullstack -->
<!-- Fixed block. Do not edit; replace it whole to upgrade. Project notes go below the end marker. -->

# Change workflow

For non-trivial changes. A typo or a one-line fix skips to step 5.

PLAN → IMPLEMENT → INDEPENDENT REVIEW → SECURITY/RISK REVIEW (when relevant)
→ TEST + RUNTIME PROOF → ARCHITECTURE CHECK (when structural) → OWNER BRIEF
→ RELEASE CHECK (when deploy-sensitive)

## 1. Plan

Do not edit yet.

- Trace the current behavior through the real execution path.
- Name the exact files and modules you will touch.
- Find the canonical existing operation, constant, pattern or component and reuse it.
- List writes and side effects (persistence, jobs, mail, events, external calls).
- Name the auth, authorization and tenant/account boundaries involved.
- State risks and how you will verify.
- Classify architecture impact: NONE / LOCAL / STRUCTURAL.

## 2. Implement

- Follow the plan; if reality contradicts it, update the plan first.
- Match repository conventions and neighboring code.
- Keep the diff scoped: no unrelated refactors or cleanup.
- Add or update tests; a bug fix gets a regression test when feasible.
- No casual dependencies; justify any new one.
- Preserve logs, metrics and error reporting; never log secrets or personal data.
- Comments: 1–2 lines of *why*. Longer reasons go to `HISTORY.md` or
  `DECISIONS.md`, and the comment points to the anchor.
- Review your own final diff before calling it done.

## 3. Independent review

Fresh context when possible. Self-review does not count.

- Requirement vs implementation.
- Duplicated business logic or a second source of truth.
- Wrong auth/authorization assumptions, tenant or account leaks.
- Tests that mirror implementation instead of proving behavior.
- Unnecessary abstractions.
- Narrative comments, personal data, local paths or AI-tool metadata in the diff.
- The stack checks below.

Classify each finding BLOCKER / SHOULD FIX / OPTIONAL, with concrete evidence.
Do not return generic checklist noise.

## 4. Security / risk review

Only the attack surfaces the change touches: auth vs authorization, isolation,
input validation, injection (SQL, HTML, command, prompt), SSRF, redirects,
uploads, webhooks, secrets, rate limits, payments, dependency risk, plus the
stack checks below.

## 5. Test + runtime proof

Use the real commands from `TESTING.md`. Report each level separately:

1. builds / parses / typechecks
2. static checks and lint
3. unit and feature tests (which, how many passed)
4. the real path exercised (browser, process, worker, device) with evidence
5. integrations touched (queue, realtime, external API, payments)

Anything not verified is written as `UNVERIFIED`. A green build is not proof
that the feature works.

## 6. Architecture check

Compare against `AGENTS.md`, `GUARDRAILS_PROFILE.md`, `SYSTEM_MAP.md` and the
neighboring code. Look for a second implementation of one operation, a wrong
layer, new global state, hidden side effects, boundary drift and docs that
became false. Do not refactor for aesthetic purity.

## 7. Owner brief

For a technical owner who will not read the whole diff:

- **What changed**
- **Flow:** entry → operation → persistence/side effect → response
- **Files worth knowing:** at most 7
- **Risk:** LOW / MEDIUM / HIGH
- **Proof:** exact checks and runtime verification done
- **Architecture:** NONE / LOCAL / STRUCTURAL
- **If it breaks:** where to look first, how to roll back
- **Human attention:** at most 3 things worth checking personally

## 8. Release check

Only for deploy-sensitive work. Review what applies: schema/data migrations,
environment variables, build output, workers and schedulers, caches, auth/IdP
config, webhooks, external services, feature flags, observability, rollback
sequence. Return GO / GO WITH CAUTION / NO-GO. Never GO on unit tests alone.

When something breaks in production: find the failing boundary, collect
evidence first, rank hypotheses, apply the safest mitigation, and fix
permanently only after the cause is proven.

## Stack checks — Node / TypeScript

- **Plan:** entry point (HTTP, CLI, worker, MCP tool, IPC) → module → state/persistence → side effects. Note which process runs the code and whether it must be restarted.
- **Implement:** follow the repo's native extension mechanism (adapters, providers, registries) instead of adding a parallel one; keep dependency direction; explicit failure modes, timeouts and retries.
- **Review:** circular or wrong-direction imports; god modules; runtime state leaking across requests or sessions; duplicated tool execution; stale async state; unsafe filesystem, command or network handling.
- **Security:** command injection; path traversal; SSRF; IPC/WebSocket/MCP boundaries; prompt or tool injection where model output drives side effects; resource exhaustion.
- **Runtime proof:** the running process actually loaded the new code; the changed path actually executed (request, command, tool call) with output as evidence.
- **Release:** process restarts and daemons; published package contents; config and env; data/schema migrations; backward compatibility for clients and plugins.

<!-- guardrails-workflow:end -->

## Specifics of this project

Rules are numbered in [`AGENTS.md`](../AGENTS.md); deep dives are in this directory.
There is no `TESTING.md`/`SYSTEM_MAP.md`: read [`testing.md`](testing.md),
[`architecture.md`](architecture.md) and [`repo-layout.md`](repo-layout.md).
Scale: a typo needs 2 and 5; a new route 1, 2, 3, 5, 7; auth, shell, filesystem,
network or an inbound channel adds 4; structural adds 6; reaching `main` adds 8.

### 1. Plan
- Name the real hops, e.g. `host/daemon/api/exec.js` → `core/agent/run-agent.js` → handler, and the layer (`core` / `host` / `interfaces`).
- More than one copy of the operation (route, CLI, tool handler)? The fix goes in `core/` and both call it (rule 8). The shared kernel already owns paths, JSON I/O, frontmatter, project resolution, constants, spawn-capture.
- A changed route shape, tool name, config key or adapter contract has downstream readers: skills, `docs/`, sibling adapters (rule 6).
- Name the silent failure mode up front: a routine that stops firing, an adapter that ignores an option, a missing `en.ts` key that serves Spanish with every gate green.

### 2. Implement
- Registries: a new engine/runtime/handler/embed engine/CLI route is one file plus one registry line; never edit siblings. An adapter honors every option it is handed or declares a capability field.
- Imports via `#core/*`, `#host/*`, `#interfaces/*`. Constants have homes; tool names live in `core/agent/tools/names.js` and duplicate-send protection keys off them.
- A `catch` logs or re-throws. Tests set `process.env.APX_HOME` before importing; no skipped tests (`test:ci` fails on `skipped`/`todo`). A bug fix's commit body names the regression test.
- Same change updates what it falsifies: grep every `src/core/runtime-skills/*/SKILL.md` for the old claim, `docs/` in EN and ES (`cd docs && pnpm build`), and the comment above the code.

### 3. Independent review
- Layer dodges lint cannot see: a framework object passed into `core/`, `os.homedir()` wrapped to rebuild an `~/.apx` path.
- Route handlers in `asyncRoute()`; no sync I/O on a request path (rule 15). Optional deps (`better-sqlite3`, `sqlite-vec`, `puppeteer`) are sometimes absent.
- Real data (rule 3): `npm run check:private` catches shapes and the local list; an unlisted name is caught only by the reviewer.
- Read the requirement and the diff before the author's notes; the notes say what the code was *meant* to do.
- Walk every `catch`, default and fallback: does a failure reach a human, or does the feature quietly stop? This is the house failure mode.
- A touched family (engines, runtimes, handlers, embed engines): check every sibling honors the options it is handed, or declares it cannot.
- A regression test must fail before the fix; a test that re-asserts the code's structure catches nothing.
- Each finding: `file:line`, the defect, inputs/state → wrong result. An empty result is valid.

### 4. Security / risk review
Threat model: untrusted text (Telegram, web page, file, MCP result, another agent) reaching a tool call. See [`surfaces.md`](surfaces.md).
- One token store (`token-store.js`), one WS check (`isWsUpgradeAuthorized` in `ws-auth.js`); the daemon may bind `0.0.0.0`, so reaching the port is not authorization.
- Argument arrays, never paths interpolated into command strings. Paths bounded to the project. Writes via the atomic JSON helpers, never into a committed path unreviewed.
- Model output never becomes unchecked authority: ask whether text from a message, page, file, MCP result or another agent can reach a shell command, a path or a send. A `cat "${path}"` built from user input has already happened here.
- Renaming a tool without updating `names.js` silently disables the duplicate-send check. On retry, does the operation or a routine run twice?
- Daemon-side fetches of URLs from config or model output are SSRF primitives; every outbound call has a timeout.
- A guest Telegram sender must not reach owner tools. `apx config show --effective` and `apx status` print secrets; project-scoped tokens passed as tool arguments are not masked in the ledger or live feed.

### 5. Test + runtime proof
- Gate: `npm run preflight`. `npm run lint` alone never opens the panel (`lint:web` does). Not in preflight: `npm run e2e:gate` (required for `main`, [`testing.md`](testing.md#the-e2e-gate)) and `cd docs && pnpm build`.
- Runtime: `apx restart` from the **main** checkout (worktrees cannot run the daemon; check with `ps -o command= -p "$(pgrep -f 'src/host/daemon/index.js' | head -1)"`), `curl -s 127.0.0.1:7430/api/health` (`uptime_s` near zero), `apx daemon logs --tail 30`, then exercise the path (`apx exec "…"`, the route, the screen). A fresh `uptime_s` only proves a restart.
- Live without restart: runtime skills on save, `~/.apx/config.json` via `POST /api/admin/reload`. Engine skills (`skills/`) need `apx skills sync`. Never run `apx update` in a dev checkout.

### 6. Architecture check
- Check rules 7, 8, 9, 10, 12, 13, 16, [`architecture.md`](architecture.md), [`decisions/`](decisions/) and the siblings. Do not import patterns from elsewhere.
- A consumer importing a concrete adapter instead of the registry is how `confirmation/adapters/` went half-dead.
- Relying on a rule? Check [`enforcement.md`](enforcement.md) for whether it is a gate or prose; prefer adding a lint rule, test or ratchet. Never weaken a rule to get green.
- First member of a family that will grow → build the registry now; the only member forever → don't.
- `src/interfaces/tui/` is a vendored island with no `#core/` imports, by design.

### 7. Owner brief
- Lead with the change in *behavior* for a person using APX, not the refactor. The UNVERIFIED list is never left empty to look better; plain sentences, no advocacy. Small change: what changed, evidence, UNVERIFIED, rollback is a complete brief.
- Also list **assumptions** made without asking. Rollback: if `~/.apx` state or a file format changed, `git revert` + `apx restart` is not enough; say so.

### 8. Release check
- Commit type decides whether npm ships ([`releasing.md`](releasing.md)); reaching `main` follows [`reaching-main.md`](reaching-main.md).
- Incidents, before any code change: first confirm the daemon runs the new code (checkout + restart, as in 5). Bound by surface: one surface → its adapter; all → daemon, `core/` or `~/.apx`; one project → resolution or `.apc/`; sometimes → race, retry, fallback, optional dep.
- Evidence: `apx daemon logs --tail 100` first; then browser console/network, `apx exec`, `curl` on the route, `node scripts/inspect-channel-prompts.js` for prompts. Reproduce once with the exact input written down.
- Priors: old code running; a silent failure (MCP not spawned, embedding backend down, swallowed `catch`); reading the uncalled copy; an adapter ignoring an option; stale or old-format `~/.apx` state; a missing key falling back; an absent optional dep.
- Report symptom → boundary → evidence → ranked hypotheses (keep the ruled-out ones) → mitigation → fix with a regression test.
