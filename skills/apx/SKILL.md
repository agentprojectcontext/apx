---
name: apx
description: "APX CLI skill. Activate ONLY when the user asks about running agents, coordinating between agents, or explicitly uses apx commands. Provides: apx run, apx exec, apx memory, apx mcp, apx session, apx messages tail. Do NOT activate just because .apc/ exists — project context is handled by the apc-context skill. Activate on: 'apx run', 'apx exec', 'run an agent', 'coordinate agents', 'multi-agent', 'apx memory', 'apx mcp', 'daemon'."
homepage: https://github.com/agentprojectcontext/apx
---

# APX — Agent Project Context Runtime

This project uses **APX**. The daemon runs on `127.0.0.1:7430` and auto-starts on first `apx` call.
Your current session, project, and agent are already injected above this block — refer to them.

APX runtime state belongs outside `.apc/`, under `~/.apx/projects/<project-id>/`.

---

## Discover the project

```bash
apx agent list                          # agents in AGENTS.md + their roles/models
apx mcp list                            # MCP servers available to this project
```

## Coordinate with other agents

```bash
# Full external session (best for complex, multi-step tasks)
apx run <slug> --runtime claude-code "<prompt>"
apx run <slug> --runtime codex        "<prompt>"

# Quick one-shot LLM call (requires engine API key in ~/.apx/config.json)
apx exec <slug> "<prompt>"
```

The output of `apx run` / `apx exec` is the agent's full stdout.
If the agent printed `APC_RESULT: <value>`, that value is also captured as structured output.

## Memory — durable, safe facts

```bash
apx memory <slug>                       # read agent's memory.md
apx memory <slug> --append "<fact>"     # append a durable note (non-destructive)
apx memory <slug> --replace < file.md  # replace entire memory from stdin
```

Write to memory only when you discover safe project context the agent should know on future runs.

## Observe activity

```bash
apx messages tail                       # last 50 messages, all channels
apx messages tail --channel runtime     # only agent invocations (in/out)
apx messages tail --channel telegram    # Telegram conversation history
apx messages tail --agent <slug> -n 20
apx session list  <slug>                # sessions for a specific agent
```

## MCP tools

```bash
apx mcp list                            # registered MCP servers
apx mcp tools <server>                  # list tools a server exposes
apx mcp run   <server> <tool> '<json>'  # call a tool directly
```

## Anti-collision guard

Before starting a long task, prevent duplicate runs:
```bash
apx session check    # exits 1 if a session is already active for this agent
```

## APC_RESULT — how to signal your return value

Print this on the last meaningful line of your output:
```
APC_RESULT: <one-line summary or value>
```
The invoker (`apx run`, super-agent, Telegram bot) captures it as structured output.
Keep it factual and short. It becomes the session result stored in APX local runtime state, not
inside `.apc/`.
