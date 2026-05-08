# APX — Agent Project Framework

This project uses **APX**. The daemon runs on `127.0.0.1:7430` and auto-starts on first `apx` call.
Your current session, project, and agent are already injected above this block — refer to them.

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

## Memory — durable, persists between sessions

```bash
apx memory <slug>                       # read agent's memory.md
apx memory <slug> --append "<fact>"     # append a durable note (non-destructive)
apx memory <slug> --replace < file.md  # replace entire memory from stdin
```

## MCP tools

```bash
apx mcp list                            # registered MCP servers declared in .apc/mcps.json
apx mcp tools <server>                  # list tools a server exposes
apx mcp run   <server> <tool> '<json>'  # call a tool directly
```

MCP servers declared in `.apc/mcps.json` only work when APX daemon is running.
If a tool call fails or MCPs aren't responding, check: `apx --version` to confirm APX is active.

## Observe activity

```bash
apx messages tail                       # last 50 messages, all channels
apx messages tail --channel runtime     # only agent invocations (in/out)
apx messages tail --agent <slug> -n 20
apx session list  <slug>                # sessions for a specific agent
```

## Anti-collision guard

Before starting a long task, prevent duplicate runs:
```bash
apx session check    # exits 1 if a session is already active for this agent
```

## APC_RESULT — signal your return value

Print this on the last meaningful line of your output:
```
APC_RESULT: <one-line summary or value>
```
The invoker (`apx run`, super-agent, Telegram bot) captures it as structured output.
