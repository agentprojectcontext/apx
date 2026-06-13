---
name: apx-project
description: Register, list, configure, manage APX projects. Load BEFORE asking "which project?" — registered projects are listable; per-project config set via dotted-key PATCH. Triggers: 'register project', 'apx project', 'project config', 'list projects', 'what projects are registered'.
---

# apx-project

A project in APX is an APC-compliant folder (`AGENTS.md` + `.apc/project.json`). Once registered, APX keeps runtime state (sessions, messages, routines, tasks, MCPs) under `~/.apx/projects/<apxId>/`.

## Two kinds of projects

- **`default`** (id=0): super-agent's scratch workspace at `~/.apx/projects/default/`. Used when user has no project named, no project registered, or addresses "apx itself". Don't use for real work — shared.
- **registered** (id=1+): real projects, each rooted at a path the user owns.

## Concrete CLI calls

```bash
# Register
apx project add /path/to/repo          # reads AGENTS.md + .apc/project.json
apx project add .                       # current dir

# Inspect
apx project list                        # id, name, agents count, path

# Remove / rebuild (id or exact path only — no name resolution here)
apx project remove <id|path>
apx project rebuild <id|path>           # force re-scan of .apc/

# Per-project config — dotted keys, lives in <repo>/.apc/config.json
apx project config show <project>                                  # effective + project_only
apx project config show <project> --key super_agent.model          # one key
apx project config set <project> super_agent.model groq:llama-3.3-70b-versatile
apx project config set <project> super_agent.permission_mode total
apx project config set <project> telegram.route_to_agent reviewer
apx project config unset <project> super_agent.model               # back to global
apx project config edit <project>                                  # opens $EDITOR on project_only JSON
```

Every `project config` write triggers `POST /admin/reload` so the daemon picks up changes without restart.

## `<project>` argument resolution

Accepted: numeric id (`1`), exact name from `.apc/project.json` (`iacrmar`), absolute path, relative path (resolved from cwd). The CLI's `resolveProjectId()` does fuzzy id/name/path matching. If "project not found", run `apx project list` first.

## What lives where

```
<repo>/                                         ← project root the user owns
├── AGENTS.md                                   ← agent definitions (committed)
└── .apc/
    ├── project.json                            ← { apxId, name, ... }
    ├── agents/<slug>.md
    ├── skills/<slug>.md or <slug>/SKILL.md
    ├── mcps.json                               ← shared MCPs (committed)
    ├── commands/                               ← custom slash-commands
    └── config.json                             ← project-only overrides (edited by `project config`)

~/.apx/projects/<apxId>/                        ← runtime state (never committed)
├── messages/YYYY-MM-DD.jsonl
├── agents/<slug>/{memory.md, sessions/, conversations/}
├── routines.json
├── tasks/YYYY-MM.jsonl
├── artifacts/
└── mcps.json                                   ← per-project runtime MCPs (local, may hold tokens)
```

## Anti-examples

```bash
# DON'T hand-write AGENTS.md + .apc/project.json with shell tools.
echo "Hello" > /path/repo/AGENTS.md
mkdir -p /path/repo/.apc && echo "{...}" > /path/repo/.apc/project.json
# ↑ No scaffold validation; project appears registered but breaks on `apx project rebuild`.
# Use `apx init <path>` then `apx project add <path>`.

# DON'T set super_agent.model to a model lacking an engine key.
apx project config set iacrmar super_agent.model gemini:gemini-1.5-pro
# ↑ Fails at first call unless engines.gemini.api_key is set.
```

## When asked "what projects are there?"

Don't ask — call `list_projects` tool or `apx project list`. Same for "which agents does X have?" → `list_agents` / `apx agent list --project X`.

## Don't

- Don't operate on the default project (id=0) as if it were the user's main work. Scratch space for super-agent state.
- Don't put secrets in `.apc/config.json` — it's committed. Put them in `~/.apx/config.json` (machine-local) under `engines.*` or `voice.tts.*`.
- Don't move a project's `.apc/` folder without re-running `apx project rebuild` — `apxId` will be stale.
