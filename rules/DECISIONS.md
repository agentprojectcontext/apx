# Decisions

Durable architectural choices. Code points here with `See DECISIONS.md#d-NNN`. Product-level reasoning lives in
`plan/`.

<a id="d-001"></a>
## D-001 — 2026-09-30 — TypeScript everywhere, run natively on Node 24
Core, terminal and protocol are `.ts` executed by Node's type stripping: no build step, no `tsx`. Consequence:
erasable syntax only. Rust/Go were rejected for the core: APX is I/O-bound and every agent SDK that matters is
TS/Python first. Speed comes from native tooling (TS 7, Biome, Vite 8).

<a id="d-002"></a>
## D-002 — 2026-09-30 — One contract, one dispatcher
`packages/protocol` holds every method (params, result, effect); `apps/core/src/rpc/router.ts` is the only way into
a handler, shared by HTTP and WS (and later node links and agent tools). Replaces v1's hand-written REST + separate
WS hubs + per-surface type copies.

<a id="d-003"></a>
## D-003 — 2026-09-30 — 5 apps + 4 packages, not 12 packages
Core modules are folders with lint boundaries. A module becomes a package only when a second app consumes it.

<a id="d-004"></a>
## D-004 — 2026-09-30 — Electron for desktop
The embedded browser needs Chromium with CDP and isolated session partitions; the system WebView used by Tauri
(WKWebView on macOS) offers neither. Evidence in `plan/research/06-navegador.md`.

<a id="d-005"></a>
## D-005 — 2026-09-30 — `packages/ui` lint findings as warnings (ratchet) — closed 2026-09-30
The design system predated the lint gate and had a11y/array-key findings, so a `biome.json` override downgraded
them to warnings while the gate landed. All findings are fixed and the override is removed: `packages/ui` now gets
the full rule set like every other package. Lists whose items carry no id key by content (`src/keys.ts`), not by
index. The fixes change markup, not visuals or the public API; a Claude Design re-sync is due.

<a id="d-006"></a>
## D-006 — 2026-09-30 — Biome instead of ESLint + Prettier; `node:test` instead of Vitest
Fewer dependencies and one fast binary. Vitest may be added for `apps/web` component tests if needed.

<a id="d-007"></a>
## D-007 — 2026-10-01 — Claude and Codex run as harnesses with the user's own login
An agent's turn can run inside the user's installed `claude` (Claude Agent SDK, `pathToClaudeCodeExecutable`) or
`codex` (Codex SDK). APX never implements their OAuth nor reads, copies or refreshes their tokens: each CLI uses
its own login on the user's machine. APX keeps identity, system prompt and tools: Claude gets APX tools as an
in-process MCP server; Codex gets them through `apx2 mcp --run <token>`, a stdio proxy bound to one run by a random
token that dies with the run. Claude runs isolated (`settingSources: []`, only WebSearch/WebFetch built-ins,
`permissionMode: "dontAsk"`); Codex runs read-only with no approvals. Each thread keeps the harness session id so
the conversation resumes. If a harness fails before any tool ran (quota, logged out), the turn falls back to the
native model with a visible card; after a tool ran it fails honestly (a retry could repeat an effect).

<a id="d-008"></a>
## D-008 — 2026-10-01 — Our own model client: one interface, two wire formats
The built-in harness calls models through `apps/core/src/providers/`: a `Provider` config (id, transport, base URL,
key reference, models) and two transports, `openai-chat` (OpenAI, Gemini's OpenAI endpoint, OpenRouter, Groq,
Ollama, LM Studio) and `anthropic-messages`. The gateway (`llm.ts`) classifies errors (`rate_limit`, `overloaded`,
`quota`, `auth`, `bad_request`, `model_gone`, `network`, `empty`), retries what is retryable once, falls back down
the chain for that call only and reports `finish` (a `length` stop is continued, not shown as complete).
Not the AI SDK: daily use goes through the Claude/Codex harnesses with the owner's subscriptions, so the built-in
model is the fallback and the cheap path; two transports cover it without a large dependency (rule 20).

<a id="d-009"></a>
## D-009 — 2026-10-01 — One door for agent turns, and in-flight work is durable
Every turn is a row in `runs` written with its input before it starts (`engine.admit`); `threads.send` is the
only public way to create one, and delegation results, widget prompts and channels come in the same way with a
typed `origin`. One coordinator runs a thread's queued runs in order. Each tool call is a `steps` row written
before it runs and the model log is appended as the turn goes, so after a crash the core can close a cut turn
honestly: a started tool with an effect is reported "effect UNKNOWN", one that never started "not run", queued
runs run, and a finished delegation wakes its caller even when the caller's turn is long gone.

<a id="d-010"></a>
## D-010 — 2026-10-01 — Secrets in the macOS Keychain; agent harnesses get a clean environment
A Codex harness in its read-only sandbox can read any file of the owner, including `~/.apx2`, but not the login
Keychain (checked with `codex sandbox`). So on macOS secret values live in the Keychain (service `apx2` for the
default home and `apx2:<home path>` for any other, so a second home never overwrites the first's values; written
through `security -i` on stdin so no value reaches argv); `~/.apx2/secrets.index.json` keeps only names and dates.
Other platforms and tests use `~/.apx2/secrets.json` (0600). Harness processes (Claude Code, Codex) get the
environment without `APX_*` variables, and the per-run tool token travels in `APX_RUN_TOKEN`, never on argv.
Residual risk, accepted for now: a harness with web tools can still be talked into sending what it reads in a
page or a tool result; high-impact confirmation (rule 10) is the next layer.

<a id="d-011"></a>
## D-011 — 2026-10-01 — Models are named by their engine; a router picks per turn; no model names in code
A model is a ref `<engine>/<model>` (`claude/…`, `codex/…`, `gemini/…`); an engine alone means its default model.
The engine decides the harness (Claude Code, Codex, or our loop for every provider), so "engine" and "model" are
one choice. Each agent has a `model_choice` — a fixed model, a model with the router as its fallback, or the router
alone — and agents without one use the install default. The router (settings) has per-turn rules (first match:
image, size, context, channel, trigger, agent kind, keywords) and a fallback chain; a turn walks the resulting list
and moves to the next engine only if one fails before running a tool. The model lists come from the engines
themselves (`/models`, the Agent SDK's `supportedModels()`, `codex debug models`) and are cached a day. Code holds
no model names: defaults, chains and rules are data an owner sets from the app or `apx2 models`.

<a id="d-012"></a>
## D-012 — 2026-10-01 — One tool registry, one policy, one way to wait for the owner
A tool is defined once with `defineTool`: its zod schema is the spec every harness sees (Claude Code gets it rebuilt
with `z.fromJSONSchema`, never a hand-made copy) and the check the model's arguments go through. Tools that touch
core state call protocol methods through the router as the agent, so the router's rules (validation, owner-only
methods) apply to agents too. Whether a call runs is decided in one place, `authorize`: the agent's `tools:` list,
its `autonomy:` (`ask` / `standard` / `total`, from its APC file), the tool's confirm level for those arguments
(`never` / `untrusted` / `ask` / `always`) and whether untrusted content is in the turn. A delegated run gets the
intersection of its callers' tools and the strictest autonomy. Confirmations, questions and (later) browser handoffs
share one durable machine (`pending_inputs` + `runs.respond`): a wait survives restarts, a timeout counts as a no,
and an approval that arrives after its turn ended allows exactly one identical call. Agents' own commands
(`shell`) are not a protocol method: a method would be a door around the policy.

<a id="d-013"></a>
## D-013 — 2026-10-01 — Memory is scoped notes in the preamble; long threads get a summarized epoch
Memory is one table of short notes with a scope: `global` (about the owner, every agent), `project` (agents in a
thread of that project) or `agent` (one agent's notebook), searched with SQLite FTS5 (accents ignored). Notes never go
in the system prompt: the first turn of an agent in a thread gets its standing notes (global and its own) plus what
matches the message, later turns only new matches, in a `[memory]` block of the turn input; the ids shown are kept per
agent in the thread's context, so the prompt prefix never changes. Agents write through `memory.*` like any client,
only for their thread's project or themselves, and may not edit or remove the owner's notes; `remember`/`forget` wait
for the owner while untrusted content is in the turn. `.apc/memory.md` stays a file the owner writes, read as project
context like `AGENTS.md`. Titles and summaries use an auxiliary model: the `model_aux` setting (`off` for none), else
the API models the owner already chose; never a CLI and never a model name in code. A long thread is compacted after a
run into a fixed five-section summary (rejected when the shape is wrong) that replaces the older turns as a new epoch;
the newest turns stay verbatim, and a summary of outside content stays marked untrusted so the policy does not relax.
Claude Code and Codex keep and compact their own transcripts.

<a id="d-014"></a>
## D-014 — 2026-10-01 — Channels are adapters over threads.send; who writes decides everything
A channel adapter (Telegram first) only translates platform messages in and presentations out. The manager stores
every inbound message before the platform is told it arrived (`channel_inbox`, deduplicated by the platform's id),
resolves the sender by an exact address match (`persons` + `addresses`; never by a name) and then: the owner's words
go through `threads.send` with a server-side channel context (to the Home chat by default, one conversation
everywhere); a contact's go to a thread of that conversation with a sealed agent (no tools of APX or of the engine,
no memory, no projects, only that chat, input marked untrusted, reply filtered for paths and keys); a stranger gets a
pairing code the owner approves (as themselves, as a contact, or not at all), which replaces v1's
first-writer-is-owner. Everything a channel sends goes through a durable outbox (`queued → sending → sent`, retried
only when nothing went out, `uncertain` when it may have, never resent blind). Answers return to the channel the
thread's last message came from until the owner writes in the app; confirmations and options reach the owner as
buttons only the owner's address can press.

<a id="d-015"></a>
## D-015 — 2026-10-01 — Typed queries with Kysely, compiled and run synchronously
Repositories build their queries with Kysely (stable, no runtime dependencies) typed against `db/schema.ts`, which a
script generates from a freshly migrated database (`pnpm check:schema` fails when it is stale). Kysely runs only as a
compiler: `sql(db)` takes the compiled SQL and parameters and executes them on `node:sqlite` synchronously, so the
store stays synchronous and a transaction is plain code. Migrations stay plain SQL in `db/migrations.ts` (append-only);
FTS5 tables are declared by hand next to the generated types and queried with `sql` fragments. Drizzle was not chosen
because its `node:sqlite` driver exists only in its 1.0 release candidate; making the whole store async to use
Kysely's executor would have touched every caller for no gain.

## D-016 — 2026-10-01 — Routines: one scheduler that reserves before it runs; silence is an answer
A routine is a row (schedule, prompt, agent) and each run is an ordinary run in a `routine` thread of its own, listed
in `routine_runs`; its state is read from `runs`, never copied. One scheduler ticks every 15 s and, in the same
transaction that starts a run, writes the next time and a lease, so a crash, a slow run or a second tick never runs a
routine twice, and a time missed while the core was off runs once. Schedules are a small tested cron parser (five
fields, local time) plus "every N minutes" (5 at least), "once" and "by hand"; no cron dependency for ~100 lines.
The prompt is the owner's own words (trusted); the agent answers `SKIP` when there is nothing to say, and only other
answers reach the owner. Routines are owner-only methods for now: an agent creating standing work for itself is a
persistent rule and needs its own confirmation design. Known limit: on loopback without `APX_TOKEN`, "owner-only"
rests on the client declaring itself (`x-apx-actor`); a shell command an agent runs could call the API as the owner,
which is why the shell tool asks before any command that reaches APX's port. Per-client tokens (mobile stage) close it.

## D-017 — 2026-10-01 — Commitments are tasks with a person; one tray for what wants the owner
A commitment (what the owner promised someone, or what someone owes the owner) is a task with `person_id` and
`owed_by`, not a second aggregate: it already has a state, a history, a due date and a conversation, and the board,
tools and reminders work for both. A due task is reminded once (`reminded_at`, cleared when the date moves) by the
scheduler's tick. Everything that wants the owner lands in one `notifications` table with a `ref`, so a notice about
the same thing replaces the unread one and leaves by itself once answered, done or moved; channels only mirror it.

## D-018 — 2026-10-01 — Extensions: a declarative bundle first; code only out of process
An extension is a folder with `apx-extension.json` that brings skills, MCP servers, routine templates and the secrets
it needs; the manifest is validated without running anything. Installing copies the folder into the home (plain files
only) and fingerprints it, off; turning it on approves exactly those files, and a copy that changed on disk is turned
off at start. Its MCP servers are the owner's (no extra approval) but can only name the extension's own secrets
(`ext-<id>-<name>`), never `env:` or another secret, so a bundle cannot carry the owner's credentials elsewhere. Code
that must run as part of APX (hooks) runs in a separate process with Node's permission model (stage 8b), never inside
the core. A plugin process reads only its folder,
writes only its data folder and starts no processes (Node's permission model); Node does not restrict the network, so
the runner also refuses raw socket modules and makes `fetch` refuse this machine and metadata addresses — a best-effort
guard so a plugin cannot call APX's loopback API as the owner. Plugins watch declared events and may add context to
owner turns (outside data, capped, 2 s); they never call APX.

## D-019 — 2026-10-01 — Outside apps get a scoped client token and always act as a model
An app such as Claude Code connects with its own token (`x-apx-client`, apart from `APX_TOKEN`'s Authorization
header): the core keeps only its sha256, the token makes the caller an agent-actor whatever it declares, and the router
lets it call only its scopes' methods (`SCOPE_METHODS`). With `chat` it starts plain chats that only it can read or
write, and its text reaches the agent as another app's message (untrusted). This limits what a model-driven app may do
even when its own prompt is hijacked; it is not a defence against a hostile local process, which can skip the token on
loopback (see D-016's known limit).

<a id="d-020"></a>
## D-020 — 2026-10-02 — Rule 16 applies to factories and stylesheets too
A factory that returns a table of closures (`createCore`, `threadHandlers`, a React dialog) counts as one function: past
~150 lines it is split into named helpers that take their dependencies explicitly (`server-wiring.ts`: `builtinTools`,
`coreHandlers`, `extensionStack`, `listen`; `rpc/runs.ts` beside `rpc/threads.ts`). The returned object literal of a
composition root may stay inline. Stylesheets follow the same ~800-line cap: one sheet per area, imported in a fixed
order because that order is the cascade (`apps/web/src/main.tsx`; `packages/ui/src/styles/components.css` lists its
sheets and the build inlines them in that order into the single `dist/styles.css`).

<a id="d-021"></a>
## D-021 — 2026-10-02 — Agent templates are plain APC folders; installing copies the file
A template folder holds `<slug>.md` agent files in the `.apc/agents/` format; a sub-folder with `TEAM.md` is a team
whose members report to each other through `parent:`. APX ships its own under `examples/agents/` and also reads the
owner's v1 vault (`<v1 home>/agents`), never writing there and never following symlinks. Installing writes the
template's text as is into the project (only `parent` changes), so fields APX does not model yet (`area`, `tools`,
`skills`) survive; a slug the project already has is skipped, never overwritten. `hang_under` keeps one tree when a
team with its own lead lands in a project that already has an orchestrator. The Team view draws the tree itself (SVG
curves, HTML cards, no graph library): the owner chose no new dependency, so the parent is changed from the agent's
detail with a confirmation rather than by dragging.

<a id="d-022"></a>
## D-022 — 2026-10-02 — A contact's chat may get one narrow tool per flag, off by default
D-014 sealed a contact's turn: no tools, no memory. The owner asked that a chat can take requests and appointment
requests and answer from the owner's notes. Each is a per-person flag (all off by default) that adds exactly one
narrow tool to that sealed turn and nothing else: `pass_request` only files a task for the owner (`awaits_owner`,
linked to the person, owed by the owner) and never acts; `search_owner_notes` reads global notes the owner wrote
(never an agent's, never one saved with outside content). The flag is checked again inside the tool, contacts stay
rate-limited, and the owner's own turns never see these tools. The owner's rules for a person go last in that
person's prompt; a silenced person's messages are kept and never reach a model. From the app, the owner's words in a
contact's chat are an instruction to the agent (`<owner_instruction>`), answered on the channel, or sent as is with
`channels.send`.

<a id="d-023"></a>
## D-023 — 2026-10-02 — An engine session is the engine itself, with the owner's own Claude Code settings
External sessions (Sessions › Claude Code, Codex, an ACP agent) were an agent (the super-agent) running on that
engine, so the owner talked to Roby, not to the engine. A thread can now be an engine session (`Thread.engine`): a
code thread in a project's folder where the engine keeps its own prompt (Claude Code's preset with a one-line APX
note appended; Codex and ACP agents get no instructions), with none of an agent's notes, roster, skills or framing;
the super-agent only owns the run. Unlike an agent (isolated: no CLAUDE.md, hooks or plugins), an engine session
loads the owner's own Claude Code settings (`user`, `project`, `local`) as the CLI would, because it is the owner's
own tool; MCP stays limited to APX's server and the engine's own edits and commands still go through APX's policy.
The owner's sessions in `~/.claude` and `~/.codex` (paths injected: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`) are listed
read-only and gone on with as an engine session that resumes the engine's own session id; APX's own runs (framed
turns, `codex_sdk_ts`, sub-agents) are left out.

<a id="d-024"></a>
## D-024 — 2026-10-02 — v2 lives in ~/.apx/v2, beside v1's files
v2 will be "APX" in the same folder v1 uses, so its state moved from `~/.apx2` to `~/.apx/v2`: one product folder,
and v1's files around it (`config.json`, `messages.db`, `skills/`…) are never written by v2 while v1 is in use. The
move happens once when the core starts, before the store opens, and only when the new folder does not exist and the
owner did not set `APX_HOME` (a rename on the same disk: all or nothing). This is a one-off move of where state
lives, not a compatibility shim, and there is no `doctor` yet to host it. The default home keeps the Keychain service
`apx2`, so its secrets are still found. The command stays `apx2` until the owner finishes the setup wizard; then v2
takes `apx` and v1 leaves the PATH.

<a id="d-025"></a>
## D-025 — 2026-10-03 — WhatsApp is the owner's own account, linked as a device; strangers are only listed
WhatsApp runs on Baileys (the library v1 already used in production, same pinned version) as a linked device of the
owner's own number, never the Business API, whose terms forbid general assistants. Because the number is the
owner's, the channel turns three Telegram rules around: the linked account is the owner (whoever writes in "Message
yourself" is the owner, linked on connect); a stranger never gets a pairing code from the owner's number — their
request is listed quietly in the app for the owner to approve, without a notice; and what the owner types to others
on the phone is theirs, not the agent's (only our own sends' echoes are recognized and dropped). Lessons kept from
v1: reconnect on the restart WhatsApp asks for after a scan (515), never retry dead credentials (logged out: the
folder is deleted and a human links again), only live messages (`notify`) are read, and a person may arrive under
their phone number or their private id (`@lid`): the phone number wins when WhatsApp gives it. The QR is held in
memory only, shown to the owner through `channels.list`, and dropped once spent; the credentials folder is 0700 and
deleted when the channel is removed. The library loads with the first WhatsApp channel (it costs ~45 MB) and its
install scripts are not run.
