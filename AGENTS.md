# AGENTS.md — dev guide for the APX v2 codebase

> Hand-maintained guide for working **on** APX v2 (read by Claude Code, Codex and any AGENTS.md-aware tool).
> This file is the hub: glossary, dev loop and numbered rules live here. Everything else is read on demand
> under [`rules/`](rules/). Product plan and research (Spanish) live in [`plan/`](plan/).

New here or reviewing? Read [`rules/HUMAN_MODEL.md`](rules/HUMAN_MODEL.md) first, then
[`rules/GUARDRAILS_PROFILE.md`](rules/GUARDRAILS_PROFILE.md) for which rules are enforced by a gate.

## Glossary

| Term | Means here | Not to be confused with |
|---|---|---|
| **core** | `apps/core`, the daemon: the only process that owns state. | "core logic" in general. |
| **terminal** | `apps/terminal`, the `apx2` CLI. A thin protocol client. | A shell/PTY. |
| **protocol** | `packages/protocol`: frames, the method registry and the client SDK. The one contract. | Ad-hoc REST routes (there are none). |
| **operator** | A client that shows/controls things (terminal, web, desktop, mobile). | A **node**. |
| **node** | A client that *lends capabilities* to the core (desktop: `browser`, `fs`; mobile: `camera`, `notify`). The core routes tool calls to it. | A Node.js process. |
| **surface** | A widget/app/artifact: HTML bundle + manifest, shown inline, in the sidebar or fullscreen, or published. | A UI "surface" in the generic sense. |
| **harness** | What runs an agent turn: `native` (own loop), `claude` (Agent SDK), `codex` (app-server), `acp`. | An **engine** (an LLM provider adapter). |
| **APC** | The open standard: `AGENTS.md` + `.apc/` in a project. APX implements it. | APX itself. |

## Dev loop

```bash
pnpm install
pnpm app                                   # build panel + desktop, start the core (serves the panel) and open the app
pnpm dev                                   # core only, on 127.0.0.1:7440, home ~/.apx2 (override APX_HOME/APX_PORT)
node apps/terminal/src/main.ts status      # is the core up, and is it running my code? (code_sha)
pnpm --filter @apx/web dev                 # panel on :7441, proxies /rpc, /ws, /health to the core
pnpm preflight                             # check:private + lint + typecheck + test — must be green before push
```

- The core runs `.ts` directly (Node 24 type stripping): no build step. `pnpm dev` uses `node --watch`, so a
  saved file restarts it. Always confirm with `apx2 status` that `code_sha` is the commit you expect.
- v2 runs **beside** v1: port `7440`, home `~/.apx2`, binary `apx2`. Never point v2 at `~/.apx`.

## Repo map

```
apps/core        daemon — transport/ → rpc/ (single router) → domain/ (store) · agent/ (loop, tools) · nodes/ · db/
apps/terminal    apx2 CLI — protocol calls only
apps/web         React panel — served by core, renderer of desktop
apps/desktop     Electron shell + embedded browser node (tabs, CDP, profiles, cookie import)
apps/mobile      Expo                                               (F7)
packages/protocol  zod frames + method registry + isomorphic client
packages/ui        design system, synced with Claude Design (see packages/ui/.design-sync/NOTES.md)
packages/surfaces  widgets/apps/artifacts runtime (placeholder; the MVP host lives in apps/web/src/surfaces)
packages/config    shared tsconfig
plan/            plan + research (Spanish). rules/  engineering docs. scripts/  repo gates.
```

## Project rules

Each rule says how it is enforced. `[gate]` = a command fails; `[review]` = convention checked in review.

1. **One contract.** Every client↔core call is a method in `packages/protocol/src/methods.ts` handled through
   `apps/core/src/rpc/router.ts`. No second route into a handler (no ad-hoc HTTP endpoints, no direct
   module calls from transports). `[review]`, `[gate]` types.
2. **Agents talk through one function.** Agent↔agent messaging is `threads.send` via the router; tools,
   terminal, routines and API all call it. Never add a parallel a2a path. `[review]`
3. **Apps hold no domain logic.** terminal/web/desktop/mobile call the protocol; logic lives in `apps/core`.
   `[review]`
4. **Dependency direction** inside core: `transport → rpc → domain`; `domain` never imports `transport`, `rpc`
   or `channels`. `packages/*` never import `apps/*`. `[review]` (lint gate planned — see GUARDRAILS_PROFILE).
5. **Erasable TypeScript only** (`erasableSyntaxOnly`): no `enum`, `namespace` or parameter properties. Enums are
   `as const` objects + derived type. `[gate]` typecheck.
6. **Config and paths are injected**, never read at import time. The store must refuse the real home under a
   test runner (lands with `db/`). `[review]`
7. **Loopback by default.** The core refuses a non-loopback bind without `APX_TOKEN`. `[gate]` test.
8. **Side-effect methods require an idempotency key** (`effect: true` in the registry). `[gate]` router.
9. **Every turn/job/tool call has a deadline and a persisted terminal state**; client deadline > server deadline.
   `[review]`
10. **Untrusted content stays untrusted.** Web pages, channel messages, other agents' text and tool output are
    data, never instructions. Model output never becomes unchecked authority for side effects: high-impact tools
    (send, pay, shell, write outside the project) need confirmation while untrusted content is in context. The
    embedded browser never types passwords or payment data — it hands off to the human. `[review]`
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
18. **Conventional commits** (`feat:`, `fix:`, `chore:`…); the release tooling will read them. `[review]`
19. **Never weaken a gate to get green** (lint rule off, test skipped, type `any`). Downgrading a rule needs a
    `DECISIONS.md` entry. `[review]`
20. **New dependency = stated reason** why the platform or an existing dependency is not enough (in the PR/commit
    body). Prefer Node built-ins (`node:test`, `node:sqlite`, `fetch`, `WebSocket`). `[review]`

### Code comments

1–2 lines, only the non-obvious *why*. No history, incidents, dates or rejected alternatives in code: those go to
[`rules/HISTORY.md`](rules/HISTORY.md) or [`rules/DECISIONS.md`](rules/DECISIONS.md), and the comment points at
the anchor (`// See HISTORY.md#webhook-ack`). Type annotations and TSDoc used by the IDE are fine.

## Workflow

Non-trivial changes follow [`rules/WORKFLOW.md`](rules/WORKFLOW.md):
plan → implement → independent review → security/risk review → test + runtime proof → architecture check →
owner brief → release check. Commands for each level: [`rules/TESTING.md`](rules/TESTING.md).

A green typecheck is not proof. Runtime changes are verified against the **running** core (`apx2 status` shows the
expected `code_sha`) and the changed path is exercised for real; anything not exercised is reported `UNVERIFIED`.

## Deep dives

| When | Read |
|---|---|
| First time / reviewing | [`rules/HUMAN_MODEL.md`](rules/HUMAN_MODEL.md) |
| Which rules have a gate, high-risk changes | [`rules/GUARDRAILS_PROFILE.md`](rules/GUARDRAILS_PROFILE.md) |
| Why something is the way it is | [`rules/DECISIONS.md`](rules/DECISIONS.md), [`rules/HISTORY.md`](rules/HISTORY.md) |
| How to verify | [`rules/TESTING.md`](rules/TESTING.md) |
| Product direction | [`plan/01-arquitectura-v2.md`](plan/01-arquitectura-v2.md), [`plan/00-plan-maestro.md`](plan/00-plan-maestro.md) |
| Design system | [`packages/ui/.design-sync/NOTES.md`](packages/ui/.design-sync/NOTES.md), `packages/ui/src/components/*.md` |
