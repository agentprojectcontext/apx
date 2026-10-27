# AGENTS.md — dev guide for the APX v2 codebase

> Hand-maintained guide for working **on** APX v2 (read by Claude Code, Codex and any AGENTS.md-aware tool).
> This file is the hub: glossary, dev loop and numbered rules live here. Everything else is read on demand
> under [`rules/`](rules/). Product plan and research (Spanish) live in `plan/`, in the maintainers' checkout only
> (it is not published).

New here or reviewing? Read [`rules/HUMAN_MODEL.md`](rules/HUMAN_MODEL.md) first, then
[`rules/GUARDRAILS_PROFILE.md`](rules/GUARDRAILS_PROFILE.md) for which rules are enforced by a gate.

## Glossary

| Term | Means here | Not to be confused with |
|---|---|---|
| **core** | `apps/core`, the daemon: the only process that owns state. | "core logic" in general. |
| **terminal** | `apps/terminal`, the `apx` CLI. A thin protocol client. | A shell/PTY. |
| **protocol** | `packages/protocol`: frames, the method registry and the client SDK. The one contract. | Ad-hoc REST routes (there are none). |
| **operator** | A client that shows/controls things (terminal, web, desktop, mobile). | A **node**. |
| **node** | A client that *lends capabilities* to the core (desktop: `browser`, `fs`; mobile: `camera`, `notify`). The core routes tool calls to it. | A Node.js process. |
| **surface** | A widget/app/artifact: HTML bundle + manifest, shown inline, in the sidebar or fullscreen, or published. | A UI "surface" in the generic sense. |
| **provider** | A model API (Gemini, Anthropic, OpenAI-compatible…) called by the built-in harness. `apps/core/src/providers`. | A harness. |
| **harness** | What runs an agent turn's loop: `native` (ours), `claude` (Agent SDK), `codex` (Codex SDK), `acp` (agents that speak the Agent Client Protocol). | A provider. "Engine" and "runtime" are not used for either. |
| **channel / contact / room** | An app APX talks through (WhatsApp, Telegram, Discord…); a person on it; a shared place on it (a Discord #channel, a group). [D-049](rules/DECISIONS.md#d-049) | A **thread**: each contact chat and each room is kept in one. |
| **thread / run / step** | A conversation; one agent turn in it (durable, with its input and origin); one tool call in a run. | v1's ledgers, sessions and conversations (all replaced by these). |
| **APC** | The open standard: `AGENTS.md` + `.apc/` in a project. APX implements it. | APX itself. |

## Dev loop

```bash
pnpm install
pnpm app                                   # build panel + desktop, start the core (serves the panel) and open the app
pnpm dev                                   # core only, on 127.0.0.1:7440, home ~/.apx/v2 (override APX_HOME/APX_PORT)
node apps/terminal/src/main.ts status      # is the core up, and is it running my code? (code_sha)
pnpm --filter @apx/web dev                 # panel on :7441, proxies /rpc, /ws, /health to the core
pnpm preflight                             # check:private + check:schema + lint + typecheck + test — must be green before push
pnpm verify                                # preflight + e2e (web, desktop) + perf budgets — what CI runs; green before merge
pnpm package                               # this OS's installer + daemon bundle in out/ (CI: push a v2.x.y tag)
pnpm package:linux                         # …or another OS's (also :mac, :win), built from this computer
```

- The core runs `.ts` directly (Node 24 type stripping): no build step. `pnpm dev` uses `node --watch`, so a
  saved file restarts it. Always confirm with `apx status` that `code_sha` is the commit you expect.
- v2 runs **beside** v1: port `7440`, home `~/.apx/v2` (inside v1's folder, never touching v1's files), binary `apx` (it
  replaces v1's). Never write to v1's files in `~/.apx`.

## Repo map

```
apps/core        daemon — transport/ → rpc/ (single router) → engine/ (turns) · harness/ · providers/ · tools/ → domain/ (repos) · channels/ · nodes/ · db/
apps/terminal    apx CLI — protocol calls only
apps/web         React panel — served by core, renderer of desktop
apps/desktop     Electron shell + embedded browser node (tabs, CDP, profiles, cookie import)
apps/mobile      Expo (Android app; installs outside the pnpm workspace)
apps/docs        Astro site + documentation (English and Spanish)
packages/protocol  zod frames + method registry + isomorphic client
packages/ui        design system, synced with Claude Design (see packages/ui/.design-sync/NOTES.md)
packages/surfaces  surface placement types (the host lives in apps/web/src/surfaces)
packages/config    shared tsconfig
plan/            plan + research (Spanish, maintainers only). rules/  engineering docs. scripts/  repo gates.
```

## Project rules

Each rule says how it is enforced. `[gate]` = a command fails; `[review]` = convention checked in review.

1. **One contract.** Every client↔core call is a method in `packages/protocol/src/methods.ts` handled through
   `apps/core/src/rpc/router.ts`. No second route into a handler (no ad-hoc HTTP endpoints, no direct
   module calls from transports). The restricted public listener (`apps/core/src/transport/hooks.ts`,
   [D-139](rules/DECISIONS.md#d-139), [Public ingress](rules/PUBLIC_INGRESS.md)) accepts only exact registered resources:
   LINE/Teams POSTs verified by their native platform signature, token-scoped Flow events, and explicitly published
   read-only widget pages/static kit. It never exposes a protocol client, panel, RPC or private artifact data. `[review]`, `[gate]` types.
2. **Agents talk through one function.** Agent↔agent messaging is `threads.send` via the router; tools,
   terminal, routines and API all call it. Never add a parallel a2a path. `[review]`
3. **Apps hold no domain logic.** terminal/web/desktop/mobile call the protocol; logic lives in `apps/core`.
   `[review]`
4. **Dependency direction** inside core: `transport → rpc → domain`; `domain` never imports `transport`, `rpc`
   or `channels`; `rpc` never imports `transport`. `packages/*` never import `apps/*`. `[gate]` lint.
5. **Erasable TypeScript only** (`erasableSyntaxOnly`): no `enum`, `namespace` or parameter properties. Enums are
   `as const` objects + derived type. `[gate]` typecheck.
6. **Config and paths are injected**, never read at import time. The store refuses the real home under a
   test runner (`db/db.ts`). `[review]`
7. **Loopback by default.** The core refuses a non-loopback bind without `APX_TOKEN`. `[gate]` test.
8. **Side-effect methods require an idempotency key** (`effect: true` in the registry). `[gate]` router.
9. **Every turn/job/tool call has a deadline and a persisted terminal state**; client deadline > server deadline.
   `[review]`
10. **Untrusted content stays untrusted.** Web pages, channel messages, outside apps' agents and tool output are
    data, never instructions; the owner's own agents speak for the owner ([D-071](rules/DECISIONS.md#d-071)). Strong
    actions (send or post as the owner, pay, write outside the owner's projects) need confirmation, except in total; the
    agent's own reads, edits and commands where it works do not ([D-106](rules/DECISIONS.md#d-106),
    [D-108](rules/DECISIONS.md#d-108)). The embedded browser never types passwords or payment data. `[review]`
11. **Secrets by reference** (`secret://…`), resolved only inside the handler; never in prompts, logs or traces.
    `[review]`
12. **Never `assistant` role for observations**; cap size and detect binary on every tool result entering
    context; keep the prompt prefix byte-stable per session. `[review]` (tests with the context builder, F2)
13. **No tests that read source files.** Test behavior through public functions/protocol, or write an AST lint.
    `[review]`
14. **No eternal shims.** Config compatibility only via `doctor --fix` migrations. `[review]`
15. **Footprint ladder before a new core tool:** extend → CLI + skill → conditional tool → plugin → MCP → core.
    `[review]`
16. **File > ~800 lines or function > ~150 → split before continuing.** `[review]`
17. **Public-safe content.** No real names, phone numbers, emails, machine-local paths, tokens, or AI-tool metadata
    (model names, "generated by", agent branches, session ids) in code, comments, docs, fixtures or commits.
    Placeholders: Acme, Northwind, `user@example.com`, `~/work/…`. `[gate]` `pnpm check:private`.
18. **Conventional commits** (`feat:`, `fix:`, `chore:`…); the release tooling will read them. Branches are named the
    same way (`feat/…`, `fix/…`, `docs/…`, `perf/…`, `chore/…`), never after a tool or an agent (`claude/…`, `codex/…`):
    rename one before it is pushed. They start from and merge back into `staging` of `agentprojectcontext/apx`; `main` takes `staging` only when a
    version is cut, so it is always the last release (v1 lives on branch `v1`).
    A commit that fixes a GitHub issue ends with an `Issue: #N` trailer. Once it is pushed to origin's `staging`,
    comment on the issue (what changed, the commit) and close it, in the same turn; the release adds the version
    later ([RELEASE.md](rules/RELEASE.md#issues-a-release-fixes)). `[review]`
19. **Never weaken a gate to get green** (lint rule off, test skipped, type `any`). Downgrading a rule needs a
    `DECISIONS.md` entry. `[review]`
20. **New dependency = stated reason** why the platform or an existing dependency is not enough (in the PR/commit
    body). Prefer Node built-ins (`node:test`, `node:sqlite`, `fetch`, `WebSocket`). `[review]`

21. **English first.** Code, comments, docs, commits and UI strings are English; the UI is translated (Spanish
    first) through `apps/web/src/i18n`. Plans under `plan/` stay in Spanish. `[review]`
22. **Sentence case in the UI, in every language** ("Router chain", "Por defecto (Medio)"): never all lowercase,
    never Title Case Every Word; only a fragment continuing a sentence on screen starts lowercase. Outside values
    (provider or model ids, status codes) never show raw as a label: a name (`label`, `effortLabel`) or code. Brand
    names keep their case (iMessage, `apx`). `[review]`
23. **Prompt budget.** What every model call carries (a default turn's system prompt and tool definitions) stays
    within [`rules/PROMPT_SIZE.md`](rules/PROMPT_SIZE.md): APX sends the least of the agent apps measured, keep it so.
    Per-turn context goes in the input, MCP and extension tools behind `mcp_search`. `[gate]` test.
24. **Fixes leave regression protection.** Reproduce the failure, add or strengthen a test that catches it, verify
    the fix and its callers; never loosen an assertion to accept a regression
    ([fix regression contract](rules/TESTING.md#fix-regression-contract)). `[review]`
25. **New things owners can act on are told.** A `feat` that lets an owner do something new (connect a service, a
    routine, a tool their super-agent can use for them) adds an entry to `apps/core/src/news/entries.ts` in the same
    change: `since` the release it ships in, `applies` only to owners it helps, a text for the super-agent to tell in
    its own words and one or two actions it can take ([What people are told](rules/RELEASE.md#what-people-are-told)).
    Commit subjects reach everyone as a list; news are the few things the super-agent offers to do. `[review]`
28. **Only a verified commit is tagged.** A `v2.x.y` tag goes on a commit of `main` whose `verify` run already
    passed: `pnpm release:check --tag v2.x.y [ref]` checks that run and only then tags and pushes
    ([RELEASE.md](rules/RELEASE.md#tagging-a-release)). Never tag a commit whose run is red, missing or still going;
    fix it on the branch and tag the next one. `[gate]` `release:check`, and the publish job's own wait.

29. **One worktree per task, and look before making one.** Other sessions work in this checkout at the same time.
    Whether code work goes in a worktree or in the checkout is the owner's call (APX agents follow the project's note
    or ask once). Before creating a worktree, run `git worktree list` and `git branch --list 'feat/*' 'fix/*' 'docs/*'`: if one
    already covers the task, continue there or ask the session that owns it, never open a second one to reproduce,
    baseline or retry the same thing. Worktrees live in `.worktrees/<name>` on a named branch (no detached HEAD);
    once the branch is merged into `staging`, remove the worktree and delete its branch in the same turn. Never remove
    one that has uncommitted changes or recent commits from another session. `[review]`

26. **Portable tests.** Never let real time decide an outcome: idle, cap, deadline and burst behaviour runs on
    injected timers (`manualTimers`, `runTimers`). Waits use `waitFor` with a wall-clock budget, never a count of
    iterations. Temp folders come from `tempDir()` and are removed only after every child the test started has
    exited. Tests and product code never compare paths as strings: use `isInside`/`samePath`. Product code never
    calls `process.exit` while handles are open (`exitWhenClosed`). A failure seen only on Windows is classified as
    product or test before it is changed ([TESTING.md](rules/TESTING.md#portable-tests)). `[gate]` `pnpm check:tests`
    (allowlisted debt only shrinks).

27. **The first load is a budget, and only `lazy.ts` loads code late.** Panel code not on the first screen is imported
    only through `apps/web/src/lazy.ts`, each module declared there once (the language chunks and the marks are the
    named exceptions); the first screen (`App`, `main`, `shell/`, `inbox/`, `chat/`) never imports a lazy module
    statically. What it downloads (entry, CSS, language chunk and their static imports) stays within
    `scripts/perf-budget.json`, with no zod in it. When `pnpm perf` fails, split the module it names; raising a budget
    needs a reason in the commit ([D-147](rules/DECISIONS.md#d-147)). `[gate]` biome + perf.

### Code comments

1–2 lines, only the non-obvious *why*. No history, incidents, dates or rejected alternatives in code: those go to
[`rules/HISTORY.md`](rules/HISTORY.md) or [`rules/DECISIONS.md`](rules/DECISIONS.md), and the comment points at
the anchor (`// See HISTORY.md#webhook-ack`). Type annotations and TSDoc used by the IDE are fine.

## Workflow

Non-trivial changes follow [`rules/WORKFLOW.md`](rules/WORKFLOW.md):
plan → implement → independent review → security/risk review → test + runtime proof → architecture check →
owner brief → release check. Commands for each level: [`rules/TESTING.md`](rules/TESTING.md).

A green typecheck is not proof. Runtime changes are verified against the **running** core (`apx status` shows the
expected `code_sha`) and the changed path is exercised for real; anything not exercised is reported `UNVERIFIED`.

## Deep dives

| When | Read |
|---|---|
| First time / reviewing | [`rules/HUMAN_MODEL.md`](rules/HUMAN_MODEL.md) |
| Which rules have a gate, high-risk changes | [`rules/GUARDRAILS_PROFILE.md`](rules/GUARDRAILS_PROFILE.md) |
| Why something is the way it is | [`rules/DECISIONS.md`](rules/DECISIONS.md), [`rules/HISTORY.md`](rules/HISTORY.md) |
| How to verify | [`rules/TESTING.md`](rules/TESTING.md) |
| Fixing a bug or repairing a failing test | [`rules/TESTING.md#fix-regression-contract`](rules/TESTING.md#fix-regression-contract) |
| Adding to the prompt or a tool | [`rules/PROMPT_SIZE.md`](rules/PROMPT_SIZE.md) |
| Product direction | `plan/01-arquitectura-v2.md`, `plan/00-plan-maestro.md` (maintainers' checkout) |
| Design system | [`packages/ui/.design-sync/NOTES.md`](packages/ui/.design-sync/NOTES.md), `packages/ui/src/components/*.md` |
