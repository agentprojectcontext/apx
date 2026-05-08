
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

If it exists, offer to migrate before answering anything else. Read detected files, separate durable
project context from runtime/private state, and migrate only what belongs in APC.

If the user says no or later, delete `.apc/migrate.md` so the offer is not repeated.

## Migration rule: think, do not copy

Classify content:

| Content | Action |
|---|---|
| Agent definitions: role, model, skills, description | Put in `.apc/agents/<slug>.md` and/or `AGENTS.md` |
| Shared project rules, stack notes, commands, testing policy | Keep in `AGENTS.md` |
| Reusable instruction blocks | Move to `.apc/skills/<name>.md` |
| Durable safe facts useful to all contributors | Add to `.apc/agents/<slug>/memory.md` only after curation |
| MCP expectations without secrets | Add to `.apc/mcps.json` |
| Raw sessions, transcripts, conversations, messages, tool logs | Do not move into `.apc/`; leave with source runtime |
| Secrets, tokens, credentials, private headers | Do not store in repository |
| IDE UI settings or personal aliases | Leave in IDE/user config |
| Instructions to store sessions under `.apc/` | Drop as obsolete |

## APC structure

```text
AGENTS.md                        ← root project contract
.apc/
  project.json                   ← project metadata
  .gitignore                     ← safety guard
  agents/<slug>.md               ← agent definition
  agents/<slug>/memory.md        ← optional curated project memory
  skills/<name>.md               ← reusable project instructions
  mcps.json                      ← MCP hints without secrets
```

Do not store:

```text
.apc/agents/<slug>/sessions/
.apc/sessions/
.apc/conversations/
.apc/messages/
.apc/project.db
.apc/cache/
.apc/tmp/
.apc/private/
.apc/secrets/
```

## Operating rules

1. Read `AGENTS.md` and relevant `.apc/` files before assuming project context.
2. Read agent definitions from `.apc/agents/<slug>.md` when present.
3. Read curated project memory from `.apc/agents/<slug>/memory.md` when present.
4. Write only durable, safe, curated facts to APC memory.
5. Never write raw sessions, transcripts, messages, conversations, or tool logs into `.apc/`.
6. Keep secrets out of APC and out of git.
7. Treat `.apc/mcps.json` as MCP configuration hints, not as an MCP implementation.

## Sessions

Sessions belong to the runtime that created them.

Examples:

```text
Codex runtime storage
Claude Code runtime storage
OpenCode runtime storage
~/.apx/projects/<project-id>/agents/<slug>/sessions/
```

At task end, provide the user a concise result. If project memory should be updated, write a short
sanitized fact to `.apc/agents/<slug>/memory.md` only when useful and safe.

## APX

APX can provide a local daemon, MCP management, Telegram bridge, routines, and runtime dispatch
across Codex, Claude Code, OpenCode, Aider, or direct LLM engines. Those are APX runtime features,
not APC portable-core requirements.

APX runtime state belongs outside the repository:

```text
~/.apx/projects/<project-id>/
```
