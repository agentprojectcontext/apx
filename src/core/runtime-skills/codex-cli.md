---
name: codex-cli
description: "Activate ONLY when the user explicitly mentions Codex CLI, OpenAI Codex, @openai/codex, codex command, codex exec, installing Codex, using Codex, ~/.codex, or APX runtime codex."
homepage: https://developers.openai.com/codex
---
# Codex CLI

Use this skill only for Codex CLI install, auth, usage, or APX runtime dispatch.

## Verify before acting

Check local CLI and exact flags first:

```bash
codex --version
codex --help
codex exec --help
```

Do not invent flags. Current Codex CLI may reject older flags such as `--approval-mode` or
`--full-auto`.

## Install

Common install/update path:

```bash
npm install -g @openai/codex
codex --version
```

Codex also exposes:

```bash
codex login
codex update
```

Auth check:

```bash
test -f ~/.codex/auth.json && echo "codex auth present"
```

## Non-interactive use

Use `exec`, not interactive TUI, for automation:

```bash
codex exec --sandbox workspace-write --skip-git-repo-check "task"
```

Useful options:

```bash
codex exec --sandbox workspace-write --skip-git-repo-check --output-last-message /tmp/codex-last.txt "task"
codex exec --json --sandbox workspace-write --skip-git-repo-check "task"
```

`--skip-git-repo-check` matters for APX default runtime dirs such as `~/.apx/projects/default`,
which may not be Git repositories.

## List and resume sessions

List Codex sessions for a project non-interactively with APX:

```bash
apx sessions list --engine codex --project <name>   # registered APX project
apx sessions list --engine codex --dir <path>       # any directory
```

Resume a session:

```bash
codex resume <session-id>                  # interactive
codex exec resume <session-id> "..."       # non-interactive
codex resume --last                        # most recent session
```

## APX runtime

Run a project agent through Codex:

```bash
apx run <agent> --runtime codex "task"
```

If the task needs Telegram, tell Codex the exact APX command:

```bash
apx telegram send "message"
```
