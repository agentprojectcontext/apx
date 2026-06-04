# 06 — Model per project in wizard

**Priority**: P1
**Size**: S
**Status**: idea

## Problem

Per-project config already exists: `POST /projects/:pid/config` (full replace) and `PATCH /projects/:pid/config` (dotted-key set/unset). The daemon reads `p.config` first and falls back to the global config, so writing `super_agent.model` to a project config already routes that project's calls through a different model.

What's missing: a discoverable way to do it. Today the user has to know the JSON shape and call the PATCH endpoint by hand. No CLI surface, no wizard step.

## Desired UX

```bash
# Inspect
apx project config show iacrmar
apx project config show iacrmar --key super_agent.model

# Set
apx project config set iacrmar super_agent.model groq:llama-3.3-70b-versatile
apx project config set iacrmar super_agent.permission_mode total
apx project config set iacrmar telegram.route_to_agent reviewer

# Unset (back to global default)
apx project config unset iacrmar super_agent.model

# Edit interactively
apx project config edit iacrmar           # opens $EDITOR on the JSON
```

Wizard (`apx project add` or `apx project rebuild`): offer "use a different model for this project? [y/N]". If yes, list available models from `apx engines` + ollama tags and write the override.

## Files to touch

- `src/interfaces/cli/commands/project.js` — add `config` subcommand.
- `src/interfaces/cli/commands/setup.js` — optional follow-up after project registration (could land in a separate "project setup wizard" later).
- No daemon changes — endpoints already exist.
- `tests/project-config-cli.test.js` (new).

## Done criteria

- [ ] `apx project config set iacrmar super_agent.model X` updates `.apc/config.json` (via daemon endpoint).
- [ ] Subsequent calls into that project use the overridden model.
- [ ] `apx project config show iacrmar` shows both `effective` (merged) and `project_only` (file contents).
- [ ] Unset restores global default.
- [ ] Per-project model is reflected in `apx status` per project.

## Owner

Agent B (paralelo — combinado con item 03 que también toca wizard).
