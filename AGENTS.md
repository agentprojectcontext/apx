# AGENTS.md — dev guide for the apx codebase

> Hand-maintained guide for working **on** apx itself (read by Codex, Claude Code,
> and any AGENTS.md-aware tool). APX never regenerates this file — it's created at
> `apx init` and owned by the project. End-user app usage lives in `docs/`.

## Glossary — read this before guessing

Several words in this repo mean more than one thing. Picking the wrong sense is
the single most common way work here goes sideways, so they are pinned here.

| Term | In this repo it means | Not to be confused with |
|---|---|---|
| **APC** | Agent Project Context — the open standard: `AGENTS.md` + `.apc/`. | **APX**, this program, which implements it. |
| **engine** | An LLM provider adapter in `core/engines/` (anthropic, openai, groq, openrouter, ollama, gemini, mock). | `runtime`, below. |
| **provider** | The left half of a model id `provider:model`. Same set as the engines. | — |
| **runtime** | An **external coding CLI** APX delegates to (`core/runtimes/`: claude-code, codex, opencode, aider, cursor-agent, gemini-cli, qwen-code, antigravity). | `core/runtime-skills/` (skills loaded at run time — unrelated), and the `runtime` **MCP scope** (`~/.apx/projects/<id>/mcps.json`). Three different senses; check which one the code means. |
| **channel** | A **surface** a turn arrives on: `telegram, cli, routine, api, web, web_sidebar, web_code, deck, desktop, code`. Canonical list in `core/constants/channels.js`. | `mode`, below. There is no `voice` channel. |
| **mode** | *How* a turn is handled, orthogonal to the channel. `voice` is a mode (`channelMeta.voice`); desktop is always voice. `plan`/`build` are code modes. | `channel`. |
| **persona** | The agent's **visible name** (`~/.apx/identity.json` → `agent_name`, default "APX"). | **agent profile**, below. |
| **agent profile** | An installable package that gives the super-agent a line of work (`core/profiles/`, `config.profile`, `apx profile`). | `persona`, and a *config* profile. Always write "agent profile" when the bare word could be misread. |
| **super-agent** | A **mode of operation**, not a name. The agent that runs across channels with the global tool set. | A persona name. Older docs called it Roby, and an older fallback spelled it in Spanish; both are stale — the display name comes from `resolveAgentName()`. |
| **agent vault** | Reusable agent definitions at `~/.apx/agents/`, not tied to one project. | A project's `.apc/agents/`. |
| **broker** | The memory component that assembles the `[RELEVANT MEMORY]` block per turn (`core/memory/broker.js`). | The RAG indexer or the compactor. |
| **inspector** | Opt-in per-turn skill RAG (`core/agent/skills/inspector.js`). | The skills *catalog* or *loader*. |
| **deck** | The tablet/phone dashboard surface. | The desktop capsule. |
| **actor** | Who produced a message (`core/constants/actors.js`). | A channel or a role. |
| **scope** | Where a setting is stored — **and the vocabulary differs per subsystem.** MCPs: `shared\|runtime\|global`. Vars and integrations: `project\|global`. Never merge these; see `normalizeMcpScope` / `normalizeVarScope` / `normalizeIntegrationScope`. | — |

Two more, in code comments rather than names: **"Pieza 2/3/4"** in `core/memory/*`
headers refers to the four parts of the cross-channel memory design (notebook,
RAG, compaction, broker). And `skills/` (3 bundled for npm) is not
`src/core/runtime-skills/` (the ~19 the super-agent actually loads).

## Repo layout

- `src/core/` — engine-agnostic core:
  - `agent/` — `super-agent.js` (daemon action loop), `run-agent.js` (tool loop), `build-agent-system.js`, `prompt-builder.js`, `model-router.js`, `retry.js`, `self-memory.js`, `memory.js`; `loop/` (the collaborators `run-agent.js` orchestrates); `prompts/` (`core/`, `channels/`, `modes/`, `discipline/`); `skills/` (catalog, loader, trigger, rag, **inspector**, index-store, policy); `tools/` (registry + `handlers/`, one file per tool, names in `tools/names.js`)
  - `apc/` (scaffold, AGENTS.md parser, skill-sync), `config/` (index + paths), `engines/` (per-provider adapters + `_health`/`_streaming`), `runtimes/` (external coding CLIs + detect), `sessions/` (cross-engine session discovery), `mcp/`, `memory/`, `identity/`, `stores/`, `constants/` (channels, permissions, roles, actors, scopes — never inline literals), `util/` (incl. `json-file.js`), `confirmation/`, `channels/`, `profiles/`, `routines/`, `integrations/`, `artifacts/`, `deck/`, `desktop/`, `http-tools/`, `i18n/`, `net/`, `vars/`, `runtime-skills/`, `voice/`
- `src/host/daemon/` — thin **adapter** over `core/`: HTTP API (`api/*.js` mounted by `buildApi`), plugins (`telegram/`, `desktop/`), WebSocket hubs. **No domain logic here** — if an `api/*` file is more than body→core→response, move the work into `core/`.
- `src/interfaces/` — `cli/`, `web/` (React + Vite admin panel, isolated pnpm workspace), `tui/`, `desktop/` (Electron floating voice window), `mcp-server/` (stdio MCP exposing APX to other LLMs — distinct from `apx mcp …` which consumes MCPs), `acp/` (Agent Client Protocol, `apx-acp` bin).
  - **The TUI is a deliberate island.** `interfaces/tui/` is a vendored OpenCode fork (~24k lines) that imports `@opencode-ai/*` and makes **zero** `#core/` imports — it reaches APX over HTTP like any other client. "One domain function, one home" does not apply inside it; don't try to wire it to `core/` directly.
- `tests/` — backend suite (Node test runner). `src/interfaces/web/e2e/` — Playwright.
- `skills/` — bundled `SKILL.md`s. `scripts/` — build-web, sync, git hooks. `docs/` — public docs site (Astro + Starlight, bilingual; self-contained, not in the npm package).

## Project rules

1. **Tests ship with behavior.** Every new route/command/plugin/config key and every bug fix lands with a test in `tests/`. Drive HTTP through `buildApi()` + `app.listen(0)`; build trees with `makeTempProject()`. Anything writing under `~/.apx` must set `process.env.HOME` to a temp dir **before** importing the module. Tests run offline: no network, no keys, no live daemon.
   - **No skipped tests. Ever.** `test.skip`/`it.skip`/`describe.skip`/`test.todo` are forbidden — `npm test` must report `skipped 0` and `todo 0`, and CI enforces it. A test that can't run is fixed or deleted with a reason in the commit body.
   - **A bug fix lands with a regression test that fails before the fix.** Say in the commit body which test would have caught it.
   - **Dangerous surfaces are covered.** Any handler that writes files, runs a shell, changes a permission mode, or messages a human needs a direct test.
2. **Gate every push with `npm run preflight`** (lint + backend tests + web build + `tsc --noEmit`). The pre-push hook and the `pull_request` CI workflow both enforce it — don't bypass.
3. **No secrets in the repo.** Tokens live in runtime scope only (`apx mcp add --scope runtime`); `.apc/mcps.json` holds non-secret hints. Runtime state (conversations, sessions, message logs, config, tokens) stays under `~/.apx/`. **Never commit command output/logs** — `apx config show --effective`, `apx status`, etc. can dump engine `api_key`s and the Telegram bot token. Scrub or gitignore any captured output.
4. **"super-agent" is a mode, not a persona name.** User-facing copy uses `~/.apx/identity.json` (default "APX"); config keys/routine kinds may still say `super_agent`.
   - **`persona` ≠ `profile`.** `persona` is the agent's *visible name* (`identity.json.agent_name`) — that meaning is load-bearing here and in `core/identity/self.js`. An **agent profile** (`core/profiles/`, `config.profile`, `apx profile`) is an installable package that gives the super-agent a line of work. Never use one word for the other; write "agent profile" where the bare word could be read as a config profile.
5. **Respect backward-compat shims.** The `overlay`→`desktop` rename keeps `config.overlay`, `/overlay/ws`, and `apx overlay` working — don't reintroduce old names or break the shims (they're tested).
6. **Skills stay in sync.** When you change CLI commands, routes, config keys, or behavior documented in a skill, update the matching `SKILL.md` in the same change. **Look in `src/core/runtime-skills/<slug>/` first** — that's where the ~19 skills the super-agent actually loads live. The 3 under `skills/` are only the bundled ones shipped to npm, and `skills/apc-context/` is synced from upstream (don't hand-edit it). Verify flags with `apx <command> --help` — don't invent subcommands.
   - **Docs stay in sync too.** Any change that alters user-facing behavior — CLI commands/flags, config keys, providers/engines, surfaces (web/desktop/voice/deck), MCP, integrations/connectors, memory, or a new capability — must review `docs/` and update the affected page in the **same** change (both EN `src/content/docs/<section>/<slug>` and ES `…/es/<section>/<slug>`). If a whole feature has no page yet, add one (follow `docs/AUTHORING.md`). Pure internal refactors with no observable change need no docs edit. Build with `cd docs && pnpm build` when you touch it (docs are not in preflight).
7. **Imports use `#aliases`, not `../../../`.** `#core/*`→`src/core/*`, `#host/*`, `#interfaces/*` (package.json `imports`; mirrored in `jsconfig.json`). Same-folder neighbors stay relative.
8. **One domain function — one home.** When an operation exists in both an `api/<x>.js` route and a CLI `commands/<x>.js`, the logic belongs in `core/` (usually `core/stores/<x>.js`). API and CLI are adapters: parse input, call core, shape output. Model: **core → adapter → surface**.
   - **This is machine-enforced.** ESLint `no-restricted-imports` fails the build if `core/` imports `#host/*` or `#interfaces/*`, or if `host/` imports `#interfaces/*`. If core needs something that lives in an adapter, the thing is misfiled — move it into core rather than importing upward.
   - **Before writing a helper, grep for it.** Scope normalization (`core/constants/scopes.js`), frontmatter parsing (`core/apc/frontmatter.js`), project resolution (`core/apc/projects-helpers.js`), JSON file I/O (`core/util/json-file.js`) and `~/.apx` paths (`core/config/paths.js`) each have exactly one home. Adding a second copy is a bug, not a convenience.
9. **Adding a daemon route.** Export `register(app, ctx)` from `api/<x>.js`, mount it in `buildApi()` before the 404 catch-all, return `{ error }` + a real status code. **Every data route lives under `/api`** (`api/prefix.js` — `API_PREFIX`, `isApiPath`, `apiPath`), so route paths are written root-relative and the mount adds the prefix. That is structural, not a list: the old hand-maintained `API_PREFIXES` is gone, and with it the footgun where an authenticated GET got mistaken for an SPA asset. The SPA fallback in `api/web.js` steps aside for `/api` only — keep `isKnownSpaRoute` in sync with the `<Routes>` registry so unknown client routes 404 instead of silently returning 200. Wrap async handlers in `asyncRoute()` (`api/shared.js`) so a rejection becomes a 500 instead of killing the daemon.
10. **Adding a CLI command.** Write `cmd<Name>(args)` in `commands/<x>.js`, add a `case` in the `dispatch()` switch in `cli/index.js`, register a `topic({…})` in the help. `parseArgs` yields `{ _: [positionals], flags }`. Every command prints an `apx vX` mark (header/banner via `branding.js`; `--version`/`update`/`init` get the big banner). Reach the daemon via the `http` helper (auto-starts it).
11. **Web panel = Base UI, hand-built.** No Radix/shadcn/installers — primitives in `components/ui/*` behind `components/ui.tsx`. All requests go through `src/lib/api/*` (bearer auto-fetched from `/api/admin/web-token`). Every string in **both** `i18n/en.ts` and `i18n/es.ts` under the same key. New screens/modules get a Playwright spec in `e2e/`.
12. **Channel rules live in ONE place; watch the prompt budget.** Per-channel formatting goes in `prompts/channels/<ch>.md` (+ `modes/voice.md`) — never inline in callers. `prompts/core/super-agent.md` ships every turn on every channel — keep it lean (~2.5k tok). Measure with `node scripts/inspect-channel-prompts.js`. Don't recite a tool catalog (the runtime sends real schemas); operational syntax belongs in on-demand `apx-*` skills.
13. **No hardcoded paths or identity/channel/permission strings.** Paths from `core/config/` (`APX_HOME`, `CONFIG_PATH`, `projectStorageRoot()`); channels from `constants/channels.js`, permission modes from `constants/permissions.js`, actor ids from `constants/actors.js`. Read/write global config only via `readConfig()`/`writeConfig()` — `writeConfig` refuses to silently clear credentials (`CREDENTIAL_PATHS`); pass `_allowClear:true` for an intentional reset. Per-project overrides in `.apc/config.json`, deep-merged via `effectiveConfig()` (arrays replace, don't merge).
14. **ESM + pnpm.** `"type":"module"`, Node ≥22 (what CI runs and the docs site requires): explicit `.js` imports, no `__dirname` (use `fileURLToPath(import.meta.url)`). **pnpm only**. Only `src/`, `skills/`, `README.md` ship to npm.
15. **The daemon never blocks the event loop on a request path.** New I/O inside a route handler uses `fs/promises`; sync I/O is for boot only. Every async handler goes through `asyncRoute()` so a rejection becomes a 500 instead of killing the process.
16. **Never inline a tool name.** Import from `core/agent/tools/names.js`. A renamed tool must not silently disable a safety check — the side-effect de-duplication that stops a Telegram message being sent three times keys off these names.

## Conventions & recipes

- **Model ids are `provider:model`** (`ENGINE_IDS` = anthropic/openai/groq/openrouter/ollama/gemini/mock). Add an engine: `src/core/engines/<id>.js` exporting `chat()`/`health()`, register in `ADAPTERS`. Degrade chain: `super_agent.model_fallback.models` (ordered full ids). The router (`model-router.js`) health-checks the chain and picks the first healthy; at call time `retry.js` rotates on retryable errors (429/5xx/timeout) but treats 4xx/auth as fatal.
- **Add an external runtime** (claude-code/codex/opencode/aider/cursor-agent/gemini-cli/qwen-code/antigravity): `src/core/runtimes/<id>.js`, register in `REGISTRY`. These are delegations — the external tool reads `AGENTS.md` itself, so APX does NOT inject the project AGENTS.md for them.
- **MCP scopes** (`core/mcp/`): `runtime` (`~/.apx/projects/<id>/mcps.json`, secrets, chmod 600, never committed) ▶ `apc` (`.apc/mcps.json`, committed, no secrets) ▶ `global` (`~/.apx/mcps.json`). First-by-name wins; secrets go to runtime only.
- **Telegram identity** (`plugins/telegram.js`): global roster keyed by `user_id`, roles owner/contact/guest — unknown senders are guests with no tools. `telegram.channels[]` is canonical; root `bot_token`/`chat_id` are legacy fallbacks.

## Web UI (`src/interfaces/web`, React 19 + Vite + Tailwind v4)

- **Run/verify**: `pnpm dev` (port 7431, proxies daemon 7430) hot-reloads; `pnpm build` regenerates `dist/`, which the daemon serves. Verify with `npx tsc --noEmit` — `vite build` does NOT type-check.
- **i18n is es-typed**: `t()` keys derive from `i18n/es.ts` (`TKey = DeepKeys<EsStrings>`). Add every key to BOTH `es.ts` and `en.ts` or `tsc` fails.
- **Tooltips**: wrap the element in `<Tip content={…}>` (`components/ui/tip`), never native `title`. Provider is global in `App.tsx` (delay 0). Leave `<img alt>` alone — that's a11y, not a tooltip.
- **Confirm before acting**: any button that triggers an execution or a destructive change (Run, Delete, rebuild, …) opens a confirm `<Dialog>` (`components/ui`) with a Cancel + action footer (see `RoutinesTab`, `ConfigTab`). Never native `confirm()` or a hand-rolled modal. Show a loading state while the action runs (button `loading`, optimistic row) and revalidate the affected SWR keys after.
- **Componentize screens**: thin screen in `screens/`, its own parts under `components/<feature>/` (e.g. `components/routines/`, `components/code/`).
- **Full-height tabs**: `TabLayout` content is `flex-1 min-h-0 overflow-y-auto`, so use `h-full` + per-pane `overflow-y-auto` (see `ChatTab`, `RoutinesTab`).
- **The web is a GUI over the system — reuse, don't re-implement.** A web feature must call the SAME core/daemon function the CLI uses, never a parallel reimplementation. Before building anything, find the existing function (`core/stores/*`, `commands/*`, an `api/*` route) and wire the UI to it. If the logic lives only inside a CLI command (coupled to console output), extract it to `core/` (or a shared exported helper) so both surfaces call one implementation — per rule 8 (core → adapter → surface). **If no function exists for what's asked, do NOT invent a web-only version: stop, say so, and ask how to proceed — the capability should be added to the daemon/CLI too so terminal and web stay at parity.**

## Super-agent prompt & channels

Assembled by `buildSuperAgentSystem()` (`prompt-builder.js`), run by `runAgent()` (`run-agent.js`), driven by `runSuperAgent()` (`core/agent/super-agent.js`; the HTTP entry point is `host/daemon/api/super-agent.js`). Block order (each dropped when empty): base → user/identity → memory (broker `[RELEVANT MEMORY]` or notebook) → active threads → relationship → channel block + contextNote → projects index → **project AGENTS.md** → skills (hint or inspector) → lazy-tools hint → **voice mode** → suffix. Format directives sit LAST for recency.

- **Project AGENTS.md is loaded** (`buildProjectAgentsBlock`) when APX runs its OWN loop inside a project — NOT when it delegates to an external engine (that engine reads it itself). **The project APX is running inside is never truncated** — a project always reads its own contract whole. A *foreign* project is capped at `super_agent.project_agents_max_chars` (0 = no cap), cut on a line boundary, and the block says how much was dropped.
- **Channels are SURFACES; voice is a MODE.** `CHANNEL_PROMPT_FILES` maps each surface (`telegram, cli, routine, api, web, web_sidebar, web_code, deck, desktop, code`) to `channels/<ch>.md`. There is no `voice` channel — it's `channelMeta.voice` (from `modes/voice.md`); desktop is always voice. Who sets it: telegram plugin, `api/voice.js`, `plugins/desktop.js` (`{voice:true}`), web body (`web`/`web_sidebar`/`web_code`), routines, `apx code`.
- **Lazy tools** (`tools/registry.js`): a small `BASE_TOOL_NAMES` set ships by default; the model pulls the rest in via `discover_tools({category|names})` to fit cheap-tier TPM caps. (This replaced the old per-channel CORE/FULL split.)
- **Skills are reached on demand.** Default: `buildSkillsHintBlock` (slugs-only hint) + `list_skills`/`load_skill` tools, plus `/slug` trigger and semantic RAG nudge. **Opt-in Skill Inspector** (`src/core/agent/skills/inspector.js`, `config.skills.inspector.enabled`): per-turn embeddings RAG injects the matching skill body/hint and suppresses the static slug dump. Embedder chain ollama→gemini→openai→tf.
- **Chit-chat protection** (`prompts/discipline/action.md`, in both project-agent and super-agent prompts): call `finish` on pure greetings/thanks instead of hallucinating a tool.

## Memory, RAG & cross-channel store

- **Embeddings provider is configurable** (`memory.embeddings`, registry at `core/memory/embed-engines/`: ollama/openai/gemini/tf). `embedOne/embedBatch` resolve via `selectEmbedEngine`, fall back to `tf` on error. Switching provider/model changes the embedder space → run `POST /api/embeddings/reindex` after a switch.
- **The cross-channel message store is the spine.** Every surface logs turns to `~/.apx/messages/<channel>/YYYY-MM-DD.jsonl` via `appendGlobalMessage({channel, ...})`. Feeds the RAG indexer, `search_messages`, and the `# Active threads` block — a channel that doesn't log is invisible cross-channel.
- **Progressive compaction** (`core/memory/compactor.js`): fire-and-forget once a chat passes `memory.compact_threshold`; summarizes the oldest into a `type:"compact"` record (light `compact_model`), keeps `keep_recent` verbatim.
- **Vector store is dual-backend + lazy** (`store.js`): tries sqlite-vec (`~/.apx/memory.db`), falls back to a pure-JS JSON store on any load failure. Indexer is incremental (cursor at `~/.apx/memory-cursor.json`), reconciles embedder family changes, broker hard-capped at `memory.broker_budget_ms`. Tests: `memory-rag` + `memory-compaction` (offline: force-TF/force-JSON/mock/temp HOME).

## Desktop module (floating voice window)

`apx desktop` — tray-resident Electron capsule (hotkey ⌘G/Ctrl+G), renamed from `apx overlay` (rule 5). Lives in `src/interfaces/desktop/` (`main.js`/`preload.js`/`renderer.js`, vanilla JS — NOT React), wired by `plugins/desktop.js`, `desktop-ws.js`, `api/desktop.js`.

- **Boot:** `apx desktop start` → `commands/desktop.js` (`findElectron()` cascade; for autostart the `node node_modules/electron/cli.js` branch wins under launchd's minimal PATH). Wrapper spawns Electron `detached`+`unref`. `main.js` reads `desktop.*` config, registers shortcuts, connects WS to `/api/desktop/ws` **with a bearer token** (the upgrade handler authenticates it — see `desktop-ws.js`).
- **State machine** (renderer): `idle | listening | transcribing | thinking | speaking`. Non-streaming models send one `done` with no tokens → inject final text immediately; TTS is fire-and-forget. Production guards (double-`done`, regen, conv-card height, webm chunked transcription) are documented inline in `renderer.js` — read the comments before touching it.
- **Identity name:** `identity.json agent_name` → `super_agent.name` → `SUPERAGENT_DISPLAY_FALLBACK` ("APX", `core/identity/self.js`) via `resolveAgentName()`; don't invert.
- **Autostart** (`apx desktop install/uninstall`): launchd plist / HKCU Run / `.desktop`. `ProgramArguments` MUST be `process.execPath` + absolute CLI script (never a shim — launchd PATH ENOENTs `exec node`).
- **Out of scope:** `apx voice` (CLI TTS) and `voice.*` keys; whisper/STT (`transcription.js`). The desktop is a consumer, not an owner.

## Docs site

`docs/` — Astro 6 + Starlight, self-contained, bilingual (EN at `src/content/docs/<section>/`, ES at `…/es/<section>/` with the same slug — edit both). Base path `/apx`; internal links absolute with trailing slash. Screenshots are placeholder `<Screenshot/>` components (files using it must be `.mdx`). GFM-in-MDX needs the explicit `remarkGfm` in `astro.config.mjs` — don't remove it. **Read `docs/AUTHORING.md` first.** Not wired into preflight — build explicitly (`cd docs && pnpm build`) when you touch it.

## Agents (dogfood)

apx registers itself as an APC project to exercise multi-engine routing. Any project agents live in `.apc/agents/<slug>.md` (that dir is the source of truth); this root `AGENTS.md` is never regenerated from them.
