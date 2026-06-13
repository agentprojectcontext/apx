---
name: apx
description: >-
  APX CLI — local daemon that orchestrates agents, sessions, MCPs, and channels across CLIs.
  Use `apx exec "prompt"` for the local super-agent, or `apx run <agent> --runtime <claude-code|codex|opencode|aider|cursor-agent|gemini-cli|qwen-code> "prompt"` to hand the task to another CLI.
  Activate on: 'apx', 'apx exec', 'apx run', 'apx daemon', 'ask codex/claude/opencode/gemini to …', 'have <runtime> do …', 'delegate to another runtime', 'run this in <runtime>', 'route this task to <runtime>'.
homepage: https://github.com/agentprojectcontext/apx
---

# APX — Agent Project Context Runtime (engine view)

APX is a local daemon (`127.0.0.1:7430`, auto-starts on first call) that turns external coding CLIs (Claude Code, Codex, OpenCode, …) and configurable agents into a unified orchestration surface.

This is the **engine-side** skill: a slim reference for runtimes invoked by APX. The full umbrella skill (with all sub-skills) lives in APX itself.

---

## When you (as an engine) interact with APX

- You were spawned by `apx run` — your CWD is a project and APX is reachable on `127.0.0.1:7430`.
- The user asks you to call APX from inside your session ("send a telegram via apx", "list apx sessions").
- You're inside an `.apc/` project and want to consult APX-managed state.

If you can do the task natively (you're an IDE/CLI with your own tools), prefer that. Only shell out to `apx` when the task is APX-specific.

---

## Verify before recommending

Do not invent subcommands. Confirm exact form with:

```bash
apx --help
apx <command> --help
```

---

## Core commands you'll actually use

```bash
# Project + daemon
apx status                      # daemon health
apx project list                # registered projects
apx project current             # which project resolves from CWD

# Sessions (cross-engine)
apx sessions list --engine <claude|codex|opencode> --project <name>
apx sessions list --dir <path>

# MCPs — see the apx-mcp skill for the full guide
apx mcp list
apx mcp run <name> <tool> '{"...":"..."}'

# Memory (curated, durable facts only)
apx memory <agent-slug>
apx memory <agent-slug> --append "<fact>"

# Observe activity
apx messages tail
apx messages chat --channel <name> -n 20
```

---

## APC_RESULT contract

When APX captures a structured value from your run, end with:

```
APC_RESULT: <one-line value>
```

`extractApfResult()` parses that and stores it as the session's `result`. Use it for routines, CI, automation.

---

## Anti-patterns

- Don't write raw transcripts, sessions, or secrets into `.apc/` — they belong in `~/.apx/projects/<id>/`.
- Don't guess subcommands. If `apx --help` doesn't show it, it doesn't exist.
- Don't activate this skill for pure `.apc/` reading — that's [[apc-context]].
- For MCP details (scopes, secrets, add/remove), open [[apx-mcp]] instead of guessing flags here.
