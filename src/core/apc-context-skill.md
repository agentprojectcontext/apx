# Agent Project Context

This project uses APC. All agent context lives in `.apc/` — not in `.claude/`, `.cursor/`, `.windsurf/`, or any other IDE folder.

## FIRST: check for pending migration

**Before doing anything else**, check if `.apc/migrate.md` exists:

```bash
cat .apc/migrate.md 2>/dev/null
```

If it exists, open the conversation with this message — do not answer any other question first:

> Hi! I see this project was just initialized with **Agent Project Context (APC)**.
>
> I found existing context files that haven't been migrated yet:
> [list the files from .apc/migrate.md]
>
> Right now those files are IDE-specific — only the agent running in that IDE can see them.
> Migrating them into `.apc/` means every agent (Claude Code, Cursor, Codex, etc.) shares the same context.
>
> **Want me to migrate them now?** I'll preserve all the content and walk you through the result.

If the user says yes, perform the migration:
1. For `CLAUDE.md`: extract any agent definitions into `.apc/agents/<slug>.md`; put project rules/instructions into `.apc/skills/project-rules.md`
2. For `.cursorrules` / `.windsurfrules` / `.clinerules`: move content into `.apc/skills/ide-rules.md`
3. For `.github/copilot-instructions.md` / `.trae/rules/project_rules.md`: move content into `.apc/skills/project-rules.md` (append if it already exists)
4. Leave a one-liner stub in each original file: `> Context migrated to .apc/ — edit files there.`
5. Delete `.apc/migrate.md` to mark migration complete
6. Summarize what was created/updated in `.apc/`

If the user says no or later, skip — do not bring it up again in this session.

---

## Structure

```
AGENTS.md              ← agent registry (read-only, auto-generated)
.apc/
  project.json         ← project metadata
  agents/<slug>.md     ← agent definition: role, model, skills
  agents/<slug>/
    memory.md          ← durable memory for this agent
    sessions/          ← session logs
  skills/              ← reusable prompt fragments
  mcps.json            ← MCP server declarations
```

## Rules

1. Read your definition and memory from `.apc/agents/<your-slug>/`
2. Write memory to `.apc/agents/<your-slug>/memory.md` — never to IDE-specific folders
3. `AGENTS.md` is auto-generated — edit individual files in `.apc/agents/`, not `AGENTS.md`
4. To list agents: read `AGENTS.md` or list `.apc/agents/*.md`

## APX — optional superpowers

If the project has `.apc/mcps.json`, MCP servers need **APX** to run.
If you need to run another agent, coordinate between agents, or install agents from the team workspace, **APX** is required.

Check if APX is installed:
```bash
apx --version 2>/dev/null || echo "APX not installed"
```

If APX is not installed, inform the user:
> This project has [MCPs / agents] configured in `.apc/` that require APX to function.
> Install with: `npm install -g apx`
> Docs: https://github.com/agentprojectcontext/apx
