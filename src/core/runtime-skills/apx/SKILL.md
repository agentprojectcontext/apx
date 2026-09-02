---
name: apx
description: "APX CLI umbrella — routes operations to sub-skills (sessions, MCPs, routines, tasks, commitments, telegram, projects, agents, agent vault, profiles, runtimes). Activate on `apx`, the APX daemon, or coordinating/running/delegating agents. Not for `.apc/` alone (use apc-context). Triggers: 'apx', 'apx run', 'apx daemon', 'coordinate agents'."
homepage: https://github.com/agentprojectcontext/apx
---

# APX — Agent Project Context Runtime

APX is a daemon (`127.0.0.1:7430`, auto-starts on first call) that turns external coding CLIs (Claude Code, Codex, OpenCode, Aider, …) and configurable agents into a unified orchestration surface. It reads APC project context from `.apc/` (committed) but keeps runtime state outside the repo under `~/.apx/projects/<project-id>/`. Super-agent has a default workspace at `~/.apx/projects/default` for system-level work.

## When to use APX (vs. native subagent)

If you can spawn a subagent natively in the current IDE (Claude Code, Cursor, …) — **do that**. No APX needed. Use APX when:
- User explicitly asks for a specific external runtime ("run this in Codex", "delegate to OpenCode").
- You need an agent in a runtime different from the one you're in.
- Orchestrating from outside any IDE (script, Telegram bot, CI, routine).

## Sub-skill index

| Topic | Sub-skill | When |
|-------|-----------|------|
| Delegate to external coding CLI | **apx-runtime** | `apx run <agent> --runtime claude-code\|codex\|...` |
| List/read/resume/summarise/continue sessions | **apx-sessions** | `apx session resume`, `apx sessions list`, "import a codex session" |
| Use a registered MCP tool | **apx-mcp** | `apx mcp tools`, `apx mcp run`, "call MCP filesystem", "MCP failing" |
| Connect/diagnose a service connector | **apx-integrations** | Asana/Calendar/GitHub/Obsidian, "not connected", "read-only calendar", Plugins tab |
| Add/configure/use a project agent | **apx-agent** | "add an agent", vault import, per-agent model, agent memory |
| Reusable agent templates (vault) | **apx-agency-agents** | "spawn Cody/Rocky/Tessa", "list agents", import a bundled default |
| Install/activate an agent profile (line of work) | **apx-profile** | "install the secretary", "go back to vanilla", "why does it message me" |
| Register/list/configure a project | **apx-project** | "register this project", `apx project list`, per-project config |
| Per-project TODO list | **apx-task** | "add a task", "remind me to…", "what's pending" |
| Promises made to a named person | **apx-commitment** | "I told X I would…", "le dije a X que…", "what do I owe X" |
| Scheduled/recurring agents | **apx-routine** | `apx routine add`, every-5m, cron-like jobs |
| Telegram I/O | **apx-telegram** | configure bot, channels, send a message |
| Voice channel (TTS, speech) — *optional* | **apx-voice** | only if voice is being set up |
| Build a new MCP server — *internal/dev* | **apx-mcp-builder** | authoring a brand-new MCP from scratch |
| Author a new APX skill — *internal/dev* | **apx-skill-builder** | adding to APX itself |

> *internal/dev* sub-skills aren't pushed to IDE skill dirs by default. They live in the APX repo; install to IDE with `apx skills add <slug> --global`.

## Talk to a peer (a2a) — an agent OR another coding CLI

When the user says "hablá con Roby" / "avisale a <agent>" / "pasale esto a <peer>",
message them on the **a2a channel** — NOT `apx exec` (that posts as the user):

```bash
apx send <you> <peer> "<message>" --deliver [--project <name>]
```

- `<you>`: your own identity as sender — a coding CLI passes its runtime name
  (`claude-code`, `codex`, `opencode`). It need NOT be a registered agent.
- `<peer>`: whoever answers. Either:
  - an **agent slug** from AGENTS.md — answered by that agent's model; or
  - a **runtime id** (`claude-code`, `codex`, `opencode`, `aider`, `cursor-agent`,
    `gemini-cli`, `qwen-code`, `antigravity`) — answered by spawning that CLI.
    This is how one coding IDE talks to another through APX.
- `:<thread>` opens a SECOND, independent exchange with the same peer —
  `apx send claude-code opencode:review "…"`. Separate history, separate
  session.
- An agent slug wins over a runtime of the same name. If a slug lives in several
  projects, `apx send` refuses and lists them — pass `--project`.
  `apx agent list --all` shows every agent with its project. A runtime peer is
  registered nowhere: it runs in the project you are standing in, in YOUR cwd.
- `--deliver` runs the peer now and returns its reply on stdout. The exchange
  shows in the web inbox as a "claude-code · opencode" group chat.

### Two kinds of exchange: talking, and working

By default an a2a message opens a **conversation**: the peer runs in its own
read-only mode (`claude --permission-mode plan`, `codex --sandbox read-only`,
`opencode --agent plan`). It can read anything and answer anything, but it
cannot change the codebase. That is deliberate — being messaged is not consent
to have your checkout edited.

`--code` opens a **coding session** instead: write access on, the peer is told to
do the work rather than describe it, and the exchange is mirrored into the **Code
module** (`/code`) so it shows up where every other coding session does — the
sender's messages as the user turns, the peer's replies as the assistant's.

`claude-code` and `codex` are never `--code` peers. They are the CLIs you drive
yourself, and a message must not also start them writing to the same checkout;
they answer read-only. Send the work to `opencode`, or use `apx run`.

```bash
apx send claude-code opencode "¿qué le falta a src/auth?" --deliver
apx send claude-code opencode "agregá el retry al fetch helper" --deliver --code
```

The peer runs in YOUR current directory, so `--code` edits the checkout you are
standing in, not the project record's path.

A coding session can take minutes. `--background` hands the turn back at once and
the reply lands on the thread when it finishes (`--timeout <s>` caps it; default
300s foreground, 3600s background):

```bash
apx send claude-code opencode "migrá los tests a node:test" --deliver --code --background
```

### The exchange keeps its own session

A runtime peer continues its OWN session between turns (`claude -p --resume`,
`codex exec resume`, `opencode run --session`). APX stores that id on the thread
and resumes it next message, so the peer is not handed the transcript again and
does not redo work it already did. `apx send` prints the session it used.

A peer that cannot keep a session still works — APX carries the thread history in
the prompt instead. Either way the conversation continues; sessions only make it
cheaper. When there is no session, `apx send` says why instead of leaving the
line blank.

Runtimes with native sessions today: `claude-code`, `codex`, `opencode`. The rest
(`aider`, `cursor-agent`, `gemini-cli`, `qwen-code`, `antigravity`) fall back to
the carried thread.

### Answering an a2a message

Your output IS the reply: APX logs it and hands it back to the sender. Do NOT
also run `apx send` with that same answer — it files the exchange twice. Use
`apx send` only to open a NEW exchange: a follow-up once this turn is over, or a
message to somebody else. Every a2a message carries its own return address.

- The agent decides whether/how to tell the user on its own channel (respecting
  quiet-hours) — you don't `apx telegram send` the user yourself.
- `--severity blocker|status|fyi` tags urgency when relaying up to Roby: a
  `blocker` alerts the owner **in the act** (Roby pings, crossing quiet-hours);
  `status`/`fyi` ride the end-of-day digest and never interrupt.

## Generic patterns (apply to every sub-skill)

### Verify commands before recommending

Don't invent APX subcommands. Confirm exact form with `apx --help` or `apx <command> --help` before telling another runtime to invoke APX. Avoid guessed aliases (e.g. `apx send-telegram` is not a thing — see apx-telegram).

### `APC_RESULT` contract

When you want APX to capture a structured value from an agent (any runtime), instruct the agent to print on its last meaningful line:

```
APC_RESULT: <one-line value>
```

APX's `extractApfResult()` parses that and stores it as the session's `result` field. Useful for automation, routines, CI.

### Tool permissions

```bash
apx permission show
apx permission set automatico   # total | automatico | permiso
```

`automatico` runs read/list/safe shell checks directly; asks before destructive shell, MCP, runtime, outbound, config, or filesystem mutation.

### Memory

Write memory only for durable, safe project facts. No raw transcripts or secrets.

```bash
apx memory <slug>                       # read agent's memory.md
apx memory <slug> --append "<fact>"     # append durable note
apx memory <slug> --replace < file.md   # replace entire memory from stdin
```

### Observe activity

```bash
apx messages tail                               # last 50 messages, all channels
apx messages chat --channel telegram -n 20      # readable chat view
apx messages tail --channel runtime --agent <slug> -n 20
```

## Anti-patterns

- Don't activate apx-sessions inside a request that's purely about `apx run` orchestration — use apx-runtime.
- Don't activate apx-mcp-builder unless the user is actually authoring a new MCP server (deep dev guide, not usage).
- Don't push state to `.apc/` that belongs in `~/.apx/projects/<id>/` (sessions, conversations, runtime logs).
