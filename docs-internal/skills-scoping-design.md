# Skills enable/disable + private scoping — design

Branch: `feat/skills-scoping`

## Problem
The web `/settings/skills` tab ("Skills (RAG)") only exposes the **Skill Inspector
RAG** config — it never lists the actual skills, has no enable/disable, no way to
add new skills, and no notion of "private" built-in skills. Users can't scope
which skills load for the super-agent vs. per project.

## Current state (verified)
- Discovery: `src/core/agent/skills/loader.js` → `listSkills()` scans, in priority:
  1. `<project>/.apc/skills/` (source `project`)
  2. `~/.apx/skills/` (source `global`)
  3. `src/core/runtime-skills/` (source `builtin` — 18 shipped apx-*/apc/cli skills)
- Injection into the super-agent happens 3 ways:
  1. Static hint block `buildSkillsHintBlock(listSkills)` (prompt-builder.js) — lists ALL slugs.
  2. Skill Inspector RAG (`inspector.js`) when `config.skills.inspector.enabled`.
  3. Agent tools `list_skills` / `load_skill`.
- No enable/disable anywhere. No per-project scoping of *which* skills exist.
- `builtin` skills are already immutable on disk (can't be deleted).

## Design

### Config (`~/.apx/config.json`)
```jsonc
"skills": {
  "inspector": { ... },            // unchanged
  "policy": {
    "default": { "<slug>": false },              // super-agent / no-project scope
    "<projectPath>": { "<slug>": true|false }    // per-project overrides
  }
}
```
`policy[scope][slug]` is a boolean override. Absent = inherit. Denylist-friendly:
empty config = every skill enabled (today's behavior), so it's backward compatible.

### Effective-enabled resolution `isSkillEnabled(skill, {config, projectPath})`
1. `source === "builtin"` → **always true** (private, locked in UI).
2. project scope has explicit value → use it.
3. `default` scope has explicit value → use it.
4. otherwise → true.

Super-agent with no project uses scope key `"default"`. Talking to the super-agent
*inside a project folder* uses that project's path as scope (matches "si hablo con
Roby en una carpeta de proyecto, esa skill no se carga").

### Private / built-in skills
`source === "builtin"` are APX's own skills (apx, apx-mcp, apc-context, cli docs…).
Always active, never disableable, never deletable — shown locked with a "Private"
badge (Codex-style). Only `global` (user-installed) and `project` skills toggle.

### Gating chokepoints (backend)
New `src/core/agent/skills/policy.js`:
- `isPrivateSkill`, `resolveScopeKey`, `isSkillEnabled`, `filterEnabledSkills`,
  `annotateSkills`, `setSkillEnabled`.
Applied at:
1. `super-agent.js` — hint block lister filtered by policy + channelMeta.projectPath.
2. `tools/handlers/list-skills.js` — filter result by policy.
3. `tools/handlers/load-skill.js` — refuse a disabled (non-private) slug.
4. `skills/inspector.js` — drop disabled candidates before pick/render.

### API (`host/daemon/api/skills.js`)
- `GET /skills?project_path=&scope=` → skills annotated with `enabled`, `private`,
  `overridden`; plus `scope` echoed back.
- `PUT /skills/enabled` `{ slug, enabled: bool|null, scope }` → set/clear override.
- `POST /skills` `{ slug, description, body }` → create a global skill under
  `~/.apx/skills/<slug>/SKILL.md`.
- `DELETE /skills/:slug` → remove a global skill (never builtin/project).

### Web (`/settings/skills`)
Tab renamed "Skills". New `SkillsPanel`:
- Scope selector: Super-agent (global) + each project.
- Skill list with source badge + per-skill switch; private → locked + badge.
  Project scope shows inherit/override with a reset-to-global control.
- "Add skill" form (slug + description + body) and delete on user skills.
- Skill Inspector (RAG) kept as a secondary/collapsible section.
