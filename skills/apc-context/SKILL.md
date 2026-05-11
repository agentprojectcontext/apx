---
name: apc-context
description: "ALWAYS activate when the project has a .apc/ directory or AGENTS.md file. Read APC project context before making assumptions about agents, memory, skills, MCP hints, or project structure. If .apc/migrate.md exists, offer migration before other work."
homepage: https://github.com/agentprojectcontext/agentprojectcontext
---

# Agent Project Context

This project uses APC. APC stores portable project context in `.apc/` and `AGENTS.md`.

APC does not store raw runtime sessions. Sessions, conversations, messages, caches, provider
threads, and private runtime memory stay in the IDE, CLI, daemon, or user-level store that created
them.

## FIRST: check for pending migration

Before doing anything else, check if `.apc/migrate.md` exists:

```bash
cat .apc/migrate.md 2>/dev/null
```

If it exists, open with this offer before answering anything else:

> I see this project was initialized with Agent Project Context (APC).
>
> I found context files that may need migration:
> [list files from .apc/migrate.md]
>
> I can read them, separate durable project context from runtime/private state, and migrate only
> what belongs in APC.
>
> Want me to start?

If the user says no or later, delete `.apc/migrate.md` so the offer is not repeated.

## Migration rule: think, do not copy

Read detected files first. Also read `AGENTS.md` if it exists.

Classify content:

| Content | Action |
|---|---|
| Agent definitions: name, model, description | Put in `.apc/agents/<name>.md` and/or `AGENTS.md` |
| Shared project rules, stack notes, commands, testing policy | Keep in `AGENTS.md` |
| Reusable instruction blocks | Move to `.apc/skills/<name>.md` |
| Durable safe facts useful to all contributors | Add to `.apc/agents/<name>/memory.md` only after curation |
| MCP expectations without secrets | Add to `.apc/mcps.json` |
| Raw sessions, transcripts, conversations, messages, tool logs | Do not move into `.apc/`; leave with source runtime |
| Secrets, tokens, credentials, private headers | Do not store in repository |
| IDE UI settings or personal aliases | Leave in IDE/user config |
| Instructions to store sessions under `.apc/` | Drop as obsolete |

After migration:

1. Update `AGENTS.md` as the root project contract.
2. Create or update `.apc/agents/`, `.apc/skills/`, `.apc/mcps.json` as needed.
3. Do not create `.apc/**/sessions`, `.apc/messages`, or `.apc/conversations`.
4. Delete obsolete source files only when their useful project context was migrated or intentionally dropped.
5. Delete `.apc/migrate.md`.
6. Summarize what moved, what stayed local, and what was dropped.

## APC structure

```text
AGENTS.md                        ← root project contract
.apc/
  project.json                   ← project metadata
  .gitignore                     ← safety guard
  agents/<name>.md               ← agent definition
  agents/<name>/memory.md        ← optional curated project memory
  skills/<name>.md               ← reusable project instructions
  mcps.json                      ← MCP hints without secrets
```

Do not store:

```text
.apc/agents/<name>/sessions/
.apc/sessions/
.apc/conversations/
.apc/messages/
.apc/project.db
.apc/cache/
.apc/tmp/
.apc/private/
.apc/secrets/
```

## Visibility rules

| Data | Visibility | Commit? |
|---|---|---|
| Agent definitions, skills, project rules | `stable` / `project` | Yes |
| Curated safe `memory.md` | `project` | Yes, if team-safe |
| MCP hints without secrets | `project` | Yes |
| Sessions, conversations, messages | `local` | No; runtime-owned |
| Secrets, tokens, `*.secret.json`, `*.env` | `private` | Never |
| Caches, temp files, databases | `ephemeral` | No |

## Operating rules

1. Read `AGENTS.md` and relevant `.apc/` files before assuming project context.
2. Read agent definitions from `.apc/agents/<name>.md` when present.
3. Read curated project memory from `.apc/agents/<name>/memory.md` when present.
4. Write only durable, safe, curated facts to APC memory.
5. Never write raw sessions, transcripts, messages, conversations, or tool logs into `.apc/`.
6. Keep secrets out of APC and out of git.
7. Treat `.apc/mcps.json` as MCP configuration hints, not as an MCP implementation.

## Normalization

If agent formats are broken or use legacy fields (role, skills in YAML), offer to normalize:

```yaml
---
name: agent-name
model: inherit
description: Semantic activation trigger
---
```

Identify and fix inconsistencies in `model` (use technical IDs or `inherit`) and ensure `description` is present for semantic activation.

## Sessions

Sessions belong to the runtime that created them.

Examples:

```text
Codex runtime storage
Claude Code runtime storage
OpenCode runtime storage
~/.apx/projects/<project-id>/agents/<name>/sessions/
```

At task end, provide the user a concise result. If project memory should be updated, write a short
sanitized fact to `.apc/agents/<name>/memory.md` only when useful and safe.

## APX

Read `.apc/project.json` if present. It may contain an `apx` field:

- `"installed"`: APX is available; use `apx` commands when useful.
- `"declined"`: user chose not to install; do not suggest or run APX.
- missing or `null`: unknown; do not assume APX is available.

If APX is installed, it may manage runtime state outside the repository:

```text
~/.apx/projects/<project-id>/
```

APX can provide a local daemon, MCP management, Telegram bridge, routines, and runtime dispatch
across Codex, Claude Code, OpenCode, Aider, or direct LLM engines. Those are APX runtime features,
not APC portable-core requirements.

Never use APX to write secrets or raw sessions into `.apc/`.
