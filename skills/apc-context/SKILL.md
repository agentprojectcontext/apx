---
name: apc-context
description: Teaches an agent to use .apc/ as the single source of truth for project context. Prevents writing to .claude/, .cursor/, .windsurf/, or any IDE-specific folder. Detects existing IDE context files and offers to migrate them into .apc/. Activate on: "use project context", "agent context", ".apc", "AGENTS.md", "migrate context", "import context".
homepage: https://github.com/agentprojectcontext/agentprojectcontext
---

# APC — Agent Project Context

This project uses the **APC convention**. All agent context lives in `.apc/`. Do not read from or write to `.claude/`, `.cursor/`, `.windsurf/`, `.codex/`, `.opencode/`, or any other IDE-specific folder.

---

## Where things live

```
.apc/
  agents/
    <slug>.md          ← agent definition: role, model, skills, language
    <slug>/
      memory.md        ← durable memory for this agent in this project
      sessions/        ← session logs
  skills/              ← reusable prompt fragments
  mcps.json            ← MCP server declarations
  project.json         ← project metadata
AGENTS.md              ← human + machine readable registry (auto-generated)
```

---

## Rules for this agent

1. **Read context from `.apc/`** — your definition, memory, and skills are there.
2. **Write memory to `.apc/agents/<your-slug>/memory.md`** — never to `.claude/` or similar.
3. **Never create IDE-specific files** — no `.claude/CLAUDE.md`, no `.cursor/rules`, no `.windsurf/`.
4. **`AGENTS.md` is read-only for you** — it is auto-generated from `.apc/agents/`. Edit individual agent files instead.
5. **Skills are in `.apc/skills/`** — import them by referencing `skill: <name>` in your agent definition.

---

## Detecting existing IDE context — migration prompt

Before starting any task, scan the project root for IDE-specific context files:

```bash
# Check for existing IDE context
ls .claude/ .cursor/ .windsurf/ .codex/ .opencode/ CLAUDE.md .cursorrules 2>/dev/null
```

If any are found, **stop and ask the user**:

> I found existing agent context in [list of found paths].
> Would you like me to import and unify everything into `.apc/` so all tools share one source of truth?
> I'll migrate: rules → `.apc/agents/<slug>.md`, memory → `.apc/agents/<slug>/memory.md`, MCP config → `.apc/mcps.json`.
> Original files will be left in place unless you ask me to remove them.

Only proceed with migration after explicit user confirmation.

---

## Migration map

| Source | Destination |
|--------|-------------|
| `.claude/CLAUDE.md` or `CLAUDE.md` | `.apc/agents/<slug>.md` (role + instructions) |
| `.claude/memory.md` | `.apc/agents/<slug>/memory.md` |
| `.cursorrules` / `.cursor/rules` | `.apc/agents/<slug>.md` (rules section) |
| `.windsurf/rules` | `.apc/agents/<slug>.md` (rules section) |
| `AGENTS.md` (existing, non-APC) | Merge into `.apc/agents/` definitions |
| MCP config in any IDE folder | `.apc/mcps.json` |

---

## `AGENTS.md` is valid

If the project has an `AGENTS.md` at root (APC format), that is the agent registry. It is authoritative. Do not duplicate it. Do not replace it with IDE-specific equivalents.

An APC-format `AGENTS.md` looks like:

```markdown
## sofia
- **Role**: Support
- **Model**: claude-haiku-4-5
- **Skills**: customer-support
```

If `AGENTS.md` exists but has a non-APC format (e.g. Codex-style or plain notes), treat it as a candidate for migration and ask the user.
