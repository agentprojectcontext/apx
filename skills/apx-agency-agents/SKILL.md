---
name: apx-agency-agents
description: "Manage the APX agent vault — reusable agent templates (Roby, Cody, Rocky, Tessa, Max, Arch, Sid, Vera, Finn + generic dev/marketing/ops/qa/support). Load to spawn a specialist, list templates, import one into a project, create a template, or hide/restore a bundled default. Triggers: 'spawn agent', 'use Cody/Rocky/Tessa', 'list agents', 'agent vault', 'import agent', 'new agent'."
---

# apx-agency-agents — the APX agent vault

The vault is the **global, project-agnostic library of agent templates** in APX. Two layers, deduped per-slug, with the user layer winning:

| Layer | Where | Mutability |
|---|---|---|
| **Bundled** | `<repo>/assets/agent-vault-defaults/<slug>.md` | Read-only on disk. Always visible unless tombstoned. |
| **User** | `~/.apx/agents/<slug>.md` | Read-write. Overrides the bundled with the same slug. |
| **Tombstones** | `~/.apx/agents/.removed.json` | List of bundled slugs the user explicitly hid. |

Listing returns `bundled ∪ user`, with `source: "bundled" | "user" | "user-override"` per entry. Editing a bundled entry is **copy-on-write** — it materializes into the user layer the moment you save. Deleting a bundled entry **tombstones** it (you can restore later); deleting a user-only entry physically removes the file.

## Bundled starter pack

APX ships 14 templates out of the box, two families:

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

Bundled templates ship with `language: es` and **no `model:` set** — they inherit the project/global default model. Set a model on import or by editing the vault file directly.

## Concrete commands

```bash
# List the vault (bundled + your overrides, with [bundled] / [user] / [override] tags)
apx agent vault list

# Include tombstoned bundled defaults (the ones you hid)
apx agent vault list --all

# Create a new template (writes ~/.apx/agents/<slug>.md)
apx agent vault add reviewer \
  --role "Code reviewer" \
  --model ollama:llama3.2:3b \
  --language es \
  --skills code-review,git \
  --description "Reviews PRs and pushes back on hand-wavy diffs."

# Delete a template:
#   - user-only slug → file is physically deleted
#   - bundled slug   → tombstoned, hidden from listings
apx agent vault rm tessa-qa

# Bring back a tombstoned bundled default
apx agent vault restore tessa-qa

# Import a vault template into the current project
apx agent import cody-developer
apx agent import tessa-qa --copy     # copy into .apc/agents/ for local edits
apx agent import roby-orchestrator --force   # overwrite an existing local def

# Inside the daemon's tool API, the same flow:
list_vault_agents()
import_agent({ slug: "cody-developer", project: "<name-or-path>" })
```

## The web equivalents

The Agent defaults tab (`/p/0/agent-defaults`) has the same CRUD: a "New" button (POST `/agents/vault`), "Edit" per card (PATCH `/agents/vault/:slug`, copy-on-write for bundled), "Delete"/"Hide" (DELETE), and a "Show removed" toggle that surfaces tombstoned bundled defaults with a "Restore" button.

## When to use which agent

- **User says "spawn/use Cody/Rocky/Tessa/Max/Arch/Sid/Vera/Roby/Finn"** → that exact slug exists in the named team. Import it.
- **User wants a "developer" / "QA" / "marketing" agent without a persona** → use the generic specialists (`development`, `qa`, `marketing`, …).
- **User wants something not in the vault** → either `apx agent vault add <slug>` to create a blank one, or `apx agent add <slug>` directly inside a project for a one-off.
- **Fresh install** → bundled defaults are always present (no sync step); they appear in `apx agent vault list` immediately.

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

- **Bundled defaults are always present** — there's no sync step. They appear in `apx agent vault list` and in the web UI the moment APX is installed. Removing one tombstones it; editing one copies it to your user layer.
- The slug `roby-orchestrator` is intentionally **not** `roby` — the APX super-agent persona is already named "Roby" via `~/.apx/identity.json`. Importing a project agent called `roby` would shadow that and cause confusion. Use `roby-orchestrator` for a *project-level* orchestrator.
- The `agency-agents` skill in `~/.claude/skills/` pulls from an external GitHub repo (`msitarzewski/agency-agents`). APX bundles a snapshot in `assets/agent-vault-defaults/` so installs are offline-first. To refresh from upstream, edit the bundle and re-commit; existing users' overrides are untouched.
