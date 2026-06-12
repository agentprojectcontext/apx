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

## APX runtime

Run a project agent through Claude Code:

```bash
apx run <agent> --runtime claude-code "task"
```

If the task needs Telegram, tell Claude Code the exact APX command:

```bash
apx telegram send "message"
```
