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
