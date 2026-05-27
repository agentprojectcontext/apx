---
name: apx-runtime
description: How to call external coding CLIs (claude-code, codex, opencode, aider, cursor-agent, gemini-cli, qwen-code) from APX. Load when the user wants to delegate a task to another AI tool — APX builds the system prompt, spawns the CLI, captures the result.
---

# apx-runtime

A "runtime" in APX is an external AI coding CLI that APX can invoke headlessly. APX builds the agent's system prompt, spawns the CLI with the right flags, captures the stdout (and the external tool's session id when available), and stores the run as an APC session under `<repo>/.apc/agents/<slug>/sessions/`.

## Supported runtimes

| id | binary | Headless flag |
|---|---|---|
| `claude-code`   | `claude`        | `-p "<prompt>" --append-system-prompt "<sys>" --output-format json` |
| `codex`         | `codex`         | `exec "<prompt>"` (works outside git repos) |
| `opencode`      | `opencode`      | non-interactive mode |
| `aider`         | `aider`         | `--message "<prompt>" --no-stream` |
| `cursor-agent`  | `cursor-agent`  | headless print mode |
| `gemini-cli`    | `gemini`        | headless prompt mode |
| `qwen-code`     | `qwen-code`     | passes system prompt separately |

`apx env detect` reports which are installed and reachable.

## Concrete CLI calls

```bash
# What's available on this machine
apx env detect
apx runtime list

# Run an agent through an external CLI
apx run reviewer --runtime claude-code "Review the diff in src/host/daemon/api/ for memory leaks"
apx run scratch  --runtime codex       "Refactor parseAgentsMd to use a state machine"
apx run scratch  --runtime opencode    "<prompt>"
```

Behavior:
1. APX picks the project from `--project` or cwd.
2. Reads the agent's `AGENT.md` + memory + skills, builds the system prompt with `buildAgentSystem({ invocation: "runtime", runtime: "<id>" })`.
3. Spawns the CLI with the right flags. cwd = project path.
4. Captures stdout. If the runtime printed `APC_RESULT: <value>`, that's the structured result; else the first 200 chars of stdout.
5. Writes `<repo>/.apc/agents/<slug>/sessions/<YYYY-MM-DD>-<id>.md` with frontmatter linking back to the external tool's own session file (when available).

## Resuming an external session

After a `apx run`, the resulting APC session file references the external transcript:

```yaml
# .apc/agents/reviewer/sessions/2026-05-27-claude-code-abc123.md
---
external_session_path: /Users/.../.claude/projects/<...>/sessions/abc123.jsonl
runtime: claude-code
session_id: abc123
---
```

To resume:

```bash
apx sessions list --engine claude --project iacrmar
# → date, session id, title, exact resume command (e.g. `claude -p --resume abc123 "..."`)
```

`apx sessions list` reads external engines' own session stores so you can pick up an old session without opening their interactive picker.

## APC_RESULT contract

When you want APX to capture a structured value from the external runtime, instruct the runtime via the prompt to print on its last line:

```
APC_RESULT: <one-line value>
```

APX `extractApfResult()` parses that and stores it as the session's `result` field. Useful for return values from automation.

## Anti-examples

```bash
# DON'T expect `apx run` to be interactive. It's headless.
# For interactive, just invoke the CLI directly (e.g. `claude` for Claude Code).

# DON'T pass huge prompts via the command line (shell args have limits).
# For prompts > ~10KB, use a stdin-friendly route or write a temp file and reference it.

# DON'T forget that each runtime has its own model selection.
# APX passes the system prompt and the user prompt; it does NOT impose a model on
# the external CLI. The user's external CLI config (e.g. Claude Code's CLAUDE.md
# defaults) wins.
```

## When to use which

| You want | Pick |
|---|---|
| Pair-program with file edits and shell | `claude-code` if the user has Claude Code, else `codex` |
| Lightweight LLM run with no tools | `apx exec <agent> "<prompt>"` (no runtime needed) |
| The super-agent to call other agents | `call_agent` tool (in-process, no spawn) |
| Run something that needs persisted state across days | `apx run` with `claude-code` or `codex` (their sessions persist) |

## Don't

- Don't run untrusted prompts in `--runtime` of a CLI with broad tool permissions on the user's machine. The CLI may take file write or shell actions.
- Don't expect APX to track tool calls inside the external CLI's transcript. APX captures stdout and the external session path — that's it. Inspect the external transcript directly for tool-level audit.
- Don't pick a runtime the user doesn't have installed; `apx env detect` first if unsure.
