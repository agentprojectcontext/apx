---
scope: internal
name: claude-code
description: "Activate ONLY when the user explicitly mentions Claude Code, Claude CLI, claude command, Anthropic Claude Code, installing Claude Code, using Claude Code, or APX runtime claude-code. Do not activate for generic Claude model discussion."
homepage: https://docs.anthropic.com/en/docs/claude-code
---
# Claude Code CLI

Use this skill only for Claude Code CLI install, auth, usage, or APX runtime dispatch.

## Verify before acting

Check the local CLI first:

```bash
claude --version
claude --help
```

Do not invent flags. If a command is uncertain, inspect help for the exact subcommand before
running it.

## Install

Common install/update path:

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

Claude Code also exposes:

```bash
claude install
claude update
claude auth
```

Use `claude --help` to confirm current syntax.

## Non-interactive use

Prefer headless print mode:

```bash
claude -p "task" --output-format json
claude -p "task" --append-system-prompt "system instructions" --output-format json
```

For high-trust automation in an already sandboxed environment:

```bash
claude -p "task" --permission-mode bypassPermissions --output-format json
```

## List and resume sessions

Claude Code has no `--list`; `--resume` is always an interactive picker. To list
sessions non-interactively, use APX:

```bash
apx sessions list --engine claude --project <name>   # registered APX project
apx sessions list --engine claude --dir <path>       # any directory
```

This prints each session's id and title. To resume one (run from the project directory):

```bash
claude --continue                       # most recent session
claude -p --resume <session-id> "..."   # specific session, always with -p (print mode)
```

## Talking to an APX agent and being answered back (async relay)

When the user wants to step away and be reached through an APX agent — "avisame
por Roby cuando termines", "estaré afk, que <agente> me avise" — you hand off to
the agent and end your turn (you can't block waiting; the daemon can't push into
your live process). The agent reaches the user, the user answers, and the answer
comes back into THIS session by resuming it. The full convention is one line:

**Identify your session when you message the agent.** Include your engine and
session id in the message body so the agent knows who to answer:

```
engine=claude session=<your-session-id>
```

Find your own session id with `apx sessions list --engine claude --dir "$PWD"`
(most recent = current), or from your session/transcript path. If you can't
determine it, say so in the message rather than guessing — the agent then starts
a fresh run instead of resuming, and the user knows context won't carry.

Send the hand-off **to the agent**, not to the user — the agent is what relays,
respects quiet-hours, and can reply back. Do NOT `apx telegram send` the user
directly (that bypasses the agent and the relay does not close), and do NOT use
`apx exec` for this — `apx exec` posts on the USER channel, so the agent sees the
message as if the user typed it. Use the **a2a channel** (`apx send`), which
records the message as agent-to-agent with you as the sender:

```bash
apx send <you> <agent> "Done: <what you did>. <question>? engine=claude session=<id>" --deliver --project <name>
```

- `<you>` is your own identity as the sender — for a coding CLI use the engine
  name (`claude`, `codex`, …). It does NOT need to be a registered agent.
- `<agent>` is the recipient slug. If it lives in one project, `--project` is
  optional; if the slug exists in several projects (two `rocky`s), `apx send`
  refuses and lists them — pass `--project <name>`. To see every agent and its
  project, run `apx agent list --all`.
- `--deliver` runs the recipient now and returns its reply on stdout; the agent
  decides whether/how to tell the user on its own channel (respecting quiet-hours).
- The super-agent itself is not an a2a target yet — reach it with `apx exec "<msg>"`
  (no `-a`). `apx agent list --all` shows which agents are project agents.

The agent answers back by resuming this session headless:

```bash
apx session resume <session-id> --continue --msg "<the user's reply>"
```

That injects one message into your transcript (full context intact) and captures
your response on stdout. You don't run this yourself — the agent does; you just
need to have identified your session. See the **apx-runtime** skill for the agent
side.

## APX runtime

Run a project agent through Claude Code:

```bash
apx run <agent> --runtime claude-code "task"
```

If the task needs Telegram, tell Claude Code the exact APX command:

```bash
apx telegram send "message"
```
