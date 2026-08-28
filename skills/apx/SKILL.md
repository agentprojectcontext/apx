---
name: apx
description: Orchestrates agents, sessions, routines, and channels through the APX CLI and local daemon — run the super-agent locally or delegate a task to another coding CLI (Claude Code, Codex, OpenCode, Aider, Cursor, Gemini, Qwen). Triggers: 'apx', 'apx exec', 'apx run', 'apx daemon', 'apx routine', 'delegate to a runtime'.
homepage: https://github.com/agentprojectcontext/apx
---

# APX — Agent Project Context Runtime (engine view)

APX is a local daemon (`127.0.0.1:7430`, auto-starts on first call) that turns external coding CLIs (Claude Code, Codex, OpenCode, …) and configurable agents into a unified orchestration surface.

This is the **engine-side** skill: a slim reference for runtimes invoked by APX. The full umbrella skill (with all sub-skills) lives in APX itself.

---

## When you (as an engine) interact with APX

- You were spawned by `apx run`, or the user launched you by hand inside an APX project — either way APX is reachable on `127.0.0.1:7430`.
- The user asks you to call APX from inside your session ("send a telegram via apx", "list apx sessions").
- The user asks you to reach an APX agent — "hablá con Roby", "preguntale a <agente>", "que <agente> me avise cuando termines" — see **Talking to an APX agent (a2a relay)** below.
- You're inside an `.apc/` project and want to consult APX-managed state.

If you can do the task natively (you're an IDE/CLI with your own tools), prefer that. Only shell out to `apx` when the task is APX-specific. For anything MCP-related, use the [[apx-mcp]] skill — it's the MCP entry point for agents.

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
# One-shot super-agent call
apx exec "prompt"               # default 'cli' channel
apx exec --code "prompt"        # 'code' channel: coding prompt + git/code tools.
                                # Runs in a persistent code session (visible at
                                # /m/code); the session id is printed on stderr.
apx exec --code --session <id> "…"   # continue that session instead of a new one
apx exec --channel <name> "…"   # explicit channel (cli, code, api, …)

# Project + daemon
apx status                      # daemon health
apx project list                # registered projects
apx project current             # which project resolves from CWD

# Sessions (cross-engine)
apx sessions list --engine <claude|codex|opencode> --project <name>
apx sessions list --dir <path>

# Memory (curated, durable facts only)
apx memory <agent-slug>
apx memory <agent-slug> --append "<fact>"

# Observe activity
apx messages tail
apx messages chat --channel <name> -n 20

# Protocol bridges (spawned by clients, not run interactively)
apx acp                         # Agent Client Protocol server on stdio (Zed, JetBrains, ...)
```

---

## Talking to an APX agent (a2a relay)

When the user wants to reach an APX agent — "hablá con Roby", "preguntale a
<agente>", "que <agente> me avise cuando termines" — you talk to the agent on the
**agent-to-agent (a2a) channel**, not to the user. You send, the agent runs and
returns its reply on stdout; if you identified your session, the agent (or the
user through it) can later answer back *into this session*.

Send with `apx send` on the a2a channel:

```bash
apx send <you> <agent> "<message>  engine=claude session=<your-session-id>" --deliver --project <name>
```

- `<you>` — your sender identity; for a coding CLI use the engine name (`claude`,
  `codex`, …). It does NOT need to be a registered agent.
- `<agent>` — recipient slug. `--project` is optional unless the slug exists in
  several projects (then `apx send` lists them). `apx agent list --all` shows
  every agent and its project.
- `--deliver` — runs the recipient now and returns its reply on stdout. The agent
  decides whether/how to tell the user on its own channel (respecting quiet-hours).
- **The a2a thread keeps history** — each `--deliver` sees the earlier turns of
  this pair, so a back-and-forth is a real conversation (you don't have to restate
  context every message). It shows in the web inbox as a "you · agent" group chat.
- Do NOT use `apx exec` for this (it posts on the USER channel — the agent sees it
  as if the user typed it), and do NOT `apx telegram send` the user directly (that
  bypasses the agent and the relay never closes).
- The super-agent itself is not an a2a target — reach it with `apx exec "<msg>"`.

**Identify your session so the answer can return.** Put `engine=claude
session=<id>` in the message body. Get your id from your own transcript path (most
reliable), or `apx sessions list --engine claude --dir "$PWD"`.

> ⚠️ With several Claude sessions open in the same repo, "most recent" is NOT
> reliably you — prefer your transcript path. If you can't be sure, say so in the
> message instead of guessing; the agent then starts fresh rather than resuming
> the wrong (possibly stale) session.

The agent answers back by resuming your session headless — **it** runs this, not
you:

```bash
apx session resume <session-id> --continue --msg "<the reply>"
```

That injects one message into your transcript with full context and captures your
response on stdout. (Resume-with-`--msg` is Claude-only for now.) The agent side
of this convention lives in the **apx-runtime** skill.

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
