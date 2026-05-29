---
name: apx-agency-agents
description: "Manage the APX agent vault — a library of reusable agent templates (Roby, Cody, Rocky, Tessa, Max, Arch, Sid, Vera, Finn, plus generic specialists: development, marketing, ops, qa, support). Load this when the user wants to: spawn a specialized agent, look up which templates are available, seed an empty vault with the bundled starter pack, import a template into a project, or create a new vault template. Trigger on: 'lanzar agente', 'spawn agent', 'usar a Cody/Rocky/Tessa/Max/Arch/Sid/Vera/Roby', 'qué agentes hay', 'sembrar vault', 'sync vault', 'agent vault sync', 'agent vault list', 'apx agent vault', 'importar agente', 'nuevo agente', 'crear agente nuevo'."
---

# apx-agency-agents — the APX agent vault

The vault is the **global, project-agnostic library of agent templates** that ship with APX. They live in `~/.apx/agents/<slug>.md` and can be imported into any project with `apx agent import <slug>` (or from a project's Agents → Importar in the web UI).

## Bundled starter pack

When you run `apx agent vault sync`, APX seeds the vault from the in-repo bundle at **`assets/agent-vault-defaults/`**. It currently ships two families:

### Named team (from nicho-apps)
A characterful crew already used in production by NichoApps:

| Slug | Role | Strength |
|---|---|---|
| `roby-orchestrator` | Pipeline orchestrator | Autonomous task routing, multi-agent coordination |
| `arch-architect` | Software architect | System design, tradeoffs, ADRs |
| `cody-developer` | Senior Laravel dev | Code, refactors, technical leadership |
| `tessa-qa` | QA / beta tester | Reality checks, test plans, real-user empathy |
| `max-marketing` | Growth hacker | Content, campaigns, SEO, copy |
| `sid-security` | Security specialist | Audits, threat models, hardening |
| `rocky-pm` | Senior PM | Tasklists, roadmaps, stakeholder comms |
| `vera-ui` | UI/UX reviewer | Visual audits, usability (uses browser-use) |
| `finn-billing` | Billing / commercial ops | Stripe, invoicing, plan logic |

### Generic specialists (from PandaProject)
Plain functional roles — useful when you want capabilities without a persona:

| Slug | Role |
|---|---|
| `development` | Engineering & code |
| `marketing` | Marketing & growth |
| `ops` | Ops, deploys & incidents |
| `qa` | Quality assurance & testing |
| `support` | Customer support & escalations |

Both families default to `model: openrouter:meta-llama/llama-3.3-70b-instruct` and `language: es`. Override on import or by editing the vault file directly.

## Concrete commands

```bash
# Seed the vault from the bundled pack (skips existing slugs — safe to re-run)
apx agent vault sync

# See what would happen without writing
apx agent vault sync --dry-run

# Force overwrite (destroys your local edits — confirm before doing this)
apx agent vault sync --force

# List what's in the vault now
apx agent vault list

# Create your own template from scratch (or copy one out of a project)
apx agent vault add reviewer \
  --role "Code reviewer" \
  --model claude-haiku-4-5 \
  --language es \
  --skills code-review,git \
  --description "Reviews PRs and pushes back on hand-wavy diffs."

# Import a vault template into the current project
apx agent import cody-developer
apx agent import tessa-qa --copy     # copy into .apc/agents/ for local edits
apx agent import roby-orchestrator --force   # overwrite an existing local def

# Inside the daemon's tool API, the same flow:
list_vault_agents()
import_agent({ slug: "cody-developer", project: "<name-or-path>" })
```

## When to use which agent

- **User says "lanzar a Cody/Rocky/Tessa/Max/Arch/Sid/Vera/Roby/Finn"** → that exact slug exists in the named team. Import it.
- **User wants a "developer" / "QA" / "marketing" agent without a persona** → use the generic specialists (`development`, `qa`, `marketing`, …).
- **User wants something not in the vault** → either `apx agent vault add <slug>` to create a blank one, or `apx agent add <slug>` directly inside a project for a one-off.
- **The vault is empty on a fresh install** → suggest `apx agent vault sync` first.

## Where the files live

```
<APX repo>/assets/agent-vault-defaults/<slug>.md   ← canonical bundle (committed)
~/.apx/agents/<slug>.md                            ← user vault (sync target)
<project>/.apc/agents/<slug>.md                    ← project-local copy (after import --copy)
```

The vault file format is identical to a project agent file:

```
---
role: <human-readable role>
model: <provider:model>
description: <short description shown in UI grid>
language: es
skills: a, b, c
tools: x, y
is_master: false
---

<markdown body — the agent's system prompt extension>
```

## Frontmatter fields the runtime reads

| Field | Effect |
|---|---|
| `role` | Shown in CLI/web. Appears in the agent's prompt as "Role: …". |
| `model` | Default model for engine routing. |
| `description` | Shown in `/agents/vault` and the AgentDefaultsTab cards. |
| `language` | Adds "Default language: <code>" to the system prompt. |
| `skills` | Per-agent skill names; relevant skill bodies are loaded by skill resolution. |
| `tools` | Declared tool hints; actual callable tools depend on the invocation surface. |
| `is_master` | If true, marked as a master agent in the project (badge + ordering). |

## Related skills

- **[apx-agent](../apx-agent/SKILL.md)** — per-project agent CRUD (add / edit / memory / list). The vault is the *library*; this skill is the *workshop*.
- **[apx-runtime](../apx-runtime/SKILL.md)** — delegating to external coding CLIs (claude-code, codex, etc) from inside an agent.

## Gotchas

- `apx agent vault sync` **never** overwrites your edits unless you pass `--force`. Re-running it is the safe way to pick up new bundled templates without losing customizations.
- The slug `roby-orchestrator` is intentionally **not** `roby` — the APX super-agent persona is already named "Roby" via `~/.apx/identity.json`. Importing a project agent called `roby` would shadow that and cause confusion. Use `roby-orchestrator` for a *project-level* orchestrator.
- The `agency-agents` skill in `~/.claude/skills/` pulls from an external GitHub repo (`msitarzewski/agency-agents`). APX bundles a snapshot in `assets/agent-vault-defaults/` so installs are offline-first. To refresh from upstream, edit the bundle and re-commit; users sync with `apx agent vault sync --force`.
