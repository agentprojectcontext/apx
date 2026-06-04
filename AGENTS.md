# AGENTS.md — developer guide for the apx codebase

> Hand-maintained. This is the dev guide for working **on** apx itself — read by
> Codex, Claude Code, Antigravity, and any tool that follows the AGENTS.md
> convention. APX never regenerates `AGENTS.md` (it's created once at `apx init`
> and owned by the project thereafter), so edit it freely and keep adding rules
> below. Note: this is for *developing* APX; end-user app usage is documented in
> `docs/`.

## Repo layout

- `src/core/` — engine-agnostic core: prompt building, memory/RAG, parser, config, scaffold.
- `src/host/daemon/` — the daemon: HTTP API (`api/*.js` mounted by `buildApi`), plugins (telegram, desktop), super-agent loop, WebSocket hubs, stores.
- `src/interfaces/` — `cli/`, `web/` (React + Vite admin panel), `tui/` (OpenTUI + Solid), `desktop/` (Electron floating voice window), `mcp-server/` (stdio MCP).
- `tests/` — backend suite (Node's built-in test runner). `src/interfaces/web/e2e/` — Playwright.
- `skills/` — bundled `SKILL.md` instructions. `scripts/` — build-web, sync, git hooks.
- `docs/` — the public documentation site (Astro + Starlight, bilingual EN/ES). Self-contained: its own `package.json`/`node_modules`, **not** part of the npm package. See the "Docs site" section below.

## Project rules

1. **Tests ship with behavior.** Every new daemon route, CLI command, plugin, or config key — and every bug fix — lands with a test in `tests/<name>.test.js` (`npm test`). Patterns: drive HTTP routes through `buildApi()` + an ephemeral `app.listen(0)`; build project trees with `makeTempProject()` from `tests/_helpers.js`. Anything that writes under `~/.apx` must be isolated — set `process.env.HOME` to a temp dir **before** dynamic-importing the module (APX_HOME derives from `os.homedir()`); never touch the real store. Tests must run offline: no network, no API keys, no live daemon.
2. **Gate every push with `npm run preflight`** (backend tests + web build + `tsc --noEmit`). It must be green; the pre-push hook enforces it — don't bypass it.
3. **Skills stay in sync.** When you change CLI commands, daemon routes, config keys, Telegram/voice/routine behavior, or any workflow documented in a skill, update the matching `skills/<slug>/SKILL.md` (or `.apc/skills/<slug>/SKILL.md`) in the **same change**. Verify flags with `apx <command> --help` before documenting — don't invent subcommands.
4. **"super-agent" is a mode, not a persona name.** User-facing copy uses the identity from `~/.apx/identity.json` (default "APX"). Technical config keys and routine kinds may still say `super_agent`.
5. **Respect backward-compat shims.** The `overlay`→`desktop` channel rename keeps legacy paths working (`config.overlay` fallback, `/overlay/ws`, `apx overlay` forwarding). Don't reintroduce the old names and don't break the shims — they're covered by tests.
6. **No secrets in the repo.** Tokens live in runtime scope only (`apx mcp add --scope runtime`); shared MCP hints without secrets go in `.apc/mcps.json`. Runtime sessions, conversations, and message logs stay outside the repo (`~/.apx/...`).
7. **Docs site stays bilingual + in sync.** Every page in `docs/` exists twice — English at `src/content/docs/<section>/<slug>.md(x)` and Spanish (es-AR, "vos") at `src/content/docs/es/<section>/<slug>.md(x)` with the **same slug**. Add/edit both in the same change. When you change user-facing CLI commands, surfaces, or config, update the affected doc page(s). Read `docs/AUTHORING.md` before authoring — it's the contract for frontmatter, links, and components.
8. **Channel rules live in ONE place; watch the prompt budget.** Per-channel formatting belongs in `src/core/agent/prompts/channels/<ch>.md` (+ `modes/voice.md`) — NOT inline in callers (`api/voice.js` used to duplicate this; don't reintroduce it). The base prompt `super-agent-base.md` ships on **every** turn on **every** channel, so it's the most expensive text in the system — keep it lean (~2.5k tok target). Measure before/after any prompt change with `node scripts/inspect-channel-prompts.js [channel] [--full]`. Don't recite a tool catalog in the prompt (the runtime sends real schemas); operational syntax (cron, ports, flags) belongs in on-demand `apx-*` skills, not always-on.
9. **ESM + tooling baseline.** The package is ESM (`"type":"module"`, Node ≥18): import with explicit `.js` extensions; there is no `__dirname` — derive it via `fileURLToPath(import.meta.url)`. **pnpm only** (`packageManager` is pinned; npm fails). Only `src/`, `skills/`, `README.md` ship to npm (the `files` field) — don't rely on `tests/`/`scripts/` at runtime.
10. **Never hardcode `~/.apx` paths.** Import the constants from `src/core/config.js` (`APX_HOME`, `CONFIG_PATH`, `GLOBAL_MESSAGES_DIR`, `projectStorageRoot()`, …). Read/write global config only via `readConfig()`/`writeConfig()`; `writeConfig` **refuses to silently clear credentials** (`CREDENTIAL_PATHS`: engine/TTS/embeddings `api_key`s, `telegram.channels`) — pass `_allowClear:true` for an intentional reset. Per-project overrides live in `.apc/config.json`, deep-merged via `effectiveConfig()` (arrays replace, they don't merge).
11. **Adding a daemon API route.** Export `register(app, ctx)` from `src/host/daemon/api/<x>.js` and mount it in `buildApi()` (`api.js`) **before** the 404 catch-all; return errors as `{ error }` + a real status code; `ctx` carries `projects`, `plugins`, `config`, `token`, resolvers, etc. **Footgun:** add the path prefix to `API_PREFIXES` in `api/shared.js`, or an authenticated GET route is mistaken for an SPA asset and served **without** auth.
12. **Web panel = Base UI, hand-built.** No Radix/shadcn/installers — primitives live in `src/interfaces/web/src/components/ui/*` behind the `components/ui.tsx` facade (CVA variants). All requests go through `src/lib/api/*` (bearer auto-fetched from `/admin/web-token`); no raw `fetch`. Every user-facing string exists in **both** `i18n/en.ts` and `i18n/es.ts` under the same key. The web is an **isolated pnpm workspace** (its own `node_modules`) — a root install doesn't cover it; its `tsc --noEmit` is part of `preflight`. New screens/modules get a Playwright spec in `e2e/`.

## Conventions & recipes

Where state lives and how to extend the system. **Runtime state never lives in the repo** — conversations, sessions, message logs, config, tokens and MCP secrets all live under `~/.apx/` (git-ignored).

- **Model ids are `provider:model`** (`resolveProvider` in `src/core/engines/index.js`; known providers in `ENGINE_IDS` = anthropic/openai/groq/openrouter/ollama/gemini/mock). **Add an engine:** create `src/core/engines/<id>.js` exporting `chat()`/`health()`, register it in the `ADAPTERS` map. The global degrade chain is `super_agent.model_fallback.models` (ordered array of full ids).
- **Add an external runtime** (claude-code/codex/opencode/aider/cursor-agent/gemini-cli/qwen-code): create `src/host/daemon/runtimes/<id>.js` and register it in the `REGISTRY` (`runtimes/index.js`, validated by `getRuntime`). The daemon injects the APC hint (`apc-runtime-context.js → buildApfHint`) and opens/closes a session around the run. These are **delegations** — the external tool reads `AGENTS.md` itself, so APX does NOT inject the project AGENTS.md for them (see the super-agent section).
- **Add a CLI command:** write `cmd<Name>(args)` in `src/interfaces/cli/commands/<x>.js`, add a `case` in the `dispatch()` switch in `cli/index.js`, and register a `topic({…})` in `HELP_TOPICS`. `parseArgs` yields `{ _: [positionals], flags }`. Renames use a deprecation line + `case` fall-through (see `overlay`→`desktop`). Commands reach the daemon via the `http` helper (auto-starts it).
- **MCP scopes** (`src/core/mcp/`): `runtime` (`~/.apx/projects/<id>/mcps.json`, holds secrets, `chmod 600`, never committed) ▶ `apc` (`.apc/mcps.json`, committed, **no secrets**) ▶ `global` (`~/.apx/mcps.json`). First-by-name wins. Secrets go to runtime scope only.
- **Telegram identity** (`plugins/telegram.js`): a global roster keyed by `user_id` with roles owner/contact/guest — unknown senders are **guests with no tools** until added. Multi-channel `telegram.channels[]` is canonical; the root `bot_token`/`chat_id` are legacy read-only fallbacks.

## Super-agent system prompt & channels

The super-agent prompt is assembled by `buildSuperAgentSystem()` in `src/core/agent/prompt-builder.js`, executed by the tool loop `runAgent()` in `src/core/agent/run-agent.js`, both driven by `runSuperAgent()` in `src/host/daemon/super-agent.js`. Block order (each dropped when empty): base → `# User & identity` → memory broker `[MEMORIA RELEVANTE]` (or notebook) → `# Hilos activos` → relationship → permission → channel block + contextNote → projects index → **project AGENTS.md** → skills catalog → **voice mode** → systemSuffix. Format directives (voice mode, suggestions suffix) sit LAST for recency.

- **Project AGENTS.md is loaded into the prompt** (`buildProjectAgentsBlock`) whenever APX runs its OWN loop inside a project — like Claude/Codex load CLAUDE.md/AGENTS.md. It reads `<projectPath>/AGENTS.md` from `channelMeta.projectPath` (set by `resolveSuperAgentContext` in `api/shared.js`, `api/code.js`, `routines.js`, and the telegram plugin's `buildTelegramMeta`), size-capped to `PROJECT_AGENTS_MAX_CHARS` (6k). It is NOT injected when APX delegates to an external engine (`buildAgentSystem` / per-agent `api/exec.js`) — that engine reads AGENTS.md itself. APX never regenerates a project's AGENTS.md; it's created once at `apx init` and owned by the user (agents live in `.apc/agents/<slug>.md`, not in AGENTS.md).

- **Channels are SURFACES; voice is a MODE.** `CHANNEL_PROMPT_FILES` maps each surface to a `channels/<ch>.md`: `telegram, terminal, cli, routine, api, web, web_sidebar, deck, desktop`. There is **no** `voice` or `overlay` channel — `voice` is a modifier injected via `channelMeta.voice` (or legacy `channel === "voice"`) from `modes/voice.md`. `api/voice.js` maps incoming `"voice"`→deck+voice, `"deck"`→deck, `"desktop"`→desktop+voice.
- **Who sets the channel string:** telegram plugin → `"telegram"`; `api/voice.js /voice/turn` → deck/desktop; `plugins/desktop.js` → `"desktop"` + `{voice:true}`; web front sends `channel` in the request body (`useChat.ts` → `"web"`, `RobyBubble.tsx` → `"web_sidebar"`), resolved by `resolveSuperAgentContext` in `api/shared.js` (defaults to `"api"`); routines → `"routine"`.
- **Tool subset per channel** (`schemasForChannel` in `super-agent-tools/index.js`): FULL registry (47) for `routine`/`api`/`web`; CORE subset (14, `CORE_TOOL_NAMES`) for `telegram`/`web_sidebar`/`deck`/`desktop` to fit cheap-tier TPM caps. The model pulls more in via `load_skill`. Telegram can further restrict via `allowedTools` (role gating).
- **Telegram heads-up:** `plugins/telegram.js` sends ONE localized "estoy con eso 🛠️" on the first `tool_start` IF the agent emitted no preamble (`streamedCount === 0`), because the user sees only prose, never tool calls. `assistant_text` events already stream as separate messages; tool events are logged but never sent to telegram.
- **Skills catalog** is condensed by `condenseSkillDescription` (slug + first sentence, trigger-list tails stripped) — descriptions are authored for Claude Code's matcher, so their "Trigger on:/Activate when:" tails are noise in-prompt.

## Memory, RAG & cross-channel store

- **Embeddings provider is configurable** (mirrors TTS/STT). Registry at `src/core/memory/embed-engines/` (`ollama`/`openai`/`gemini`/`tf`) selected like `voice/engines`. Config: `memory.embeddings { provider:"auto"|id, mode:"chain"|"single", order, ollama{model,base_url}, openai{api_key,model,base_url}, gemini{api_key,model} }`. `embeddings.js` `embedOne/embedBatch` resolve via `selectEmbedEngine` and fall back to `tf` on any error. Legacy flat `memory.embed_*` keys still honored (back-compat shim). Routes: `GET /embeddings/providers`, `POST /embeddings/test`, `POST /embeddings/reindex`. Web UI: Settings → "Memoria (RAG)" (`MemoryPanel.tsx`). **Switching provider/model changes the embedder space** → cosine only matches within one embedder; run `/embeddings/reindex` (clears `memory.db` + cursor, re-embeds) after a switch, or old rows go dormant.
- **Cross-channel message store is the spine.** Human turns from every surface log to `~/.apx/messages/<channel>/YYYY-MM-DD.jsonl` via `appendGlobalMessage({channel, direction, type, body, ...})` (object arg — a positional-string call is the old desktop bug). Writers: telegram plugin, `api/super-agent.js` (`logWebTurn`, web/web_sidebar only — not generic `api`), `api/voice.js` (deck/desktop), `plugins/desktop.js`. This store feeds the RAG indexer, `search_messages`, AND the active-threads block, so a channel that doesn't log is invisible cross-channel.
- **`# Hilos activos en otros canales`** (`src/core/memory/active-threads.js`, `buildActiveThreadsBlock`): pure-recency awareness — last meaningful turn from each channel ≠ current, within `memory.active_threads.window_hours` (default 6, `max_lines` 3, enabled). Complements the semantic broker (which needs a topical query or a `remember`ed note). Built in `runSuperAgent` (skipped for routine/noTools), injected after the broker block. Takes an optional `messagesDir` for tests.
- **Progressive compaction keeps context bounded.** `src/core/memory/compactor.js` `compactChannelIfNeeded()` fires **fire-and-forget** from the telegram plugin (zero reply latency): once a chat passes `memory.compact_threshold` (60) turns it summarizes the oldest into a `type:"compact"` JSONL record (light LLM `memory.compact_model` = `ollama:gemma4:31b-cloud`, blank `compact_fallback_model` → `super_agent.model`), keeping the last `memory.keep_recent` (40) verbatim. The reader `getRecentChannelTurnsFromFs()` in `messages-store.js` prepends that summary as a `role:"system"` `[RESUMEN COMPACTADO turnos a-b]` turn (folded to `user` by the Anthropic adapter, passed through by Ollama), coalesces consecutive same-role turns, and **includes tool results** truncated to 400 chars (`[tool result: <tool>]`). `type:"compact"` was added to the message-type/actor-kind enums; the body + range live in `meta` (`covers_until_ts`, `range`, `count`).
- **Vector store is dual-backend + lazy.** `store.js` `openMemoryStore()` tries sqlite-vec (`better-sqlite3` + `sqlite-vec`, both **optionalDependencies**) at `~/.apx/memory.db`; on ANY load failure it falls back to a pure-JS `JsonStore` (brute-force cosine, `~/.apx/memory-index.jsonl`) — the daemon never hard-depends on a native build. `APX_MEMORY_FORCE_JSON=1` forces the JSON backend (tests use it).
- **Indexer is incremental + self-healing.** `indexer.js` only embeds messages newer than `~/.apx/memory-cursor.json` (per-channel ts), skips trivial turns (`meaningfulBody`: <12 chars / <2 word-tokens / `/reset`), and is wrapped by an in-flight lock (`indexOnce` in `index.js`) so a slow re-embed can't overlap the 60s timer. It records the active embedder family and reconciles automatically: **tf→ollama** (Ollama came back) → full re-index; **ollama→tf** (Ollama down) → skip the pass, never polluting a good nomic store with TF rows. This is the automatic counterpart to the manual `/embeddings/reindex` route above. The broker is hard-capped at `memory.broker_budget_ms` (800ms) — on timeout it returns whatever the notebook gave it, never blocking the reply. Tests: `tests/memory-rag.test.js` + `tests/memory-compaction.test.js`, fully offline (force-TF / force-JSON / mock engine / temp HOME).

## Desktop module (the floating voice window)

`apx desktop` is a tray-resident Electron capsule the user invokes with a
global hotkey (default ⌘G / Ctrl+G). It's the renamed `apx overlay` — see
rule 5 above for the back-compat contract. Lives in
`src/interfaces/desktop/` (`main.js` / `preload.js` / `renderer.js` /
`style.css` + assets), wired through the daemon by `plugins/desktop.js`,
`desktop-ws.js`, and `api/desktop.js`.

### Boot chain (debug this top to bottom when something seems broken)
1. `apx desktop start` → `src/interfaces/cli/commands/desktop.js`. The
   `findElectron()` cascade tries `node_modules/.bin/electron` → then the
   launchd-safe `node node_modules/electron/cli.js` → finally `npx electron`.
   The shim wrappers do `exec node` and FAIL under launchd's minimal PATH
   (no nvm), so for autostart the cli.js branch is the one that wins. Paths
   resolve from `commands/desktop.js`, which is **4** levels under the
   project root — use `path.resolve(__dirname, "..", "..", "..", "..")`,
   not three (was a real bug at boot).
2. The wrapper spawns Electron with `detached: true` then `unref()`s. This
   is required for autostart: launchd kills the whole process group when
   the "main" process (this wrapper) exits, so detach=true gives Electron
   its own session and lets it survive the wrapper's 1.5s exit.
3. `main.js` reads `desktop.theme` / `desktop.position` / `desktop.shortcut`
   from `~/.apx/config.json` (fallback to legacy `overlay.shortcut`),
   registers TWO global shortcuts (the configured one for record + `Alt+/`
   for focus-input), and connects WS to `/desktop/ws`.
4. `renderer.js` builds the capsule + conv card DOM from scratch (vanilla
   JS — NOT React; no Babel/UMD in the Electron app). State machine:
   `idle | listening | transcribing | thinking | speaking`. The renderer is
   the source of truth for which mode is showing; main only relays IPC.

### Things that broke in production and now have guards
- **Conv card collapsed to 0 height**: `max-height: calc(100vh - 160px)` on
  the conv card collapsed during the brief window where the host was still
  at `WIN_H_MIN = 88` (pre first resize). Now an absolute `max-height: 580px`
  + `min-height: 120px`, with explicit `requestWindowResize()` at the end of
  `commitUserMessage()` / `finalizeStreamingAgent()` to grow the window in
  the same tick the card mounts. **Do not reintroduce `calc(100vh - ...)`
  on the conv card** without solving the boot-time circular dependency.
- **Non-streaming model "Pensando…" stuck**: gemini-flash / groq-fast
  models send the whole reply in a single `done` event with NO `token`
  events. The renderer used to wait for tokens to fill the bubble, so the
  bubble stayed empty with just the dots placeholder. On `done` we now
  inject the final text into the bubble immediately + finalize + return
  to idle. **TTS is fire-and-forget**: it runs in the background and
  `attachAudioToTurn()` post-attaches the scrubber when `tts-ready`
  arrives. Don't gate the user-visible reply on TTS completing.
- **Double-`done` duplicates the reply**: daemons sometimes retry. Guard
  with `doneHandled` (reset by `startAgentTurn()`).
- **Regenerate on stale replies broke the thread**: Regen only makes
  sense on the LAST agent turn. CSS hides `.btn-regen` on every
  `.turn:not(.last)`; `clearLastClass()` strips the modifier when a fresh
  turn mounts; the click handler keeps a `m.id !== last.id` guard.
- **Tray click opens menu AND toggles window**: macOS fires `click` even
  when a context menu is attached via `setContextMenu()`. We DON'T attach
  the menu; we wire `tray.on("click", toggleWindow)` and
  `tray.on("right-click", () => tray.popUpContextMenu(menu))` separately.
- **Empty user bubble**: whisper occasionally returns a single space for
  very short clips. Trim guards in `onstop`, `sendText`, and the
  defensive guard inside `commitUserMessage`.
- **Agent name flashes "Superagente"**: first paint must wait briefly for
  `getAgentName()` IPC. There's a 400ms grace + an in-place placeholder
  patch in the `.then()` for the case where render fires anyway.
- **MediaRecorder chunked transcription**: webm/opus stores the EBML
  header ONLY in the first chunk. Per-chunk transcription was undecodable
  past chunk 1. The renderer now buffers chunks and re-transcribes the
  CUMULATIVE blob each tick (live partial) + once on stop (authoritative).

### Identity resolution
The agent display name (what the bubble byline + capsule placeholder
show) comes from `~/.apx/identity.json` `agent_name` FIRST, then
`super_agent.name` as fallback, then literal "Superagente" as last
resort. `super_agent.name` is an internal slug ("apx"), identity.agent_name
is the human one ("Roby"). Don't invert the order.

### Channel prompt
`src/core/agent/prompts/channels/desktop.md` — voice-first, 1-2 sentences,
plain prose only (read aloud verbatim by TTS), bias toward doing the
action. Voice mode is always active for this channel
(`plugins/desktop.js` sets `channelMeta: { voice: true }`).

### Autostart at login (opt-in, per-user, no sudo)
`apx desktop install` / `uninstall` — macOS launchd plist
(`~/Library/LaunchAgents/dev.apx.desktop.plist`), Windows HKCU\…\Run, Linux
`~/.config/autostart/apx-desktop.desktop`. Critical detail: the
`ProgramArguments` MUST point at `process.execPath` (absolute node) + the
absolute CLI script — NEVER the shim. launchd's PATH is `/usr/bin:/bin:/usr/sbin:/sbin`
and any `exec node` shim ENOENTs there. `getApxRunner()` builds the
correct tuple; `buildPlist()` escapes XML metachars in arg values.

### Web admin
`/m/desktop` (`src/interfaces/web/src/screens/modules/DesktopScreen.tsx`)
shows status, edits the shortcut/enable/position/theme via PATCH to
`/admin/config`, and previews the last desktop conversation via
`GET /messages/global?channel=desktop`.

### Out of scope — DO NOT touch from this module
- `apx voice` (CLI TTS round-trip) and `voice.*` config keys — that's a
  separate feature; the desktop module reads `voice.tts.*` only to
  display "configured TTS engine: <name>" hints, never to write.
- Whisper / faster-whisper — that's STT and lives in
  `src/host/daemon/transcription.js`. The desktop renderer is a consumer
  via `/transcribe/chunk`; do not duplicate the whisper-server lifecycle.

## Docs site

The public docs live in `docs/` — an **Astro 6 + Starlight 0.39** project, fully
self-contained (own `package.json` + `node_modules`, independent of the apx npm
package; `docs/` is in its own gitignore for `node_modules/`, `dist/`, `.astro/`).
Authored 2026-05-30. **Read `docs/AUTHORING.md` first** — it is the style/format
contract.

### Structure
- **Bilingual i18n**: `astro.config.mjs` sets `defaultLocale: 'root'` → English at
  `src/content/docs/<section>/`, Spanish at `src/content/docs/es/<section>/`.
  Same slug both languages so Starlight links the two versions. Sidebar groups use
  `translations: { es: '…' }` for labels.
- **Sections** (sidebar groups via `items: [{ autogenerate: { directory } }]` — note
  Starlight ≥0.39 dropped bare `autogenerate` groups with a `label`, you must wrap in
  `items`): `start`, `concepts`, `surfaces`, `engine`, `capabilities`, `reference`.
- **Base path** is `/apx`. All internal links must be absolute and include it:
  `/apx/<section>/<slug>/` (EN) and `/apx/es/<section>/<slug>/` (ES), trailing slash.
- **Gold-standard pages** to copy style from: `start/installation.mdx`,
  `start/architecture.mdx`.

### Screenshots are placeholders
There are **no real images** — every screenshot is the custom
`src/components/Screenshot.astro` component (dashed box + `surface`/`caption`/`hint`).
Import depth differs by locale: EN pages `../../../components/Screenshot.astro`,
ES pages `../../../../components/Screenshot.astro`. Any file using a component must be
`.mdx`. The owner fills real captures later by swapping `<Screenshot…/>` for a normal
markdown image.

### GFM-in-MDX gotcha (already fixed — keep it)
Astro 6 applies GFM (tables, strikethrough…) **internally for `.md` only** and does
NOT expose it on `markdown.remarkPlugins`, so `.mdx` files render tables as raw pipes.
Fix is in `astro.config.mjs`: explicit `markdown: { remarkPlugins: [remarkGfm] }`
(remark-gfm is a direct dependency). **Do not remove it** or every `.mdx` table breaks.

### Commands & verify
- Dev: `cd docs && pnpm dev` (port 4321, home at `/apx/`). LAN: add `--host`.
  Launch config `apx-docs` in `.claude/launch.json` (which is gitignored).
- Build: `cd docs && pnpm build`. After building, sanity-check internal links and
  that tables rendered: `grep -rl "<p>|" dist --include=index.html` should be empty
  and `grep -rho "<table" dist | wc -l` > 0.
- The site is **not** wired into `npm run preflight`; build it explicitly when you
  touch `docs/`.

## Agents (dogfood)

apx registers itself as an APC project with demo agents in `.apc/agents/` (cody, doc, ops) used to exercise multi-engine routing. Those are fixtures — the source of truth for each is `.apc/agents/<slug>.md`. This root `AGENTS.md` is **not** regenerated from them.
