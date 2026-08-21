---
name: apx-agent
description: Create, configure, use project agents in APX — including writing an agent's SYSTEM PROMPT (the body of its definition file, required for the agent to do anything) and its identity (typology, area, role, avatar blob). Load when user wants to add an agent, write or change an agent's prompt/instructions/persona, set an agent's type/area/role/avatar, import from vault, set a per-agent model, or write agent memory. Triggers: 'add agent', 'new agent', 'create agent', 'agent prompt', 'agent instructions', 'agent type', 'agent area', 'agent avatar', 'import agent', 'agent memory', 'per-agent model'.
---

# apx-agent

A project agent is a named persona inside an APC project. Definition: `.apc/agents/<slug>.md` (flat) — that file **is** the agent; the roster is discovered by reading `.apc/agents/*.md` directly (`readAgents`). Runtime data (memory, conversations, sessions) under `~/.apx/projects/<apx_id>/agents/<slug>/`, never committed. That is the only place an agent's memory lives — nothing reads or writes a `memory.md` under `.apc/`.

> **`AGENTS.md` is NOT the agent registry.** It's a generic startup-rules file written once by `apx init` and then owned by the user; APX **never** regenerates it (`scaffold.js`) and adding/removing an agent does not touch it. Editing it by hand is safe. Some projects (like the super-agent's `default`) have no `AGENTS.md` at all — that is normal, not a broken state.

## The definition file has two halves — both matter

```markdown
---
role: Social Media Producer      ← frontmatter: METADATA
language: es
description: One line for listings.
type: specialist                 ← typology
area: growth                     ← org-chart area
icon: kiwi                       ← avatar blob preset
---

You are Magui, the social producer for …   ← body: THE SYSTEM PROMPT
## Responsibilities
- …
## Hard limits
- …
```

The **body** is the agent's real instruction set. `buildAgentSystem()` injects it as `# Custom instructions` (`src/core/agent/build-agent-system.js`), capped at 6000 chars. **`description` is not a substitute** — it is one line of metadata for listings. An agent created with frontmatter only runs on `role` + `description` + `language` and is told nothing about what to do, how, or what never to do.

**Creating an agent without a prompt is the single most common mistake here, and nothing errors when you do it.** Always write the body.

## Build it with a tool, not a shell (super-agent)

If you are the super-agent, you have native tools for the agent lifecycle — use them, the same way you use `create_task` and `remember_routine`. Do **not** shell out to `apx agent add` and do **not** `write_file` the `.md` by hand (a raw write skips the daemon-registry rebuild the tools do for you, so the running daemon won't see the agent, and it's how a body-less agent gets papered over):

| Tool | Does | Notes |
|---|---|---|
| `create_agent` | Creates the agent **with its system prompt** in one call | `system` is **required** — it refuses a body-less agent. Pass `slug` + `system`; add `role`/`skills`/`area`/`model` as needed. Omit `tools` unless narrowing. |
| `set_agent_prompt` | Replaces an existing agent's prompt | Keeps every frontmatter field. |
| `configure_agent` | Edits frontmatter (model, type, area, role, skills, …) | Keeps the prompt. Only the fields you pass change; empty string clears one. |
| `remove_agent` | Deletes the agent + its runtime data | Irreversible — confirm first unless clearly asked. |
| `write_agent_memory` | Seeds/updates **another** agent's `memory.md` | Not `remember` (that's YOUR notebook). `mode: append` (default) or `replace`. |

Typical build: `create_agent({ slug, system, role, skills:["golf-lvl-2"] })` → optionally `write_agent_memory({ agent: slug, content: "..." })` to seed progress → `remember_routine(...)` for any schedule. One tool each, no shell, prompt inline.

## Identity: typology, area, role, avatar

Set these on create — they are what the team view, the hierarchy graph and every avatar render read. All optional except that leaving them empty makes the agent an untyped, unplaced face in a list.

**`type`** — one of five, owned by `src/core/apc/agent-identity.js`:

| type | meaning |
|---|---|
| `orchestrator` | Coordinates the team and delegates. Also marks the agent as master (it gets sub-agents). |
| `specialist` | Domain expert; runs tasks. |
| `assistant` | Conversational helper. |
| `worker` | Runs autonomous tasks. |
| `monitor` | Watches state and reports. |

**`area` / `role`** — slugs from the project org chart (`.apc/organization.json`). **List them first, don't invent them:** `apx org show`, or the `org_list` MCP tool, or `GET /api/projects/:pid/organization`. Store the **slug** (`growth`), never the display name (`Growth`) — mixed case splits the team view into two groups that look identical. Free text is accepted and slugified on write. Create a missing area with `apx org area add "<name>"`.

**`icon`** — the animated blob avatar. **You don't have to pick one:** every create path (CLI, MCP, API, web) now assigns one automatically, drawn from the blobs this project isn't using yet, so a team of six has six distinguishable faces. Pass `--icon <key>` only to pin a specific one. Keys: `menta parche trino cubi nimbo papa noche kiwi gajo campana cobalto rubi trebol saturno onyx`. `noche` is the super-agent's face and is never auto-assigned to a project agent.

**`parent`** — the orchestrator this agent reports to, for the hierarchy view.

## Concrete CLI calls

```bash
# List (agent commands are cwd-scoped — run from project root)
apx agent list

# See the areas/roles this project defines, before assigning one
apx org show

# Create WITH its system prompt (writes .apc/agents/<slug>.md, creates runtime
# dir, rebuilds the daemon's agent registry). Heredoc, because a prompt is many lines:
apx agent add reviewer \
  --type specialist \
  --role "Code reviewer" \
  --area engineering \
  --model ollama:llama3.2:3b \
  --language es \
  --description "Reviews PRs and pushes back on hand-wavy diffs." \
  --skills code-review,git \
  --prompt - <<'EOF'
You are the code reviewer for this project.

## Responsibilities
- Review diffs for correctness, not style.
- Name the specific line and the specific failure mode.

## Hard limits
- Never approve a diff you could not explain back.
- Never invent a test result you did not run.
EOF

# Same thing from a file
apx agent add reviewer --role "Code reviewer" --prompt-file ./prompts/reviewer.md

# Give a prompt to an agent that has none / replace an existing one
apx agent set reviewer --prompt - < ./prompts/reviewer.md
apx agent set reviewer --model gpt-5.2          # field-only edit keeps the prompt
apx agent set reviewer --type specialist --area growth --icon kiwi
# Aliases: apx agent edit, apx agent update

# Read it back to confirm the body is there (not just the fields)
apx agent get reviewer

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

`buildAgentSystem()` (`src/core/agent/build-agent-system.js`) composes:

1. Identity: `You are <slug>` + project name.
2. Description (from the agent's own frontmatter).
3. Role + Language fields.
4. **The agent's own body → `# Custom instructions`.** Empty body ⇒ this block is absent and the agent has no instructions.
5. Invocation context: `engine | telegram | routine | runtime` — the channel calling.
6. Memory: `~/.apx/projects/<apx_id>/agents/<slug>/memory.md` — the single location, no fallback.
7. Skills from agent's `Skills:` field, loaded from `.apc/skills/<slug>.md` or bundled set.
8. The `apx` meta-skill (so agent knows how to operate APX).
9. ACTION_DISCIPLINE_RULES (fixed footer — anti-ghost, anti-disclaimer, action-first).

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

## Other surfaces (same capability, same required prompt)

| Surface | Create | Set prompt | List areas/roles |
|---|---|---|---|
| Super-agent tool | `create_agent` (`system` required) | `set_agent_prompt` | `list_agents` / org |
| CLI | `apx agent add <slug> --prompt -` | `apx agent set <slug> --prompt -` | `apx org show` |
| MCP (`apx-mcp`) | `agent_create` (`prompt` required) | `agent_set_prompt` | `org_list` |
| Daemon API | `POST /api/projects/:pid/agents` `{system}` | `PATCH .../agents/:slug` `{system}` | `GET .../organization` |
| Web UI | Agents tab → new agent | agent detail → Prompt tab | Config tab pickers |

All four write the same file, assign an avatar blob when none is given, and accept the same `type` / `area` / `role` / `parent`. `system` in the API is the same thing as `--prompt` in the CLI and the body of the `.md`.

## Anti-examples

```bash
# DON'T create an agent with metadata only. It exits 0 and the agent is useless.
apx agent add magui --role "Social Media Producer" --description "Productora social."
# ↑ No --prompt ⇒ no instructions. Fix: apx agent set magui --prompt - <<'EOF' … EOF

# DON'T pack the instructions into --description. It is ONE LINE of metadata,
# truncated in listings, and it is not the prompt.

# DON'T invent an --area / --role slug. Run `apx org show` first; create the
# area if it's missing (apx org area add "Growth").

# DON'T make up an --icon. Only the 15 blob keys render; anything else is
# rejected. Omit the flag and one is chosen for you.

# DON'T hand-write .apc/agents/<slug>.md — the running daemon won't see it until a rebuild.
echo "..." > /path/.apc/agents/reviewer.md
# ↑ Use `apx agent add/set`, `apx agent import`, or the create_agent tool so the
#   running daemon reloads its registry (a raw write it won't see until a rebuild).

# DON'T set Model: to a provider without keys — fails on first call.
# DON'T put long-running context in `Description` (one line). Put it in memory.md.
```

## Super-agent vs project agent

| Aspect | Super-agent (default APX) | Project agent |
|---|---|---|
| Has tools? | Yes (full registry) | Yes. **No declared `tools:` → the broad default: the whole registry minus a few host-only tools** (`set_identity`, `set_permission_mode`, `add_project`, `import_agent`). Declaring `tools:` *narrows* to that allowlist. |
| Loop? | Multi-iteration tool loop | Multi-iteration, in a normal conversation or on `exec_agent`; one-shot text only when `spec.no_tools: true` |
| System prompt | `super-agent-base.md` + channel template + identity | `buildAgentSystem()` per-agent |
| Conversation in | super-agent surfaces | `<storagePath>/agents/<slug>/conversations/*.md` |
| Configured via | `super_agent.*` in config | `.apc/agents/<slug>.md` per-agent files |

When in doubt: super-agent is APX itself; agents are personas inside a project.

## Don't

- Don't create an agent without a system prompt. Nothing errors; the agent just has no instructions. Verify with `apx agent get <slug>` — if you see only fields and no body, it isn't done.
- Don't declare a `tools:` allowlist unless you mean to *narrow* the agent. Capability is the default: an agent with no `tools:` field already gets the whole registry minus a few host-only tools (`set_identity`, `set_permission_mode`, `add_project`, `import_agent`). Declaring the field takes tools *away* — so if you list one, list every tool the agent needs (`write_file`, `run_command`, `load_skill`, its MCP tools), or it silently loses the rest. When unsure, leave `tools:` off.
- Don't assume `AGENTS.md` is the agent list — it isn't. It's a user-owned startup-rules file APX never regenerates; agents live in `.apc/agents/*.md`. A project with no `AGENTS.md` (the super-agent's `default`) is fine, not broken.
- Don't use the same slug across projects expecting shared memory. Memory is per-project.
