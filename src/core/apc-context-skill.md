# Agent Project Context

This project uses APC. All agent context lives in `.apc/` — not in `.claude/`, `.cursor/`, `.windsurf/`, or any other IDE folder.

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

## Migration detection — act proactively

When you open a project, scan for scattered context files:

```
CLAUDE.md, .cursorrules, .windsurfrules, .github/copilot-instructions.md,
.trae/rules/project_rules.md, .clinerules, or any IDE-specific instruction file
```

If you find any of these **alongside or instead of** `.apc/`, tell the user immediately — before answering anything else:

> I found project context in `[file list]`. These are IDE-specific files — only the agent running in that IDE will see them.
> Moving them into `.apc/` would make this context available to **all agents** (Claude Code, Cursor, Codex, etc.) from a single source.
>
> Want me to migrate them to `.apc/`? I'll preserve all the content and generate a proper APC structure.

If the user says yes, perform the migration:
1. Run `apx init` (or create `.apc/` manually if APX isn't installed)
2. Move instruction content into `.apc/skills/<name>.md` (one file per logical area)
3. For `CLAUDE.md`: extract agent definitions into `.apc/agents/<slug>.md`, put project rules into `.apc/skills/project-rules.md`
4. Keep the original files with a one-liner pointing to `.apc/`: `> Context moved to .apc/ — edit files there.`
5. Confirm what was moved and where

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
