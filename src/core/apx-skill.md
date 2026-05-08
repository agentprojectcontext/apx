# APX — Agent Project Context Runtime

The daemon runs on `127.0.0.1:7430` and auto-starts on first `apx` call.

APX reads APC project context from `.apc/`, but APX runtime state belongs outside the repository
under `~/.apx/projects/<project-id>/`.

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

# Example: run the qa agent in codex with a specific task
apx run qa --runtime codex "run the full test suite and report failures"
```

The output is the agent's full stdout. If it printed `APC_RESULT: <value>`, that value is captured as structured output.

```bash
# Quick one-shot LLM call (no external CLI needed, uses ~/.apx/config.json engine key)
apx exec <slug> "<prompt>"
```

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

## Observe activity

```bash
apx messages tail                               # last 50 messages, all channels
apx messages tail --channel runtime             # only agent invocations
apx messages tail --agent <slug> -n 20
```

## APC_RESULT

Print on the last meaningful line of your output so the invoker captures it:
```
APC_RESULT: <one-line summary or value>
```
