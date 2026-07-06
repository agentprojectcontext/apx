---
name: apx-agency-agents
description: "APX agent vault — reusable templates (generic dev/marketing/ops/qa/support). Spawn a specialist, list, import into a project, create, or hide/restore a bundled default. Triggers: 'spawn agent', 'use Cody/Rocky/Tessa', 'list agents', 'agent vault', 'import agent', 'new agent'."
---

# apx-agency-agents — the APX agent vault

Global, project-agnostic library of agent templates. Two layers, deduped per-slug, user wins:

| Layer | Where | Mutability |
|---|---|---|
| **Bundled** | `<repo>/assets/agent-vault-defaults/<slug>.md` | Read-only. Visible unless tombstoned. |
| **User** | `~/.apx/agents/<slug>.md` | Read-write. Overrides bundled with same slug. |
| **Tombstones** | `~/.apx/agents/.removed.json` | Bundled slugs the user hid. |

Listing returns `bundled ∪ user`, with `source: "bundled" | "user" | "user-override"`. Editing a bundled entry is **copy-on-write** (materializes into user layer on save). Deleting bundled **tombstones** (restorable); deleting user-only removes the file.

## Bundled starter pack (14 templates)

### Named team (from nicho-apps)

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

`development`, `marketing`, `ops`, `qa`, `support` — plain functional roles without a persona.

Bundled templates ship with `language: es` and **no `model:`** — they inherit the project/global default. Set a model on import or by editing the vault file.

## Commands

```bash
# List (bundled + overrides, tagged [bundled]/[user]/[override])
apx agent vault list
apx agent vault list --all              # include tombstoned

# Create (writes ~/.apx/agents/<slug>.md)
apx agent vault add reviewer \
  --role "Code reviewer" \
  --model ollama:llama3.2:3b \
  --language es \
  --skills code-review,git \
  --description "Reviews PRs and pushes back on hand-wavy diffs."

# Delete: user-only → physical delete; bundled → tombstone
apx agent vault rm tessa-qa
apx agent vault restore tessa-qa        # un-tombstone

# Import into current project
apx agent import cody-developer
apx agent import tessa-qa --copy        # copy into .apc/agents/ for local edits
apx agent import roby-orchestrator --force

# Daemon tool API equivalents:
list_vault_agents()
import_agent({ slug: "cody-developer", project: "<name-or-path>" })
```

## Web equivalents

Agent defaults tab (`/p/0/agent-defaults`): same CRUD — "New" (POST `/agents/vault`), per-card "Edit" (PATCH `/agents/vault/:slug`, copy-on-write for bundled), "Delete"/"Hide" (DELETE), "Show removed" toggle with "Restore" button.

## Which agent to use

- User says **"spawn/use Cody/Rocky/Tessa/Max/Arch/Sid/Vera/Roby/Finn"** → import that exact slug from named team.
- User wants **"developer"/"QA"/"marketing" without a persona** → use generics (`development`, `qa`, `marketing`, …).
- **Not in vault** → `apx agent vault add <slug>` for a new template, or `apx agent add <slug>` directly in a project for a one-off.
- **Fresh install** → bundled defaults are always present (no sync step); appear in `apx agent vault list` immediately.

## File locations

```
<APX repo>/assets/agent-vault-defaults/<slug>.md   ← canonical bundle (committed)
~/.apx/agents/<slug>.md                            ← user vault (sync target)
<project>/.apc/agents/<slug>.md                    ← project-local copy (after import --copy)
```

Vault format = project agent format:

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

<markdown body — system prompt extension>
```

## Frontmatter fields the runtime reads

| Field | Effect |
|---|---|
| `role` | Shown in CLI/web; appears as "Role: …" in prompt. |
| `model` | Default model for engine routing. |
| `description` | Shown in `/agents/vault` and AgentDefaultsTab cards. |
| `language` | Adds "Default language: <code>" to system prompt. |
| `skills` | Per-agent skill names; bodies loaded by skill resolution. |
| `tools` | Tool hints; actual callable tools depend on invocation surface. |
| `is_master` | If true, marked master in project (badge + ordering). |

## Related skills

- **[apx-agent](../apx-agent/SKILL.md)** — per-project agent CRUD. Vault = library; this = workshop.
- **[apx-runtime](../apx-runtime/SKILL.md)** — delegating to external coding CLIs from inside an agent.

## Gotchas

- **Bundled defaults are always present** — no sync step. Removing tombstones; editing copies to user layer.
- Slug is `roby-orchestrator`, **not** `roby` — the APX super-agent persona is "Roby" via `~/.apx/identity.json`. A project agent called `roby` would shadow it.
- The `agency-agents` skill in `~/.claude/skills/` pulls from `msitarzewski/agency-agents` on GitHub. APX bundles a snapshot in `assets/agent-vault-defaults/` so installs are offline-first. To refresh upstream, edit the bundle and re-commit; user overrides are untouched.
