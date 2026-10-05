# Agent templates

What the Team screen's "Import" dialog offers, beside the owner's v1 vault (`~/.apx/agents`, read-only).

- A folder with `TEAM.md` is a team: its frontmatter gives the `name` and `description`, and every `<slug>.md` beside
  it is a member, written in the same format as `.apc/agents/<slug>.md`. A member without a `parent` inside the team
  is its lead.
- A loose `<slug>.md` here is a single agent. Every team member is also offered on its own.
- `area:` groups agents in the Team view.
- `<slug>.routines.json` beside an agent: the routines it comes with (`name`, `schedule` as `{ "kind": "cron", "cron" }`
  or `{ "kind": "every", "minutes" }`, `prompt`, optional `action` `agent` or `watch`). Installing the agent adds them
  to the project, on; the executive team ships its weekly rituals this way. Templates are written in English only.

Installing copies the file into the project's `.apc/agents/` as written; only `parent` changes (to hang the team under
the project's orchestrator when the owner asks).
