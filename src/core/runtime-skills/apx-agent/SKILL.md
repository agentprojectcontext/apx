---
name: apx-agent
description: Create, configure, use project agents in APX. Load when user wants to add an agent, import from vault, set a per-agent model, or write agent memory. Triggers: 'add agent', 'new agent', 'import agent', 'agent memory', 'per-agent model'.
---

# apx-agent

A project agent is a named persona inside an APC project. Definition: `.apc/agents/<slug>.md` (flat); `AGENTS.md` auto-regenerated for discovery. Runtime data (memory, conversations, sessions) under `~/.apx/projects/<apx_id>/agents/<slug>/`, never committed. Legacy `.apc/agents/<slug>/memory.md` still read as migration fallback.

## Concrete CLI calls

```bash
# List (agent commands are cwd-scoped — run from project root)
apx agent list

# Create (writes .apc/agents/<slug>.md, creates runtime dir, regenerates AGENTS.md)
apx agent add reviewer \
  --role "Code reviewer" \
  --model ollama:llama3.2:3b \
  --language es \
  --description "Reviews PRs and pushes back on hand-wavy diffs." \
  --tools read,write,run \
  --skills code-review,git

# Import from global vault (~/.apx/agents/)
apx agent vault list                 # see what's available
apx agent import <slug>              # register vault slug in this project
apx agent import <slug> --copy       # copy vault .md into .apc/agents/ for local edits
apx agent import <slug> --force      # overwrite existing local definition

# Show details (config + memory)
apx agent get <slug>                 # alias: apx agent show <slug>

# Per-agent memory (drives system prompt; cwd-scoped)
apx memory <slug>                          # read
apx memory <slug> --append "fact"          # append under "## Recent context"
apx memory <slug> --replace < file.md      # full replace from stdin
```

## Agent system prompt composition

`buildAgentSystem()` (`src/core/agent-system.js`) composes:

1. Identity: `You are <slug>` + project name.
2. Description (from AGENTS.md).
3. Role + Language fields.
4. Invocation context: `engine | telegram | routine | runtime` — the channel calling.
5. Memory: `~/.apx/projects/<apx_id>/agents/<slug>/memory.md` (legacy `.apc/agents/<slug>/memory.md` fallback).
6. Skills from agent's `Skills:` field, loaded from `.apc/skills/<slug>.md` or bundled set.
7. The `apx` meta-skill (so agent knows how to operate APX).
8. ACTION_DISCIPLINE_RULES (fixed footer — anti-ghost, anti-disclaimer, action-first).

That's the prompt on every `apx exec <agent>` / `apx chat <agent>`. The super-agent (default APX mode) uses a *different* prompt — see `apx-routine` for super-agent vs exec_agent.

## Per-agent models

Set `Model:` in `.apc/agents/<slug>.md` to override the global super-agent model. Leave empty to follow project/global default.

```markdown
# .apc/agents/reviewer.md
---
Role: Code reviewer
Model: ollama:llama3.2:3b    ← independent of super_agent.model
Language: es
---
```

A routine `kind: exec_agent` with `spec.agent: reviewer` uses that model.

## Anti-examples

```bash
# DON'T hand-write .apc/agents/<slug>.md without regenerating AGENTS.md.
echo "..." > /path/.apc/agents/reviewer.md
# ↑ Use `apx agent add` or `apx agent import` so AGENTS.md stays consistent.

# DON'T set Model: to a provider without keys — fails on first call.
# DON'T put long-running context in `Description` (one line). Put it in memory.md.
```

## Super-agent vs project agent

| Aspect | Super-agent (default APX) | Project agent |
|---|---|---|
| Has tools? | Yes (full registry) | No (text-in/text-out via callEngine) |
| Loop? | Multi-iteration tool loop | Single call |
| System prompt | `super-agent-base.md` + channel template + identity | `buildAgentSystem()` per-agent |
| Conversation in | super-agent surfaces | `<storagePath>/agents/<slug>/conversations/*.md` |
| Configured via | `super_agent.*` in config | `AGENTS.md` + per-agent files |

When in doubt: super-agent is APX itself; agents are personas inside a project.

## Don't

- Don't expect a project agent to call tools. It can't. For tools, use super-agent or call MCPs from a routine `kind: shell`.
- Don't overwrite `AGENTS.md` manually — `apx agent add/remove` regenerates it. Hand edits get clobbered.
- Don't use the same slug across projects expecting shared memory. Memory is per-project.
