---
name: apx-project
description: How to register, list, configure, and manage APX projects. Use BEFORE asking the user "which project?" — registered projects are listable; per-project config (model override, etc) is set with dotted-key PATCH.
---

# apx-project

A project in APX is an APC-compliant folder on disk (`AGENTS.md` + `.apc/project.json`). Once registered, APX keeps runtime state (sessions, messages, routines, tasks, MCPs) under `~/.apx/projects/<apxId>/`.

## The two kinds of projects

- **`default`** (id=0): the super-agent's scratch workspace under `~/.apx/projects/default/`. Used when the user has no project named, has no project registered, or explicitly addresses "apx itself". Don't use it for real work — it's shared.
- **registered** (id=1+): real projects, each rooted at a path the user owns.

## Concrete CLI calls

```bash
# Register
apx project add /path/to/repo          # registers; reads AGENTS.md + .apc/project.json
apx project add .                       # current dir

# Inspect
apx project list                        # name, id, path, agents count
apx project list -l                     # long form, includes storagePath

# Remove / rebuild
apx project remove <id|name|path>
apx project rebuild <id|name|path>      # force re-scan of .apc/ on disk

# Per-project config — dotted keys, lives in <repo>/.apc/config.json
apx project config show <project>                                  # effective + project_only
apx project config show <project> --key super_agent.model          # one key
apx project config set <project> super_agent.model groq:llama-3.3-70b-versatile
apx project config set <project> super_agent.permission_mode total
apx project config set <project> telegram.route_to_agent reviewer
apx project config unset <project> super_agent.model               # back to global
apx project config edit <project>                                  # opens $EDITOR on project_only JSON
```

Every write to `project config` triggers `POST /admin/reload` so the daemon picks up the change without restart.

## Resolution of `<project>` argument

Accepted forms:
- numeric id: `1`
- exact name from `.apc/project.json`: `iacrmar`
- absolute path: `/Volumes/SSDT7Shield/trabajos_proyectos/iacrmar`
- relative path (from cwd) — resolved before matching.

The CLI calls `resolveProjectId()` which does fuzzy id-or-name-or-path matching. If you got "project not found", `apx project list` first.

## What lives where

```
<repo>/                                         ← project root the user owns
├── AGENTS.md                                   ← agent definitions (committed)
└── .apc/
    ├── project.json                            ← { apxId, name, ... }
    ├── agents/<slug>.md
    ├── agents/<slug>/memory.md
    ├── skills/<slug>.md or <slug>/SKILL.md
    ├── mcps.json                               ← shared MCPs (committed)
    ├── commands/                               ← custom slash-commands
    └── config.json                             ← project-only overrides (this is what `project config` edits)

~/.apx/projects/<apxId>/                        ← runtime state (never committed)
├── messages/YYYY-MM-DD.jsonl
├── agents/<slug>/{sessions/, conversations/}
├── routines.json
├── tasks/YYYY-MM.jsonl
├── artifacts/
└── mcps.json                                   ← per-project runtime MCPs (local, may hold tokens)
```

## Anti-example

```bash
# DON'T hand-write AGENTS.md + .apc/project.json with shell tools.
echo "Hello" > /path/repo/AGENTS.md
mkdir -p /path/repo/.apc
echo "{...}" > /path/repo/.apc/project.json
```

There's no scaffold validation, the project will appear registered but break on the first `apx project rebuild`. Use `apx init <path>` (project scaffold) and then `apx project add <path>`.

```bash
# DON'T set super_agent.model to a model that's not in the engine you have keys for.
apx project config set iacrmar super_agent.model gemini:gemini-1.5-pro
# ↑ Will fail at first call unless engines.gemini.api_key is set.
```

## When asked "what projects are there?"

Don't ask. Call `list_projects` (tool) or `apx project list`. Same for "which agents does X have?" → `list_agents` / `apx agent list --project X`.

## Don't

- Don't operate on the default project (id=0) as if it were the user's main work. It's a scratch space for super-agent state.
- Don't put secrets in `.apc/config.json` — it's committed. Put them in `~/.apx/config.json` (machine-local) under `engines.*` or `voice.tts.*`.
- Don't move a project's `.apc/` folder without re-running `apx project rebuild` afterwards. The `apxId` will be stale.
