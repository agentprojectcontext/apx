# AGENTS.md — developer guide for the apx codebase

> Hand-maintained. This is the dev guide for working **on** apx itself — read by
> Codex, Claude Code, Antigravity, and any tool that follows the AGENTS.md
> convention. apx dogfoods itself as an APC project, but its scaffold generator
> deliberately skips this file (see `isApxSourceRepo` in `src/core/scaffold.js`),
> so edit it freely and keep adding project rules below.

## Repo layout

- `src/core/` — engine-agnostic core: prompt building, memory/RAG, parser, config, scaffold.
- `src/host/daemon/` — the daemon: HTTP API (`api/*.js` mounted by `buildApi`), plugins (telegram, desktop), super-agent loop, WebSocket hubs, stores.
- `src/interfaces/` — `cli/`, `web/` (React + Vite admin panel), `tui/` (OpenTUI + Solid), `desktop/` (Electron floating voice window), `mcp-server/` (stdio MCP).
- `tests/` — backend suite (Node's built-in test runner). `src/interfaces/web/e2e/` — Playwright.
- `skills/` — bundled `SKILL.md` instructions. `scripts/` — build-web, sync, git hooks.

## Project rules

1. **Tests ship with behavior.** Every new daemon route, CLI command, plugin, or config key — and every bug fix — lands with a test in `tests/<name>.test.js` (`npm test`). Patterns: drive HTTP routes through `buildApi()` + an ephemeral `app.listen(0)`; build project trees with `makeTempProject()` from `tests/_helpers.js`. Anything that writes under `~/.apx` must be isolated — set `process.env.HOME` to a temp dir **before** dynamic-importing the module (APX_HOME derives from `os.homedir()`); never touch the real store. Tests must run offline: no network, no API keys, no live daemon.
2. **Gate every push with `npm run preflight`** (backend tests + web build + `tsc --noEmit`). It must be green; the pre-push hook enforces it — don't bypass it.
3. **Skills stay in sync.** When you change CLI commands, daemon routes, config keys, Telegram/voice/routine behavior, or any workflow documented in a skill, update the matching `skills/<slug>/SKILL.md` (or `.apc/skills/<slug>/SKILL.md`) in the **same change**. Verify flags with `apx <command> --help` before documenting — don't invent subcommands.
4. **"super-agent" is a mode, not a persona name.** User-facing copy uses the identity from `~/.apx/identity.json` (default "APX"). Technical config keys and routine kinds may still say `super_agent`.
5. **Respect backward-compat shims.** The `overlay`→`desktop` channel rename keeps legacy paths working (`config.overlay` fallback, `/overlay/ws`, `apx overlay` forwarding). Don't reintroduce the old names and don't break the shims — they're covered by tests.
6. **No secrets in the repo.** Tokens live in runtime scope only (`apx mcp add --scope runtime`); shared MCP hints without secrets go in `.apc/mcps.json`. Runtime sessions, conversations, and message logs stay outside the repo (`~/.apx/...`).

## Agents (dogfood)

apx registers itself as an APC project with demo agents in `.apc/agents/` (cody, doc, ops) used to exercise multi-engine routing. Those are fixtures — the source of truth for each is `.apc/agents/<slug>.md`. This root `AGENTS.md` is **not** regenerated from them.
