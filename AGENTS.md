# AGENTS.md — dev guide for the apx codebase

> Hand-maintained guide for working **on** apx itself (read by Codex, Claude Code,
> and any AGENTS.md-aware tool). APX never regenerates this file — it's created at
> `apx init` and owned by the project. End-user app usage lives in `docs/`.

## Repo layout

- `src/core/` — engine-agnostic core:
  - `agent/` — `super-agent.js` (daemon action loop), `run-agent.js` (tool loop), `build-agent-system.js`, `prompt-builder.js`, `model-router.js`, `retry.js`, `self-memory.js`, `memory.js`; `prompts/` (channels/*, modes/voice, super-agent-base, action-discipline); `skills/` (catalog, loader, trigger, rag, **inspector**, index-store); `tools/` (registry + `handlers/`, one file per tool)
  - `apc/` (scaffold, AGENTS.md parser, skill-sync), `config/` (index + paths), `engines/` (per-provider adapters + `_health`/`_streaming`), `mcp/`, `memory/`, `identity/`, `stores/`, `constants/` (channels, permissions, roles, actors — never inline literals), `confirmation/`, `desktop/`, `runtime-skills/`, `voice/`, `util/`
- `src/host/daemon/` — thin **adapter** over `core/`: HTTP API (`api/*.js` mounted by `buildApi`), plugins (`telegram/`, `desktop/`), WebSocket hubs, runtimes. **No domain logic here** — if an `api/*` file is more than body→core→response, move the work into `core/`.
- `src/interfaces/` — `cli/`, `web/` (React + Vite admin panel, isolated pnpm workspace), `tui/`, `desktop/` (Electron floating voice window), `mcp-server/` (stdio MCP exposing APX to other LLMs — distinct from `apx mcp …` which consumes MCPs).
- `tests/` — backend suite (Node test runner). `src/interfaces/web/e2e/` — Playwright.
- `skills/` — bundled `SKILL.md`s. `scripts/` — build-web, sync, git hooks. `docs/` — public docs site (Astro + Starlight, bilingual; self-contained, not in the npm package).

## Project rules

1. **Tests ship with behavior.** Every new route/command/plugin/config key and every bug fix lands with a test in `tests/`. Drive HTTP through `buildApi()` + `app.listen(0)`; build trees with `makeTempProject()`. Anything writing under `~/.apx` must set `process.env.HOME` to a temp dir **before** importing the module. Tests run offline: no network, no keys, no live daemon.
2. **Gate every push with `npm run preflight`** (backend tests + web build + `tsc --noEmit`). The pre-push hook enforces it — don't bypass.
3. **No secrets in the repo.** Tokens live in runtime scope only (`apx mcp add --scope runtime`); `.apc/mcps.json` holds non-secret hints. Runtime state (conversations, sessions, message logs, config, tokens) stays under `~/.apx/`. **Never commit command output/logs** — `apx config show --effective`, `apx status`, etc. can dump engine `api_key`s and the Telegram bot token. Scrub or gitignore any captured output.
4. **"super-agent" is a mode, not a persona name.** User-facing copy uses `~/.apx/identity.json` (default "APX"); config keys/routine kinds may still say `super_agent`.
5. **Respect backward-compat shims.** The `overlay`→`desktop` rename keeps `config.overlay`, `/overlay/ws`, and `apx overlay` working — don't reintroduce old names or break the shims (they're tested).
6. **Skills stay in sync.** When you change CLI commands, routes, config keys, or behavior documented in a skill, update the matching `skills/<slug>/SKILL.md` in the same change. Verify flags with `apx <command> --help` — don't invent subcommands.
7. **Imports use `#aliases`, not `../../../`.** `#core/*`→`src/core/*`, `#host/*`, `#interfaces/*` (package.json `imports`; mirrored in `jsconfig.json`). Same-folder neighbors stay relative.
8. **One domain function — one home.** When an operation exists in both an `api/<x>.js` route and a CLI `commands/<x>.js`, the logic belongs in `core/` (usually `core/stores/<x>.js`). API and CLI are adapters: parse input, call core, shape output. Model: **core → adapter → surface**.
9. **Adding a daemon route.** Export `register(app, ctx)` from `api/<x>.js`, mount in `buildApi()` before the 404 catch-all, return `{ error }` + a real status code. **Footgun:** add the path prefix to `API_PREFIXES` in `api/shared.js`, or an authenticated GET is mistaken for an SPA asset and served without auth. (The SPA fallback in `api/web.js` returns 404 for unknown non-API routes — keep `isKnownSpaRoute` in sync with the `<Routes>` registry.)
10. **Adding a CLI command.** Write `cmd<Name>(args)` in `commands/<x>.js`, add a `case` in the `dispatch()` switch in `cli/index.js`, register a `topic({…})` in the help. `parseArgs` yields `{ _: [positionals], flags }`. Every command prints an `apx vX` mark (header/banner via `branding.js`; `--version`/`update`/`init` get the big banner). Reach the daemon via the `http` helper (auto-starts it).
11. **Web panel = Base UI, hand-built.** No Radix/shadcn/installers — primitives in `components/ui/*` behind `components/ui.tsx`. All requests go through `src/lib/api/*` (bearer auto-fetched from `/admin/web-token`). Every string in **both** `i18n/en.ts` and `i18n/es.ts` under the same key. New screens/modules get a Playwright spec in `e2e/`.
12. **Channel rules live in ONE place; watch the prompt budget.** Per-channel formatting goes in `prompts/channels/<ch>.md` (+ `modes/voice.md`) — never inline in callers. `super-agent-base.md` ships every turn on every channel — keep it lean (~2.5k tok). Measure with `node scripts/inspect-channel-prompts.js`. Don't recite a tool catalog (the runtime sends real schemas); operational syntax belongs in on-demand `apx-*` skills.
13. **No hardcoded paths or identity/channel/permission strings.** Paths from `core/config/` (`APX_HOME`, `CONFIG_PATH`, `projectStorageRoot()`); channels from `constants/channels.js`, permission modes from `constants/permissions.js`, actor ids from `constants/actors.js`. Read/write global config only via `readConfig()`/`writeConfig()` — `writeConfig` refuses to silently clear credentials (`CREDENTIAL_PATHS`); pass `_allowClear:true` for an intentional reset. Per-project overrides in `.apc/config.json`, deep-merged via `effectiveConfig()` (arrays replace, don't merge).
14. **ESM + pnpm.** `"type":"module"`, Node ≥18: explicit `.js` imports, no `__dirname` (use `fileURLToPath(import.meta.url)`). **pnpm only**. Only `src/`, `skills/`, `README.md` ship to npm.

## Conventions & recipes

- **Model ids are `provider:model`** (`ENGINE_IDS` = anthropic/openai/groq/openrouter/ollama/gemini/mock). Add an engine: `src/core/engines/<id>.js` exporting `chat()`/`health()`, register in `ADAPTERS`. Degrade chain: `super_agent.model_fallback.models` (ordered full ids). The router (`model-router.js`) health-checks the chain and picks the first healthy; at call time `retry.js` rotates on retryable errors (429/5xx/timeout) but treats 4xx/auth as fatal.
- **Add an external runtime** (claude-code/codex/opencode/aider/cursor-agent/gemini-cli/qwen-code): `src/host/daemon/runtimes/<id>.js`, register in `REGISTRY`. These are delegations — the external tool reads `AGENTS.md` itself, so APX does NOT inject the project AGENTS.md for them.
- **MCP scopes** (`core/mcp/`): `runtime` (`~/.apx/projects/<id>/mcps.json`, secrets, chmod 600, never committed) ▶ `apc` (`.apc/mcps.json`, committed, no secrets) ▶ `global` (`~/.apx/mcps.json`). First-by-name wins; secrets go to runtime only.
- **Telegram identity** (`plugins/telegram.js`): global roster keyed by `user_id`, roles owner/contact/guest — unknown senders are guests with no tools. `telegram.channels[]` is canonical; root `bot_token`/`chat_id` are legacy fallbacks.

## Super-agent prompt & channels

Assembled by `buildSuperAgentSystem()` (`prompt-builder.js`), run by `runAgent()` (`run-agent.js`), driven by `runSuperAgent()` (`host/daemon/super-agent.js`). Block order (each dropped when empty): base → user/identity → memory (broker `[RELEVANT MEMORY]` or notebook) → active threads → relationship → channel block + contextNote → projects index → **project AGENTS.md** → skills (hint or inspector) → lazy-tools hint → **voice mode** → suffix. Format directives sit LAST for recency.

- **Project AGENTS.md is loaded** (`buildProjectAgentsBlock`, ≤6k chars) when APX runs its OWN loop inside a project — NOT when it delegates to an external engine (that engine reads it itself).
- **Channels are SURFACES; voice is a MODE.** `CHANNEL_PROMPT_FILES` maps each surface (`telegram, cli, routine, api, web, web_sidebar, web_code, deck, desktop, code`) to `channels/<ch>.md`. There is no `voice` channel — it's `channelMeta.voice` (from `modes/voice.md`); desktop is always voice. Who sets it: telegram plugin, `api/voice.js`, `plugins/desktop.js` (`{voice:true}`), web body (`web`/`web_sidebar`/`web_code`), routines, `apx code`.
- **Lazy tools** (`tools/registry.js`): a small `BASE_TOOL_NAMES` set ships by default; the model pulls the rest in via `discover_tools({category|names})` to fit cheap-tier TPM caps. (This replaced the old per-channel CORE/FULL split.)
- **Skills are reached on demand.** Default: `buildSkillsHintBlock` (slugs-only hint) + `list_skills`/`load_skill` tools, plus `/slug` trigger and semantic RAG nudge. **Opt-in Skill Inspector** (`skills/inspector.js`, `config.skills.inspector.enabled`): per-turn embeddings RAG injects the matching skill body/hint and suppresses the static slug dump. Embedder chain ollama→gemini→openai→tf.
- **Chit-chat protection** (`prompts/action-discipline.md`, in both project-agent and super-agent prompts): call `finish` on pure greetings/thanks instead of hallucinating a tool.

## Memory, RAG & cross-channel store

- **Embeddings provider is configurable** (`memory.embeddings`, registry at `core/memory/embed-engines/`: ollama/openai/gemini/tf). `embedOne/embedBatch` resolve via `selectEmbedEngine`, fall back to `tf` on error. Switching provider/model changes the embedder space → run `POST /embeddings/reindex` after a switch.
- **The cross-channel message store is the spine.** Every surface logs turns to `~/.apx/messages/<channel>/YYYY-MM-DD.jsonl` via `appendGlobalMessage({channel, ...})`. Feeds the RAG indexer, `search_messages`, and the `# Active threads` block — a channel that doesn't log is invisible cross-channel.
- **Progressive compaction** (`core/memory/compactor.js`): fire-and-forget once a chat passes `memory.compact_threshold`; summarizes the oldest into a `type:"compact"` record (light `compact_model`), keeps `keep_recent` verbatim.
- **Vector store is dual-backend + lazy** (`store.js`): tries sqlite-vec (`~/.apx/memory.db`), falls back to a pure-JS JSON store on any load failure. Indexer is incremental (cursor at `~/.apx/memory-cursor.json`), reconciles embedder family changes, broker hard-capped at `memory.broker_budget_ms`. Tests: `memory-rag` + `memory-compaction` (offline: force-TF/force-JSON/mock/temp HOME).

## Desktop module (floating voice window)

`apx desktop` — tray-resident Electron capsule (hotkey ⌘G/Ctrl+G), renamed from `apx overlay` (rule 5). Lives in `src/interfaces/desktop/` (`main.js`/`preload.js`/`renderer.js`, vanilla JS — NOT React), wired by `plugins/desktop.js`, `desktop-ws.js`, `api/desktop.js`.

- **Boot:** `apx desktop start` → `commands/desktop.js` (`findElectron()` cascade; for autostart the `node node_modules/electron/cli.js` branch wins under launchd's minimal PATH). Wrapper spawns Electron `detached`+`unref`. `main.js` reads `desktop.*` config, registers shortcuts, connects WS to `/desktop/ws` **with a bearer token** (the upgrade handler authenticates it — see `desktop-ws.js`).
- **State machine** (renderer): `idle | listening | transcribing | thinking | speaking`. Non-streaming models send one `done` with no tokens → inject final text immediately; TTS is fire-and-forget. Production guards (double-`done`, regen, conv-card height, webm chunked transcription) are documented inline in `renderer.js` — read the comments before touching it.
- **Identity name:** `identity.json agent_name` → `super_agent.name` → "Superagente" (via `resolveAgentName()`); don't invert.
- **Autostart** (`apx desktop install/uninstall`): launchd plist / HKCU Run / `.desktop`. `ProgramArguments` MUST be `process.execPath` + absolute CLI script (never a shim — launchd PATH ENOENTs `exec node`).
- **Out of scope:** `apx voice` (CLI TTS) and `voice.*` keys; whisper/STT (`transcription.js`). The desktop is a consumer, not an owner.

## Docs site

`docs/` — Astro 6 + Starlight, self-contained, bilingual (EN at `src/content/docs/<section>/`, ES at `…/es/<section>/` with the same slug — edit both). Base path `/apx`; internal links absolute with trailing slash. Screenshots are placeholder `<Screenshot/>` components (files using it must be `.mdx`). GFM-in-MDX needs the explicit `remarkGfm` in `astro.config.mjs` — don't remove it. **Read `docs/AUTHORING.md` first.** Not wired into preflight — build explicitly (`cd docs && pnpm build`) when you touch it.

## Agents (dogfood)

apx registers itself as an APC project with demo agents in `.apc/agents/` (cody, doc, ops) to exercise multi-engine routing. Source of truth per agent is `.apc/agents/<slug>.md`; this root `AGENTS.md` is not regenerated from them.
