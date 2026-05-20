---
name: apx
description: "APX CLI skill. Activate when: user asks to run or coordinate agents, use MCP tools from .apc/mcps.json, install agents from a team workspace, or explicitly mentions apx commands. Do NOT activate just because .apc/ exists — that is handled by the apc-context skill. Activate on: 'apx run', 'apx exec', 'run an agent', 'coordinate agents', 'MCP not working', 'install agent', 'team agents', 'apx memory', 'daemon'."
homepage: https://github.com/agentprojectcontext/apx
---

# APX — Agent Project Context Runtime

The daemon runs on `127.0.0.1:7430` and auto-starts on first `apx` call.

APX reads APC project context from `.apc/`, but APX runtime state belongs outside the repository
under `~/.apx/projects/<project-id>/`.

The APX super-agent has an always-available default workspace at `~/.apx/projects/default`.
When no project is named, system-level work belongs there.

---

## Coordinate with other agents

**First: can you spawn a subagent natively in this IDE?**

If yes — do that. No APX needed. Claude Code, Cursor, and other IDEs can spawn subagents directly using your current context.

Use `apx run` only when:
- The user explicitly asks to run the agent in a specific external runtime ("run this in Codex", "run the QA agent outside this session")
- You need to run an agent in a runtime different from the one you're in
- You're orchestrating from outside any IDE (e.g. a script, Telegram bot, CI)

```bash
# Run agent in an external runtime — full isolated session
apx run <slug> --runtime claude-code "<prompt>"
apx run <slug> --runtime codex        "<prompt>"
apx run <slug> --runtime opencode     "<prompt>"
apx run <slug> --runtime aider        "<prompt>"
apx run <slug> --runtime cursor-agent "<prompt>"
apx run <slug> --runtime gemini-cli   "<prompt>"
apx run <slug> --runtime qwen-code    "<prompt>"

# Example: run the qa agent in codex with a specific task
apx run qa --runtime codex "run the full test suite and report failures"
```

The output is the agent's full stdout. If it printed `APC_RESULT: <value>`, that value is captured as structured output.

```bash
# Quick one-shot LLM call (no external CLI needed, uses ~/.apx/config.json engine key)
apx exec <slug> "<prompt>"
```

## Command accuracy

Do not invent APX subcommands. Before telling another runtime to call APX, verify the exact CLI
form with `apx --help` or `apx <command> --help`.

Known Telegram form:

```bash
apx telegram status
apx telegram send "message"
apx telegram send "message" --chat 123456
```

Do not use guessed aliases such as `apx send-telegram` or `apx telegram "message"` unless current
`apx --help` shows that exact form.

## MCP tools

MCPs declared in `.apc/mcps.json` are proxied through the APX daemon. Use `apx mcp` only for MCPs registered there — not for MCPs that are already running locally in your IDE session.

```bash
apx mcp list                            # MCPs registered in .apc/mcps.json
apx mcp tools <server>                  # tools a server exposes
apx mcp run   <server> <tool> '<json>'  # call a tool

# Example:
apx mcp tools filesystem
apx mcp run filesystem read_file '{"path": "README.md"}'
```

## Memory

Write memory only for durable, safe project facts. Do not store raw transcripts or secrets.

```bash
apx memory <slug>                       # read agent's memory.md
apx memory <slug> --append "<fact>"     # append a durable note
apx memory <slug> --replace < file.md  # replace entire memory from stdin
```

## Sessions

Sessions are APX runtime state. They do not belong in `.apc/`.

```bash
apx session new <slug> --title "What you did"   # create APX local session file
apx session list <slug>                          # list sessions
apx session check                                # exits 1 if session already active
```

### List sessions of other AI engines

`apx sessions list` lists sessions of external AI engines (Claude Code, Codex)
without opening their interactive pickers. It resolves the project directory
from a registered APX project (`--project`) or an explicit path (`--dir`).

```bash
apx sessions list                                       # APX engine projects (default)
apx sessions list --engine claude                       # Claude Code project folders
apx sessions list --engine claude --project iacrmar     # sessions of a registered project
apx sessions list --engine claude --dir /path/to/repo   # sessions of any directory
apx sessions list --engine codex  --dir /path/to/repo   # Codex sessions
```

Output prints date + session id + title, newest first, plus the exact resume command.

**Resume a Claude Code session** (run from the project directory):

```bash
claude --continue                       # resume the most recent session
claude -p --resume <session-id> "..."   # resume a specific session, always with -p (print mode)
```

## Observe activity

```bash
apx messages tail                               # last 50 messages, all channels
apx messages chat --channel telegram -n 20      # chat view with user/agent/system type
apx messages tail --channel runtime             # only agent invocations
apx messages tail --agent <slug> -n 20
```

Message rows expose `type` (`user`, `agent`, `tool`, `system`) and `actor_id`; use `messages chat`
when you need a readable transcript.

## APX tool permissions

```bash
apx permission show
apx permission set automatico   # total | automatico | permiso
```

`automatico` runs read/list/safe shell checks directly and asks before destructive shell, MCP,
runtime, outbound, config, or filesystem mutation actions.

## Routines

```bash
apx routine list
apx routine get <name>
apx routine history <name>
apx routine add clima --kind super_agent --schedule every:5m \
  --permission-mode total \
  --spec '{"prompt":"Check weather and send Telegram update."}'
```

Routine kinds: `heartbeat`, `exec_agent`, `super_agent`, `telegram`, `shell`.

## APC_RESULT

Print on the last meaningful line of your output so the invoker captures it:
```
APC_RESULT: <one-line summary or value>
```
