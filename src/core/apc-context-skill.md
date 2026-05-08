# Agent Project Context

This project uses APC. All agent context lives in `.apc/` — not in `.claude/`, `.cursor/`, `.windsurf/`, or any other IDE folder.

## FIRST: check for pending migration

**Before doing anything else**, check if `.apc/migrate.md` exists:

```bash
cat .apc/migrate.md 2>/dev/null
```

If it exists, open the conversation with this message — do not answer any other question first:

> I see this project was just initialized with **Agent Project Context (APC)**.
>
> I found context files that haven't been migrated yet:
> [list files from .apc/migrate.md]
>
> I'll read them, understand what's in them, and migrate intelligently — keeping only what APC doesn't already handle.
>
> **Want me to start?**

### How to migrate — think, don't copy

**Step 1 — Read everything first.** Read all detected context files in full. Also read `AGENTS.md` if it exists. Understand the full project structure, conventions, and any referenced directories (e.g. `works/`, `docs/`, `notes/`).

**Step 2 — Classify each piece of content:**

| What it says | What to do |
|---|---|
| Agent definitions (role, model, skills) | Create `.apc/agents/<slug>.md` |
| "Write sessions to `works/sessions/`" | **Drop it** — APC handles sessions natively in `.apc/agents/<slug>/sessions/` |
| "Write memory to `works/memory.md`" | **Drop it** — APC handles memory natively in `.apc/agents/<slug>/memory.md` |
| "List agents in `AGENTS.md`" | **Drop it** — APC handles this natively |
| Project-specific directories not covered by APC (e.g. `works/specs/`, `works/tasks/`) | **Keep in `AGENTS.md`** — document the convention there |
| Project rules, testing policy, stack notes, URLs, credentials | **Keep in `AGENTS.md`** — project context that APC doesn't define |
| IDE-specific shortcuts or instructions (e.g. "run `npm run dev` in Claude terminal") | **Keep in `AGENTS.md`** — still useful to all agents |

**Step 3 — Write `AGENTS.md`.** Start from what already exists in `AGENTS.md`, add what you kept from the classified content. Remove anything that duplicates APC native behavior. Keep it agent-neutral — no IDE-specific framing.

**Step 4 — Delete the original files** (`CLAUDE.md`, `.cursorrules`, etc.). Do not leave stubs. The content either moved to `AGENTS.md` / `.apc/agents/` or was intentionally dropped because APC covers it.

**Step 5 — Delete `.apc/migrate.md`** to mark migration complete.

**Step 6 — Summarize** what was created, what was kept, and what was dropped (and why).

---

## Structure

```
AGENTS.md              ← project context: rules, conventions, stack notes (agent-neutral)
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
