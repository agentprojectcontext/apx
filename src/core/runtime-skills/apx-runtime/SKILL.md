---
name: apx-runtime
description: Delegate a task to an external coding CLI (claude-code, codex, opencode, aider, cursor-agent, gemini-cli, qwen-code) via `apx run`. APX builds the system prompt, spawns the CLI, captures the result. Load when delegating to another AI tool.
---

# apx-runtime

A "runtime" is an external AI coding CLI that APX invokes headlessly. APX builds the agent's system prompt, spawns the CLI with the right flags, captures stdout (and the external session id when available), and stores run metadata as a session file under `~/.apx/projects/<apxId>/agents/<slug>/sessions/` (never committed). Some flows link to the engine's own transcript path.

## Supported runtimes

| id | binary | Headless flag |
|---|---|---|
| `claude-code`   | `claude`        | `-p "<prompt>" --append-system-prompt "<sys>" --output-format json` |
| `codex`         | `codex`         | `exec "<prompt>"` (works outside git repos) |
| `opencode`      | `opencode`      | non-interactive mode |
| `aider`         | `aider`         | `--message "<prompt>" --no-stream` |
| `cursor-agent`  | `cursor-agent`  | headless print mode |
| `gemini-cli`    | `gemini`        | headless prompt mode |
| `qwen-code`     | `qwen-code`     | system prompt passed separately |

`apx env detect` reports which are installed and reachable.

## Concrete CLI calls

```bash
apx env detect          # which runtimes are installed
apx env list            # alias

apx run reviewer --runtime claude-code "Review the diff in src/host/daemon/api/ for memory leaks"
apx run scratch  --runtime codex       "Refactor parseAgentsMd to use a state machine"
apx run scratch  --runtime opencode    "<prompt>"
apx run scratch  --runtime codex --timeout 300 "<prompt>"   # cap (seconds)
apx run scratch  --runtime codex -      # prompt from stdin (large prompts)
```

Behavior:
1. APX picks project from `--project` or cwd.
2. Reads agent's `AGENT.md` + memory + skills; builds system prompt with `buildAgentSystem({ invocation: "runtime", runtime: "<id>" })`.
3. Spawns CLI with the right flags; cwd = project path.
4. Captures stdout. If runtime printed `APC_RESULT: <value>`, that's the structured result; else first 200 chars of stdout.
5. Writes `~/.apx/projects/<apxId>/agents/<slug>/sessions/<YYYY-MM-DD>-<id>.md` with frontmatter linking back to the external transcript when available.

## Resuming an external session

The session file references the external transcript:

```yaml
# ~/.apx/projects/<apxId>/agents/reviewer/sessions/2026-05-27-claude-code-abc123.md
---
external_session_path: /Users/.../.claude/projects/<...>/abc123.jsonl
runtime: claude-code
session_id: abc123
---
```

Full resume/get/continue/summarise lives in the **`apx-sessions`** skill. Quick paths:

```bash
apx sessions list --engine claude --project iacrmar
apx session resume <id>                          # auto-detects engine
apx session resume <id> --continue               # spawn native CLI to keep going
apx session resume <id> --summary                # super-agent summary
apx session resume <id> --into apx:<slug>        # seed new APX session
apx session get <id> --any --full                # or --engine claude --tail 16k
```

See `apx-sessions` for full flag reference, collision handling, and daemon-vs-no-daemon matrix.

## APC_RESULT contract

To capture a structured value from the external runtime, instruct it via the prompt to print on its last line:

```
APC_RESULT: <one-line value>
```

`extractApfResult()` parses that into the session's `result` field. Useful for automation return values.

## Anti-examples

- DON'T expect `apx run` to be interactive — it's headless. For interactive, invoke the CLI directly (e.g. `claude`).
- DON'T pass huge prompts via command line (shell arg limits). For >~10KB, use stdin (`-`) or a temp file.
- DON'T expect APX to impose a model on the external CLI. APX passes system + user prompt only; the external CLI's own config wins.

## When to use which

| You want | Pick |
|---|---|
| Pair-program with file edits + shell | `claude-code` if installed, else `codex` |
| Lightweight LLM run, no tools | `apx exec <agent> "<prompt>"` (no runtime needed) |
| Super-agent to call other agents | `call_agent` tool (in-process, no spawn) |
| Persisted state across days | `apx run` with `claude-code` or `codex` (their sessions persist) |

## Don't

- Run untrusted prompts in a `--runtime` CLI with broad tool permissions — the CLI may take file/shell actions.
- Expect APX to track tool calls inside the external transcript. APX captures stdout + external session path only; inspect the external transcript for tool-level audit.
- Pick a runtime the user doesn't have installed; `apx env detect` first.
