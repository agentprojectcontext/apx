---
scope: internal
name: opencode-cli
description: "Activate ONLY when the user explicitly mentions OpenCode, opencode command, installing OpenCode, using OpenCode, OpenCode provider setup, or APX runtime opencode."
homepage: https://opencode.ai/docs
---
# OpenCode CLI

Use this skill only for OpenCode CLI install, auth/provider setup, usage, or APX runtime dispatch.

## Verify before acting

Check local CLI and exact flags first:

```bash
opencode --version
opencode --help
opencode run --help
```

Do not invent flags. Inspect help for the exact subcommand before running uncertain commands.

## Install

Use the official install method for the target machine, then verify:

```bash
opencode --version
```

Provider/auth management:

```bash
opencode providers
opencode models
```

## Non-interactive use

Use headless run:

```bash
opencode run "task"
opencode run --model provider/model "task"
opencode run --dangerously-skip-permissions "task"
```

## APX runtime

Run a project agent through OpenCode:

```bash
apx run <agent> --runtime opencode "task"
```

If the task needs Telegram, tell OpenCode the exact APX command:

```bash
apx telegram send "message"
```
