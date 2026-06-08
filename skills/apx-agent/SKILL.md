---
name: apx-agent
description: How to create, configure, and use project agents in APX. Load when the user wants to "add an agent", import from the vault, set a per-agent model, or write agent memory.
---

# apx-agent

A project agent is a named persona inside an APC project. Canonical definition: `.apc/agents/<slug>.md` (flat file). `AGENTS.md` is auto-regenerated for discovery. Per-agent runtime data (memory, conversations, sessions) lives under `~/.apx/projects/<apx_id>/agents/<slug>/` and is never committed. APX still reads legacy `.apc/agents/<slug>/memory.md` as a migration fallback only.

## Concrete CLI calls

```bash
# List agents in a project
apx agent list --project iacrmar

# Create a new agent (writes .apc/agents/<slug>.md, creates runtime dir, regenerates AGENTS.md)
apx agent add reviewer \
  --role "Code reviewer" \
  --model ollama:llama3.2:3b \
  --language es \
  --description "Reviews PRs and pushes back on hand-wavy diffs." \
  --tools read,write,run \
  --skills code-review,git

# Import an agent template from the global vault (~/.apx/agents/)
apx agent vault list                 # see what's available
apx agent import <slug>              # register vault slug in this project
apx agent import <slug> --copy       # copy vault .md into .apc/agents/ for local edits
apx agent import <slug> --force      # overwrite existing local definition

# Show details (config + memory)
apx agent get <slug>                 # alias: apx agent show <slug>

# Per-agent memory (drives system prompt for that agent)
apx memory <slug> --project iacrmar                          # read
apx memory <slug> --project iacrmar --append "fact"          # append a line
apx memory <slug> --project iacrmar --replace < file.md       # full replace from stdin
```

## What the agent's system prompt looks like

`buildAgentSystem()` (`src/core/agent-system.js`) composes:

1. Identity block: `You are <slug>` + project name.
2. Description (from AGENTS.md).
3. Role + Language fields.
4. Invocation context: `engine | telegram | routine | runtime` — the channel calling the agent.
5. Memory: `~/.apx/projects/<apx_id>/agents/<slug>/memory.md` if it exists, with legacy `.apc/agents/<slug>/memory.md` as a migration fallback.
6. Skills declared in the agent's `Skills:` field, each loaded from `.apc/skills/<slug>.md` or the bundled set.
7. The `apx` meta-skill (so the agent knows how to operate APX).
8. ACTION_DISCIPLINE_RULES (fixed footer — anti-ghost, anti-disclaimer, action-first).

That's the prompt the engine sees on every `apx exec <agent>` or `apx chat <agent>`. The super-agent (default APX mode) uses a *different* prompt — see `apx-routine` for when the super-agent runs vs. when an exec_agent runs.

## Models per agent

Each agent can set `Model:` in its `AGENT.md` to override the global super-agent model. Leave it empty when the agent should follow the project/global default.

```markdown
# .apc/agents/reviewer.md
---
Role: Code reviewer
Model: ollama:llama3.2:3b    ← this agent uses this model, independent of super_agent.model
Language: es
---
```

When a routine `kind: exec_agent` runs with `spec.agent: reviewer`, it uses that model.

## Anti-examples

```bash
# DON'T hand-write .apc/agents/<slug>.md without matching AGENTS.md regeneration.
echo "..." > /path/.apc/agents/reviewer.md
# ↑ Prefer `apx agent add` or `apx agent import` so AGENTS.md stays consistent.

# DON'T set Model: to a provider you don't have keys for.
# An agent with Model: openai:gpt-4o on a machine with no openai.api_key fails on first call.

# DON'T put long-running context in `Description`. Put it in memory.md.
# Description is one line, Role is a noun phrase, memory is unlimited.
```

## How agents differ from the super-agent

| Aspect | Super-agent (default APX) | Project agent |
|---|---|---|
| Has tools? | Yes (the full registry) | No (text-in/text-out via callEngine) |
| Loop? | Multi-iteration tool loop | Single call |
| System prompt | `super-agent-base.md` + channel template + identity | `buildAgentSystem()` per-agent |
| Conversation persisted in | super-agent surfaces | `<storagePath>/agents/<slug>/conversations/*.md` |
| Configured via | `super_agent.*` in config | `AGENTS.md` + per-agent files |

When in doubt: the super-agent is APX itself; agents are personas inside a project.

## Don't

- Don't expect a project agent to call tools. It can't. If you want tools, use the super-agent or call MCPs from a routine `kind: shell`.
- Don't overwrite `AGENTS.md` manually — `apx agent add/remove` regenerates it. Hand edits get clobbered.
- Don't use the same slug across projects expecting shared memory. Memory is per-project.
