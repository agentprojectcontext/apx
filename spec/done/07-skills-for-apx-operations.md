# 07 — Skills for APX operations

**Priority**: P1
**Size**: M
**Status**: idea

## Problem

When the super-agent gets "andá creando una rutina que mande el clima todos los días" or "registrá un MCP nuevo para slack", it has to know the exact CLI syntax. Today the base prompt mentions commands by name but doesn't teach the model the call shape. The result: the model invents flags, misformats schedules, picks the wrong routine kind.

The APX skill system (`skills/<slug>/SKILL.md`) was built exactly for this — on-demand documentation the model loads when relevant. We have `apx` (the meta-skill) and a handful of others, but no detailed operational skills.

## Skills to write

For each, the body is concrete: exact command syntax, valid argument ranges, gotchas, a worked example, and the decision tree (when to pick this over an alternative).

- `apx-routine` — create, edit, run, debug routines. Covers `kind` selection (`heartbeat | exec_agent | super_agent | telegram | shell`), schedule grammar (`every:Nm`, `every:Nh`, `once:<iso>`, cron), `pre_commands` / `post_commands` patterns, when **NOT** to use `super_agent` kind.
- `apx-project` — register, list, configure, set per-project model, link to channels.
- `apx-mcp` — add MCP servers (shared vs runtime vs global), debug connection issues, common gotchas (`uvx`, `npx`, env passing).
- `apx-agent` — create agents in a project, edit AGENT.md, write memory, model selection per agent.
- `apx-telegram` — channels, routing, master agents, sending media.
- `apx-runtime` — call external CLIs (`claude-code`, `codex`, `opencode`, …), pass system prompts, capture results.
- `apx-task` — depends on item 05 landing first.

Each skill: ~80-200 lines markdown, opinionated and short. Examples first, theory after.

## Wiring

- Skills live in `skills/<slug>/SKILL.md` already-served by the scaffold (no code change beyond writing the files).
- The super-agent base prompt gets a single new paragraph: "For multi-step APX operations (create a routine, register a project, configure telegram, add an MCP, …), call `load_skill({ slug: 'apx-<topic>' })` before composing the command. Don't guess flag names — they change."
- The `load_skill` tool already exists (`src/host/daemon/super-agent-tools/tools/load-skill.js`).

## Done criteria

- [ ] All 6 skill files written and discoverable via `apx skills list`.
- [ ] Running `apx exec super-agent "creá una rutina que mande el clima de Bariloche cada 24h por Telegram"` produces a working `apx routine add …` command without hallucinations.
- [ ] Each skill has one "anti-example" section: a common wrong invocation and what fails.

## Owner

Self (Opus) — these prompts are the kind of thing a small model would generalize and get wrong.
