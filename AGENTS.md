# Agents

> Auto-generated from .apc/agents/*.md — edit individual agent files, not this file.
> Read by Codex, Antigravity, and other tools that follow the AGENTS.md convention.
## cody
- **Role**: code refactor
- **Model**: claude-sonnet-4.5

## doc
- **Role**: docs writer
- **Model**: gpt-5

## ops
- **Role**: infra & servers
- **Model**: gemini-2.5-pro

## Project rules

1. Agent definitions live in `.apc/agents/<slug>.md`. This file is regenerated for discovery; edit the per-agent files, not the `## <slug>` blocks here.
2. Curated durable facts belong in `.apc/agents/<slug>/memory.md` — never raw transcripts or secrets.
3. Runtime sessions, conversations, and message logs stay outside the repo (`~/.apx/projects/<id>/` or the engine that created them).
4. Shared MCP hints without secrets: `.apc/mcps.json`. Tokens: runtime scope only (`apx mcp add --scope runtime`).
5. Reusable instructions: `.apc/skills/<slug>/SKILL.md` (project) or bundled `skills/<slug>/SKILL.md` in the APX package.
6. **Skills stay in sync**: when you change CLI commands, daemon routes, config keys, Telegram/voice/routine behavior, or any workflow documented in a skill, update the matching `skills/<slug>/SKILL.md` (or `.apc/skills/<slug>/SKILL.md`) in the **same change**. Verify flags with `apx <command> --help` before documenting them — do not invent subcommands.
7. **"super-agent" is a mode, not a persona name**. User-facing copy uses the identity from `~/.apx/identity.json` (default "APX"). Technical config keys and routine kinds may still say `super_agent`.
8. **Tests ship with behavior**. Every new daemon route, CLI command, plugin, or config key — and every bug fix — lands with a test in `tests/<name>.test.js` (Node's built-in runner; `npm test`). Patterns: drive HTTP routes through `buildApi()` + an ephemeral `app.listen(0)`; build project trees with `makeTempProject()` from `tests/_helpers.js`. Anything that writes under `~/.apx` must be isolated — set `process.env.HOME` to a temp dir **before** dynamic-importing the module (APX_HOME derives from `os.homedir()`); never touch the real store. Tests must run offline (no network, no API keys, no live daemon).
9. **Gate every push with `npm run preflight`** (backend tests + web build + `tsc --noEmit`) — it must be green. The pre-push hook enforces this; don't bypass it.
