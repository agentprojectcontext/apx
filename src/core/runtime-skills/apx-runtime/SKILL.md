---
name: apx-runtime
description: Delegate a task to an external coding CLI (claude-code, codex, opencode, aider, cursor-agent, gemini-cli, qwen-code, antigravity) via `apx run`. The APX agent is optional — pass-through runs the CLI as itself, `-a <agent>` wraps it in that agent's system prompt. Load when delegating to another AI tool, or when confused about the agent argument.
---

# apx-runtime

A "runtime" is an external AI coding CLI that APX invokes headlessly. APX spawns the CLI with the right flags, captures stdout (and the external session id when available), and stores run metadata as a session file under `~/.apx/projects/<apxId>/agents/<slug>/sessions/` (never committed). Some flows link to the engine's own transcript path.

## The agent is OPTIONAL — and it is not "the CLI's agent"

`apx run` delegates a prompt to an external CLI (claude-code, codex, …) that **has its own agency**. An APX agent does one thing here: its `buildAgentSystem()` output becomes the CLI's system prompt. It is a wrapper, not something Claude "uses."

- **No agent → pass-through.** `apx run --runtime claude-code "<prompt>"` hands the prompt to the CLI with **no APX system prompt** — Claude/Codex runs as itself. This is the right form when you just want to delegate a task to the tool. Don't invent an agent to do it.
- **With an agent → wrapped.** `apx run -a <agent> --runtime … "<prompt>"` when you want an APX persona/instructions (a project reviewer, a house style) to shape the run. Use it only when that wrapping is the point.

(`apx exec` is the sibling for APX's OWN in-process engine — there `-a <agent>` is likewise optional and defaults to the super-agent. `apx run` is specifically for spawning an external CLI.)

## Supported runtimes

| id | binary | Headless flag |
|---|---|---|
| `claude-code`   | `claude`        | `-p "<prompt>" --append-system-prompt "<sys>" --output-format json` |
| `codex`         | `codex`         | `exec "<prompt>" --sandbox workspace-write --skip-git-repo-check` |
| `opencode`      | `opencode`      | non-interactive mode |
| `aider`         | `aider`         | `--message "<prompt>" --yes-always --no-auto-commits` |
| `cursor-agent`  | `cursor-agent`  | headless print mode |
| `gemini-cli`    | `gemini`        | headless prompt mode |
| `qwen-code`     | `qwen`          | `--output-format text --approval-mode yolo "<prompt>"` |
| `antigravity`   | `agy`           | `agy -p "<prompt>"` (headless). Falls back to the `antigravity-ide` GUI, which can't return a result to stdout. |

`apx env detect` reports which are installed and reachable.

## Concrete CLI calls

```bash
apx env detect          # which runtimes are installed
apx env list            # alias

# Pass-through — just delegate to the CLI (no APX agent). The common case.
apx run --runtime claude-code "Review the diff in src/host/daemon/api/ for memory leaks"
apx run --runtime codex        "Refactor parseAgentFile to use a state machine"
apx run --runtime codex --timeout 300 "<prompt>"   # cap (seconds)
apx run --runtime codex -                          # prompt from stdin (large prompts)

# Wrapped — shape the run with an APX agent's system prompt.
apx run -a reviewer --runtime claude-code "Review this repo"
```

Behavior:
1. APX picks project from `--project` or cwd.
2. **If `-a <agent>` was given**, reads that agent's definition + memory + skills and builds a system prompt with `buildAgentSystem(project, agent, { invocation: "runtime", runtime: "<id>" })`. **No agent → no system prompt (pass-through).**
3. Spawns CLI with the right flags; cwd = project path.
4. Captures stdout. If runtime printed `APC_RESULT: <value>`, that's the structured result; else first 200 chars of stdout.
5. Writes a session file under `~/.apx/projects/<apxId>/agents/<slug>/sessions/` — `<slug>` is the agent, or the runtime id for a pass-through run.

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
apx sessions list --engine claude --project acme
apx session resume <id>                          # auto-detects engine
apx session resume <id> --continue               # spawn native CLI to keep going
apx session resume <id> --summary                # super-agent summary
apx session resume <id> --into apx:<slug>        # seed new APX session
apx session get <id> --any --full                # or --engine claude --tail 16k
```

See `apx-sessions` for full flag reference, collision handling, and daemon-vs-no-daemon matrix.

## Async relay — hand a coding session back to an orchestrator

Use this when the user wants to step away and be reached through an APX agent
(e.g. "avisame por Roby cuando termines", "estaré afk, que <agente> me avise").
The daemon **cannot** inject into a live interactive CLI process; the model is
**mailbox + resume**, not a live socket. Each round-trip is one headless resume.

**The loop.** (1) You finish and message the agent, ending your turn — you do
NOT block waiting. (2) The agent relays to the user. (3) The user replies to the
agent. (4) The agent wakes your session with that reply and captures what you do.

**The two primitives** (both already exist — no new plumbing):

```bash
# YOU → agent (outbound leg). Logs the A2A edge and runs the target agent once.
# Requires both slugs to exist in AGENTS.md. Put the reply-to ENVELOPE in the body.
apx send <your-agent-slug> roby "Done: auth refactor, tests green. Continue with integration or stop?
[apx-relay] runtime=claude-code session=<your-session-id> project=<abs-path>" --deliver

# agent → YOU (return leg). Wakes your idle session HEADLESS with the user's
# reply, resuming your transcript (full context), and captures your response.
apx session deliver <your-session-id> "Manu says: go ahead with integration, don't touch login"
```

**The envelope** is the only convention to standardise — it is the return
address, plain text in the message body:

```
[apx-relay] runtime=claude-code session=<uuid> project=<abs-path>
```

- `session` is your own transcript id. For Claude Code it is the run's session
  id (e.g. from your working/session path, or `apx sessions list --engine claude`).
- If you cannot determine your session id, write `session=unknown` and say so in
  the body — the agent then re-opens a fresh run instead of a true resume. Never
  omit the envelope silently: without it the agent has no way back to you.

**Roby's half** (lives in the agent's own prompt, not here): on receiving a
message with an `[apx-relay]` line, store the envelope, relay the request to the
user in its own voice (without the envelope), and when the user answers run
`apx session deliver <session> "<user's reply>"`. If `session=unknown` or the
deliver fails, tell the user — never swallow it.

`deliver` is claude-only today; other engines print an explicit "not supported
yet" and exit non-zero.

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
