---
name: apc-context
description: "Reads a project's agent context: AGENTS.md at the root and the .agent/ folder (agent definitions, curated memory, project skills, MCP hints). Use when the project has an .agent/ folder and the question is about its agents, their memory or the project's structure: 'which agents', 'list agents', 'who are the agents', 'agent context', 'project memory'. A project that still has .apc/ (the old name of the same folder) is moved to .agent/ by APX; do not create new files there."
homepage: https://github.com/agentprojectcontext/agentprojectcontext
---

# Agent Project Context v2

A project keeps its portable agent context in two places:

- `AGENTS.md` at the root: the project's instructions, the file most coding agents read.
- `.agent/`: what the project's agents are, next to the code and committed with it.

`.apc/` is the old name of `.agent/` (Agent Project Context v1). APX moves it to `.agent/` by itself; if you find a
project with `.apc/` and no `.agent/`, read from `.apc/` but write nothing new there, and tell the user that
`apx doctor --fix` moves it.

Raw runtime state never lives here: sessions, conversations, messages, caches and each agent's own memory stay in the
tool or runtime that created them.

## Structure

```text
AGENTS.md                        ← root project contract
.agent/
  project.json                   ← name, description, kind, apx_id
  agents/<slug>.md               ← one agent each (frontmatter + its instructions)
  memory.md                      ← curated project notes, written by people
  skills/<name>/SKILL.md         ← skills only this project's agents get
  mcps.json                      ← MCP hints without secrets ({"mcpServers": {…}})
  organization.json              ← areas and roles, for a company
  worktrees/                     ← git worktrees agents work in (code, not context)
```

Never under `.agent/`: per-agent runtime folders, `sessions/`, `conversations/`, `messages/`, `cache/`, `tmp/`,
`private/`, `secrets/`.

## Operating rules

1. Read `AGENTS.md` and the relevant `.agent/` files before assuming anything about agents, memory or structure.
2. Agent definitions are `.agent/agents/<slug>.md`; project notes are `.agent/memory.md`. An agent's own memory is
   runtime state (in APX: its core, `apx memory`), never a file here.
3. Write to `.agent/memory.md` only short, durable, safe facts useful to everyone on the project, and only when asked
   or clearly useful.
4. Never write sessions, transcripts, messages or tool logs into `.agent/`. Keep secrets out of it and out of git.
5. `.agent/mcps.json` is configuration hints, not an MCP implementation; a runtime may ask the owner to approve each
   server before it runs.
6. Changing an agent's file can change what that agent may do: in APX it asks the owner first.

## Agent files

Frontmatter fields `name`, `role`, `model`, `description`, `skills`, `tools` (and APX's `autonomy`, `parent`,
`aliases`) are the canonical shape; keep them.

```yaml
---
name: Ana
role: Software architect
model: inherit
description: When to bring this agent in
skills: deploy, review
---

Keep it simple.
```

Only fix real breakage: frontmatter that does not parse, or a `model` that is neither a model id nor `inherit`.

## APX

APX reads `AGENTS.md` and `.agent/` of each registered project and keeps runtime state (threads, runs, agent memory,
secrets) outside the repository. Its index follows the files: edit a file and APX picks it up. Use `apx` commands
when useful (see the `apx` skill); check with `apx status` before assuming APX is running. Never use APX to write
secrets or raw sessions into `.agent/`.
