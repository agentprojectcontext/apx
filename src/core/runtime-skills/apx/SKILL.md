---
name: apx
description: "APX CLI umbrella — routes operations to sub-skills (sessions, MCPs, routines, tasks, telegram, projects, agents, runtimes). Activate on `apx`, the APX daemon, or coordinating/running/delegating agents. Not for `.apc/` alone (use apc-context). Triggers: 'apx', 'apx run', 'apx daemon', 'coordinate agents'."
homepage: https://github.com/agentprojectcontext/apx
---

# APX — Agent Project Context Runtime

APX is a daemon (`127.0.0.1:7430`, auto-starts on first call) that turns external coding CLIs (Claude Code, Codex, OpenCode, Aider, …) and configurable agents into a unified orchestration surface. It reads APC project context from `.apc/` (committed) but keeps runtime state outside the repo under `~/.apx/projects/<project-id>/`. Super-agent has a default workspace at `~/.apx/projects/default` for system-level work.

## When to use APX (vs. native subagent)

If you can spawn a subagent natively in the current IDE (Claude Code, Cursor, …) — **do that**. No APX needed. Use APX when:
- User explicitly asks for a specific external runtime ("run this in Codex", "delegate to OpenCode").
- You need an agent in a runtime different from the one you're in.
- Orchestrating from outside any IDE (script, Telegram bot, CI, routine).

## Sub-skill index

| Topic | Sub-skill | When |
|-------|-----------|------|
| Delegate to external coding CLI | **apx-runtime** | `apx run <agent> --runtime claude-code\|codex\|...` |
| List/read/resume/summarise/continue sessions | **apx-sessions** | `apx session resume`, `apx sessions list`, "import a codex session" |
| Use a registered MCP tool | **apx-mcp** | `apx mcp tools`, `apx mcp run`, "call MCP filesystem", "MCP failing" |
| Add/configure/use a project agent | **apx-agent** | "add an agent", vault import, per-agent model, agent memory |
| Register/list/configure a project | **apx-project** | "register this project", `apx project list`, per-project config |
| Per-project TODO list | **apx-task** | "add a task", "remind me to…", "what's pending" |
| Scheduled/recurring agents | **apx-routine** | `apx routine add`, every-5m, cron-like jobs |
| Telegram I/O | **apx-telegram** | configure bot, channels, send a message |
| Voice channel (TTS, speech) — *optional* | **apx-voice** | only if voice is being set up |
| Build a new MCP server — *internal/dev* | **apx-mcp-builder** | authoring a brand-new MCP from scratch |
| Author a new APX skill — *internal/dev* | **apx-skill-builder** | adding to APX itself |

> *internal/dev* sub-skills aren't pushed to IDE skill dirs by default. They live in the APX repo; install to IDE with `apx skills add <slug> --global`.

## Generic patterns (apply to every sub-skill)

### Verify commands before recommending

Don't invent APX subcommands. Confirm exact form with `apx --help` or `apx <command> --help` before telling another runtime to invoke APX. Avoid guessed aliases (e.g. `apx send-telegram` is not a thing — see apx-telegram).

### `APC_RESULT` contract

When you want APX to capture a structured value from an agent (any runtime), instruct the agent to print on its last meaningful line:

```
APC_RESULT: <one-line value>
```

APX's `extractApfResult()` parses that and stores it as the session's `result` field. Useful for automation, routines, CI.

### Tool permissions

```bash
apx permission show
apx permission set automatico   # total | automatico | permiso
```

`automatico` runs read/list/safe shell checks directly; asks before destructive shell, MCP, runtime, outbound, config, or filesystem mutation.

### Memory

Write memory only for durable, safe project facts. No raw transcripts or secrets.

```bash
apx memory <slug>                       # read agent's memory.md
apx memory <slug> --append "<fact>"     # append durable note
apx memory <slug> --replace < file.md   # replace entire memory from stdin
```

### Observe activity

```bash
apx messages tail                               # last 50 messages, all channels
apx messages chat --channel telegram -n 20      # readable chat view
apx messages tail --channel runtime --agent <slug> -n 20
```

## Anti-patterns

- Don't activate apx-sessions inside a request that's purely about `apx run` orchestration — use apx-runtime.
- Don't activate apx-mcp-builder unless the user is actually authoring a new MCP server (deep dev guide, not usage).
- Don't push state to `.apc/` that belongs in `~/.apx/projects/<id>/` (sessions, conversations, runtime logs).
