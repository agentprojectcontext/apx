---
name: apx
description: "APX CLI umbrella skill — what APX is, when to call it, and which sub-skill to use for each operation. Activate when the user mentions `apx`, asks to coordinate / run / delegate agents, brings up the APX daemon, or wants any APX-managed surface (sessions, MCPs, routines, tasks, telegram, projects, agents). Do NOT activate just because `.apc/` exists — that is handled by the apc-context skill. Triggers: 'apx', 'apx run', 'apx exec', 'apx daemon', 'coordinate agents', 'run an agent in codex', 'apx memory', 'apx help'."
homepage: https://github.com/agentprojectcontext/apx
---

# APX — Agent Project Context Runtime

APX is a daemon (`127.0.0.1:7430`, auto-starts on first call) that turns external coding CLIs (Claude Code, Codex, OpenCode, Aider, …) and configurable agents into a unified orchestration surface.

It reads APC project context from `.apc/` (committed) but keeps runtime state outside the repo under `~/.apx/projects/<project-id>/`. The super-agent has a default workspace at `~/.apx/projects/default` for system-level work.

---

## When to use APX (vs. spawning a subagent natively)

If you can spawn a subagent natively in the IDE you're in (Claude Code, Cursor, …) — **do that**. No APX needed.

Use APX when:
- The user explicitly asks for a specific external runtime ("run this in Codex", "delegate to OpenCode").
- You need to run an agent in a runtime different from the one you're in.
- You're orchestrating from outside any IDE (a script, Telegram bot, CI, routine).

---

## Sub-skill index — open the one that matches the task

| Topic | Sub-skill | When |
|-------|-----------|------|
| Delegate to an external coding CLI | **apx-runtime** | `apx run <agent> --runtime claude-code\|codex\|...` |
| List / read / resume / summarise / continue sessions across engines | **apx-sessions** | `apx session resume`, `apx sessions list`, "traer sesión de codex" |
| Use a registered MCP tool | **apx-mcp** | `apx mcp run`, "call MCP filesystem", "the MCP is failing" |
| Add / configure / use a project agent | **apx-agent** | "add an agent", "import from vault", per-agent model, agent memory |
| Register / list / configure a project | **apx-project** | "register this project", `apx project list`, per-project config |
| Per-project TODO list | **apx-task** | "anotame", "recordame que…", "qué tengo pendiente" |
| Scheduled / recurring agents | **apx-routine** | `apx routine add`, every-5m, cron-like jobs |
| Telegram I/O | **apx-telegram** | configure bot, channels, send a message |
| Voice channel (TTS, speech) — *optional* | **apx-voice** | only if voice is being set up |
| Build a new MCP server — *internal/dev* | **apx-mcp-builder** | when developing a brand-new MCP from scratch |
| Author a new APX skill — *internal/dev* | **apx-skill-builder** | when adding to APX itself |

> Sub-skills marked *internal/dev* are not pushed to IDE skill dirs by default. They live in the APX repo and are loaded by APX itself; install one to your IDE with `apx skills add <slug> --global` if you want it there.

---

## Generic patterns (apply to every sub-skill)

### Verify commands before recommending them

Do not invent APX subcommands. Confirm exact CLI form with `apx --help` or `apx <command> --help` before telling another runtime to invoke APX. Avoid guessed aliases (e.g. `apx send-telegram` is *not* a thing — see apx-telegram).

### `APC_RESULT` contract — structured return values

When you want APX to capture a structured value from an agent (any runtime), instruct the agent to print on its last meaningful line:

```
APC_RESULT: <one-line value>
```

APX's `extractApfResult()` parses that and stores it as the session's `result` field. Useful for automation, routines, and CI.

### Tool permissions

```bash
apx permission show
apx permission set automatico   # total | automatico | permiso
```

`automatico` runs read/list/safe shell checks directly and asks before destructive shell, MCP, runtime, outbound, config, or filesystem mutation actions.

### Memory

Write memory only for durable, safe project facts. Do not store raw transcripts or secrets.

```bash
apx memory <slug>                       # read agent's memory.md
apx memory <slug> --append "<fact>"     # append a durable note
apx memory <slug> --replace < file.md  # replace entire memory from stdin
```

### Observe activity

```bash
apx messages tail                               # last 50 messages, all channels
apx messages chat --channel telegram -n 20      # readable chat view
apx messages tail --channel runtime --agent <slug> -n 20
```

---

## Anti-patterns

- Don't activate APX-sessions inside a request that's purely about `apx run` orchestration — use apx-runtime.
- Don't activate apx-mcp-builder unless the user is actually authoring a new MCP server (it's a deep developer guide, not a usage guide).
- Don't push state to `.apc/` that belongs in `~/.apx/projects/<id>/` (sessions, conversations, runtime logs).
