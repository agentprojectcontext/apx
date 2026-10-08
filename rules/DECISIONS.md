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
(`never` / `untrusted` / `ask` / `always`) and whether untrusted content is in the turn. The owner's explicit `total`
choice skips `ask` and `untrusted` confirmations even with outside content; `always` remains mandatory. A delegated run gets the
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
run's stored destination, so queued messages from the app or another channel cannot redirect an earlier turn.
Approval on a channel redirects only the run being approved; resumed approvals, jobs and delegation results inherit
their original run's destination. Confirmations and options reach the owner as
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
install scripts are not run. Amended by [D-027](#d-027): the owner's own number is now a choice, not the default.

<a id="d-026"></a>
## D-026 — 2026-10-03 — Updates follow main of the checkout APX runs from
APX runs from its source checkout today (no packaged build, no release feed yet), so "a newer APX" means commits on
`main` this checkout does not have. The core asks git every 6 hours (first a minute after it starts; `APX_UPDATES=off`
stops it) and keeps the answer in memory; the panel shows a pill only while there is one, with the commit subjects
as "what's new". Updating is the owner's click: `git pull --ff-only` (never a merge or a reset of the owner's work),
`pnpm install --frozen-lockfile`, `pnpm build:web`; any failure stops before the next step and what runs now is
untouched. A supervisor restarts the core with the new code when it exits with code 75 (`pnpm app` does; it sets
`APX_SUPERVISED=1`); without one the owner is asked to restart. The panel knows its own build by its entry file and
reloads when the core serves another one. When packaged releases exist this becomes a signed feed plus
electron-updater (plan §12), behind the same two methods.

<a id="d-027"></a>
## D-027 — 2026-10-03 — A WhatsApp line is nobody until the owner says it is their phone; strangers can be asked about
Most owners link a line of its own that the agent answers on and write to it from their own phone (v1 learned this the
hard way: treating the line as its owner made the real owner a stranger on it). So `self_owner` is off by default: the
line's "Message yourself" is ignored, and the owner's phone is linked like any address: by writing to the line and
pressing "It's my number" on the request (WhatsApp shows the number, so no code is needed), or by typing the number
(`contacts.address`). Turned on, D-025 applies as it was. Strangers get one of four treatments per channel: `pair` (a
code; on the owner's own number only listed), `ask` (the owner gets a notice with who wrote, their number and their
first message, with buttons; once let in, that first message is answered), `answer` (a new contact at once: sealed,
tool-free, rate-limited) or `ignore`. The owner can also decide by telling the agent: owner turns of the channel's
agent see who waits by request code, channel and number only (never the name or text a stranger chose, so the turn
stays trusted), and `answer_contact_request` lets someone in only through `pairing.respond` as the owner, after the
owner approves that call; ignoring needs no approval.


<a id="d-028"></a>
## D-028 — 2026-10-03 — Each message picks its skills by meaning, ranked against each skill's own floor
The catalog in the system prompt names skills; models still skip them and answer that they cannot do what a skill
covers. So, with an embedding engine set up (and `skill_picker` on, the default), each owner-side message is compared
with every skill's description: the clear winner goes into that turn's input whole, up to two more by name, and the
chat shows the pick as chips (loaded, suggested, and near misses "considered") from a `skills` part. Raw similarity is
not comparable across skills (a chatty description scores high against anything), so each skill is ranked by how far
it stands above its similarity to a fixed set of subject-less prompts, in units of its own spread (v1's measure,
ported with its bars: load 3.0, hint 2.2, margin 0.4, raw floor 0.30). The pick goes in the input, never the system
prompt, which stays byte-stable; the catalog stays too, so a slow or missing engine (4 s budget) only loses the pick.
Vectors are kept in memory per engine and description and computed at start and on the first message after a skill
changes. Contacts' turns and engine sessions get no pick, as they get no catalog.

<a id="d-029"></a>
## D-029 — 2026-10-03 — Discord and Slack are bots in direct messages, with no library
Discord runs on its Gateway (a WebSocket) and REST API; Slack on Socket Mode (a WebSocket the app opens) and the Web
API: no public URL, no SDK, the platform's own `WebSocket` and `fetch`, like Telegram. Only direct messages reach an
agent (servers' and workspaces' channels are ignored), so pairing, contacts, the outbox and buttons work as on
Telegram. A Slack app needs two tokens (the bot's `xoxb-…` to talk, the app's `xapp-…` to open the socket); they are
stored as one secret ("xoxb-… xapp-…") so a channel keeps one token, as every other. Slack acknowledges an envelope
only after it is stored; Discord does not redeliver a message sent while the socket was down (a known gap).

<a id="d-030"></a>
## D-030 — 2026-10-03 — Devices pair with a one-time code and keep a key of their own
A phone (or another computer) reaches the core through the same protocol as the panel. It does not get the core's
token: the panel asks for a one-time code (8 characters without look-alikes, 10 minutes, kept in memory), shown as a
QR with the addresses the core listens on (`apx://pair?c=…&u=…`); the device trades it in `devices.pair`, the one
method callable without a token (`open` in the registry), for a key of its own (`apxd_…`, only its sha256 stored).
That key passes the gate like the core's token, as the owner, and is revoked alone. Five wrong codes void every
pending one and pause pairing for five minutes. A core listening only on loopback lists no address: the panel says to
start it with `APX_HOST` and `APX_TOKEN` (or reach it through Tailscale) first.

<a id="d-031"></a>
## D-031 — 2026-10-03 — One interruption budget for everything APX says unasked
Messages the owner did not ask for (routine news, the reminders they set, later agents' notices) go through one gate,
`engine/nudges.ts`, with its ledger in SQLite (`nudges`), as v1's `canNudge` did: a daily cap (3 by default, 0 = none),
a gap per project (180 min) and per kind (120 min), and quiet hours that now **hold** a message instead of only
silencing it; what waited goes together in one message when they end. A routine may be an anchor (a morning or
evening brief): it always arrives and does not count. The reminders the owner set do not count either but wait out
quiet hours. Something critical may skip the cap (on by default) and, as a separate permission, cross quiet hours
(off). A due date passing never sends a message: it lands in the tray, and the watch routine mentions it. Answers to
the owner's own messages, confirmations and pairing never pass through the gate. Feedback (👍/👎) and the agent's own
`notify_owner` tool come next and use the same gate.

<a id="d-032"></a>
## D-032 — 2026-10-04 — The phone lends location and camera as a node, and takes notices by push
The paired phone opens a second socket as a node lending `location` and `camera`; its tools (`phone_location`,
`phone_photo`) are offered to agents only while a node lends the capability (`needsCap` on a tool), so a turn without
the phone never sees them. A picture is always taken by the owner on the phone (the app shows the agent's reason);
reading the location asks for the owner's OK only while outside content is in the turn. Push goes to a device chosen
as where notices go (`notices.channel = "device:<id>"`), after the interruption budget (D-031): Expo push with the
token the app registers itself, or a UnifiedPush / ntfy address the owner pastes. A device sets only its own push; the
token never comes back to any client. `APX_PUBLIC_URL` puts a VPS or Tailscale address first in the pairing QR.

<a id="d-033"></a>
## D-033 — 2026-10-04 — The secretary profile is settings plus three seeded routines, no package system
v1's profiles were installable packages (manifest, prompt template, routines, sync and re-adopt with a fingerprint);
the doctor's "you edited it and the package moved on" confused more than it helped. In v2 the secretary is one setting
(`secretary`: on, the day's open and close crons, watch interval, calendar command, thresholds, formality) and three
ordinary routines it keeps in step by `origin` ("secretary:day-open"…): open and close are anchors (they always
arrive), the watch goes through the interruption budget (D-031). Saving the profile reschedules them and turns them on
or off; a prompt the owner edited stays, and "Restore" puts the default back. A v1 routine of the same job is adopted,
not doubled. While on, a short role block joins the super-agent's system prompt (it changes only with the profile, so
the prefix stays cacheable), and the watch reads its thresholds from it.

<a id="d-034"></a>
## D-034 — 2026-10-04 — The owner's 👍/👎 on unasked messages tunes the gate and the routine itself
A routine's or an agent's news that reaches the owner carries 👍/👎 buttons (a channel without buttons leaves them out
rather than numbering them; the panel's Interruptions log has them too, and a second press takes it back). The rating
is stored on the nudge (D-031). Two effects, both bounded to the last 14 days: a kind marked 👎 at least twice with the
latest rating a 👎 is dropped by the gate ("you marked this kind unhelpful") until a 👍 lifts it; anchors, reminders
the owner set and critical messages are never muted. A routine's turn is told its counts as an `[owner feedback]`
line in its input (not the system prompt, so the prefix stays cacheable). Reminders are not rated: the owner set them.
No learned model, no per-signal scoring: two counts and a rule the owner can read.

<a id="d-035"></a>
## D-035 — 2026-10-04 — Agents reach the owner unasked only through `notify_owner`, the same gate as routines
`notify_owner` calls `notices.notify`, which offers the text to the interruption budget (D-031) as kind
`agent:<id>` (so the owner's 👍/👎, D-034, tune it per agent) and adds a tray entry either way. It is refused in a
routine's thread (its answer is already delivered) and between agents (the answer goes back to the asker), and it is
not among a contact's tools. It asks the owner's OK while outside content is in the turn: an injected page must not
write to the owner in APX's voice. The tool reports what the gate did, so a dropped message is not retried.

<a id="d-036"></a>
## D-036 — 2026-10-04 — A commitment ends kept, missed or released; a new date is an event, not an outcome
`tasks.settle` records how a commitment went. Kept closes it as done; missed (its date passed undelivered) and
dropped (released by agreement) close it as dropped; the task's `outcome` says which, and reopening clears it.
Renegotiated is not an ending: the commitment stays open with the new date (reminded again), a `renegotiate` event
keeps the old and new dates, and a counter shows how often it moved. Only the owner's word settles one: the
day-close routine asks, and the agent records the answer with `commitment_settle`, never on its own. How far ahead a
commitment is raised is the secretary profile's `commitment_lead_hours` (D-033).

<a id="d-037"></a>
## D-037 — 2026-10-04 — Profiles are data: the secretary is one of several, and more install from a folder
The owner wants to choose what the super-agent is for, and later get more from a store. D-033's secretary was fixed in
code, so a profile is now an `apx-profile.json`: an English block for the super-agent's system prompt (`{{key}}` takes
a setting; a choice's option brings its own line), settings fields (schedule, number, text, command, choice) with
labels per language, and routine templates (`{{day_open}}` crons, every `{{watch_every_h}}` hours, `v1` names to
adopt). APX ships `examples/profiles/` (secretary, focus); the owner's install into `<home>/profiles/` and win an id.
One runs at a time (`profile` setting: id + values); switching turns the previous one's routines off and keeps them
(prompts the owner wrote stay, Restore puts the shipped one back). D-033's objection still holds: no fingerprint, no
re-adoption, no drift warnings. The watch's thresholds read `waiting_hours`, `commitment_lead_hours` and
`stale_project_days` from the running profile's values, with fixed defaults otherwise. A migration moves the old
`secretary` setting into `profile`. v1's profile routines (`origin: profile:<id>`) are not imported: the v2 profile
brings them, and a v1 routine it adopts by name takes v2's prompt (v1's names tools v2 does not have). A watch waits
out the owner's quiet hours without calling the model (nothing it said would reach them); the first run after sees
what is new, which is what v1 owners did by hand with a watch limited to daytime hours.

<a id="d-038"></a>
## D-038 — 2026-10-04 — Agents know their owner, the channel and v1's working rules
In v2 the super-agent did not know who it worked for (the panel kept the owner's name in the browser), always read
"channel: app", and lacked v1's working rules, so it answered like a generic chatbot. Now the owner's identity lives in
the core (`owner.get/set`: name on the owner's person, about, language, time zone), the system prompt carries a "Your
owner" block and a short "How you work" block ported from v1 (a promise is not an action; look before you answer;
hand-offs carry what the other agent needs; a failing system is reported, not routed around), and each turn's
context names the real channel and the owner's time zone, with a plain-text style line for chat apps. The v1 import
brings identity.json, the user's language and time zone, the super-agent's personality and extra instructions (as its
prompt), the profile it ran with its values, and its nudge budget and quiet hours.

<a id="d-039"></a>
## D-039 — 2026-10-04 — v1's chats come in as threads with their own dates; Default's agents become global
The owner moves to v2 by importing, so the import brings what v1 kept, not only its settings. v1's super-agent chats
(`~/.apx/messages/<channel>/<day>.jsonl`) become one thread per channel (per chat on Telegram; web and v1's sidebar
are one), so the owner finds "Telegram" rather than a hundred days of it, and the model log gets only the newest
stretch (about 200k characters), which the upkeep summarizes on the thread's next turn; a WhatsApp
contact's rows, one thread with that contact; project agents' web and agent-to-agent conversations
(`projects/<id>/agents/<slug>/conversations/*.md`), threads with that agent. Messages keep v1's time (the store takes
an `at` for history and adds it without a live event per message), tool rows ride on the answer that followed them as
finished tool calls, and the text goes to the model log so a chat can go on. Routine logs, compactions and media stay
in v1. What was brought is remembered by key, so importing again adds nothing. v1's Default agents
(`projects/default/.apc/agents`) become global agents with their prompt and face (Default has no folder in v2), each
agent's `memory.md` becomes its own notes, and the super-agent takes v1's name, face and personality. An agent's
personality is its own field (`personality:` in its file), apart from its instructions. A variable already in the
Keychain from an earlier install no longer stops the import: only this install's index counts.

## D-040 — 2026-10-04 — Workers: throwaway helpers an agent starts through `delegate`
An agent often needs focused work (a long search, a review) that would fill its own context, and no standing agent
fits it. `delegate` takes `worker {name, instructions, tools?}` instead of an agent: the sub-thread runs as the caller
itself (its model chain, harness and inherited tools), under a system prompt made of the instructions it wrote, the
project and the safety rules, with no personality, owner block or roster. A worker asks no one (no `delegate` or
`list_sessions`) and, when the caller named tools, keeps to those. Its instructions live in the sub-thread's context,
so continuing the session keeps them. It is the same one a2a path (rule 2), not a second one: depth, the breaker and
the delegation cap apply as they do to agents. The chat card now carries the whole report (folded until asked) and how
long it took, and a result that arrives after the caller's turn ended shows its card again above what the caller makes
of it.

<a id="d-041"></a>
## D-041 — 2026-10-04 — Discord server rooms: listed, kept, answered sealed
v1's Discord lived in the owner's server rooms; v2's only read direct messages. A Discord channel now has `rooms`: the
rooms it reads (deny by default: an unlisted room is neither stored nor answered), each with a mode (`mention`: when
called by @mention, a reply to it or one of its names as a whole word; `always`; `useful`: the auxiliary model judges
an uncalled message by the owner's `reply_when`, at most `checks_per_hour`; `read`: never speaks), plus the owner's
notes for that community (`knowledge`), their `rules` (last in the prompt), `owner_only` and limits (a pause between
answers to one person, a cap per room per hour, which the owner skips unless the model chose to answer). Every message
of a listed room is kept in the room's chat (one per room); one person's quick messages settle into one answer to the
last. A room's turn is sealed for everyone, the owner included (the room is public): no tools, no memory, no history of
its own; it reads the room's latest messages (25, within 6000 characters) as data and the one it answers, framed with
who wrote it (the owner checked by account). Answers go as a reply to that message, with no mentions; a failure is
told to the owner, never posted. The import brings v1's bot token, the owner's ids, rooms, words, notes, rules,
criterion and limits; direct messages from strangers wait for the owner (v1 never answered them). Not brought: v1's
room summaries and similarity recall over older room messages, and a bot-role mention counting as a call.

<a id="d-042"></a>
## D-042 — 2026-10-05 — The ChatGPT plan as a model in APX's own loop; Claude and Codex harnesses keep to APX's tools
Amends D-007. Running Codex as a harness meant an agent's turn ran the owner's whole Codex app: its own shell, search,
browser and sub-agents, and the owner's own MCP servers and plugins, outside APX's policy. As v1 did, the plan is now
also a provider (`chatgpt`, transport `chatgpt-responses`: the Responses API the plan serves at
chatgpt.com/backend-api/codex, streamed, `store: false`, encrypted reasoning replayed to the same model) so the router
can put `chatgpt/<model>` in its chain and the turn is APX's loop with the plan's model. Its sign-in is APX's own
(the device code Codex uses), kept in the secret store and refreshed by the core; Codex CLI's tokens are never read,
so the two never share a refresh family. v1's APX-owned sign-in is taken over once (read only). The Codex harness
stays for code threads and the owner's own Codex sessions; outside them it now runs with the owner's servers,
plugins, AGENTS.md and Codex's own tools off. Claude stays a harness only: Anthropic limits the subscription's
sign-in to Claude Code; outside code threads it sees APX's tools only.

<a id="d-043"></a>
## D-043 — 2026-10-05 — Agents and the router run on model APIs; CLIs run only in their own sessions
Amends D-007 and D-042. An agent on Claude Code, Codex or an ACP agent ran that CLI's whole turn, so a chat with an
agent behaved like the CLI and not like APX. Agents, the router (rules and chain) and the install default now take
model APIs only: the providers APX's own loop calls, including the ChatGPT plan (`chatgpt`, shown as Codex) signed in
from APX. Claude Code, Codex and ACP agents run only in their own sessions (`Thread.engine`, D-023), where the owner
talks to the CLI itself; `models.set_config`, `agents.update` and `threads.model` outside a session refuse a CLI ref,
and a choice an older APX saved is skipped when read (the router drops it, the default falls back to the router).
The Claude plan has no counterpart in APX's loop: Anthropic limits the subscription's sign-in to Claude Code, so it
stays an external session and agents use an Anthropic key. The plan's model list is asked to the plan
(`<base>/models`, as Codex does), never read from a CLI's cache. Settings shows the plans and model APIs under
Engines and models, and the CLIs under External sessions.
So the harnesses keep only their session mode: Claude Code always loads its own prompt and the owner's settings,
Codex its own config, and no agent framing (`<apx_instructions>`), Codex lockdown or agent-only tool cut is left. A
session runs its CLI and nothing else (`threads.model` refuses another engine there), so the engine-to-engine
fallback and the recap of turns another engine answered are gone: a CLI that fails fails the turn.

<a id="d-044"></a>
## D-044 — 2026-10-05 — One `apx`; installed APX updates from a public release feed
v2 replaces v1: the command is `apx` (no `apx2`), and installing v2 stops v1's daemon and removes v1's npm package while
v1's files in `~/.apx` stay to import. Every release carries, per platform, the desktop installer and a daemon bundle
(`apx-core-<v>-<os>-<arch>.tar.gz`: core, terminal, panel, `node_modules` and the Node that runs them), each with a
`.sha256`, plus `install.sh` / `install.ps1`. A server installs the bundle with the script into `APX_APP`
(`~/.apx/v2/app`: `versions/<v>/` and a `current` link the service runs through) without root and without a system
Node. Installed APX learns of a newer one from the GitHub Releases of a public repo (`RELEASE_FEED`,
`agentprojectcontext/apx`; `APX_RELEASES` overrides, `off` stops it) — the code repo stays private, only builds are
published there. A bundle install downloads, checks and unpacks the newer bundle beside the running one, moves
`current` and restarts (`system.update`), so a desktop connected to a server updates the server. The desktop app
updates itself (it carries its own core): the AppImage replaces its file, the Windows installer runs, macOS opens the
disk image to drag in (unsigned, so no silent install). Every platform is built from any computer (`pnpm package:<os>`):
the only native module, sharp, comes prebuilt per platform (`npm --os/--cpu`), and Node comes from nodejs.org,
checked against its SHASUMS256.txt.

<a id="d-045"></a>
## D-045 — 2026-10-07 — A question the owner has not answered stays open; the turn ends and the answer wakes it
D-012 counted a timeout as a no: after 15 minutes (5 for Claude Code and Codex) a question or a confirmation closed and
the agent went on without the owner. Now the turn still waits that long, then ends (the model is told to say what it
waits for and stop) while the input stays answerable for 30 days and the chat shows it waits for the owner
(`input-required`). The answer starts a new turn, as an answer after a restart already did; an approved call then runs
once without asking. `ask_owner` takes `can_continue: true` for a question the agent can do without: that one still
closes when the wait ends. An external agent's own tool (Claude Code's, Codex's) still counts a timeout as a no: it is
not ours to run later.

<a id="d-046"></a>
## D-046 — 2026-10-07 — A shell block an agent wrote runs from the chat, and its end wakes that agent
A fenced `bash`/`sh`/`zsh` block in an agent's message gets a run button in any chat; agents are told in their prompt
to write a command the owner must run (sudo, a password) that way. It opens a terminal of its own in the side panel,
in the chat's folder or else APX's work folder (where the agent's own commands run there), (`terminal.open` with `command` and the `message` it came from) that runs only
that command on a real tty, so the owner can type what it asks (a `sudo` password, which is not echoed). When it ends,
the agent that wrote the block gets a turn with the exit code and the end of what it printed, framed as untrusted
output like a background job's; pressing run is the owner's own action, so it does not count as an agent acting
alone. Closing the terminal before the command ends tells nobody. Only a human operator opens terminals: an agent
cannot press run for itself.

<a id="d-047"></a>
## D-047 — 2026-10-07 — Total autonomy asks for nothing; low-impact tools stop asking in standard
D-012 kept `always` confirmations even under total autonomy, so an agent the owner set to run on its own still stopped
for them. Total is the owner's explicit choice: now nothing waits for them there, `always` included (destructive
shell commands, commands that reach APX's own API, iMessage, answering a contact, using the owner's browser login).
The embedded browser still never types passwords or payment data: that is a handoff, not a confirmation. In standard
autonomy, tools that only keep something of the agent's own or reach only the owner no longer ask while outside
content is in the turn: `remember` (a note saved then stays tainted and reads as outside content wherever it shows),
`task_close`, `commitment_settle`, `open_document`, `send_file` (only to the owner's chat; contacts and rooms never get
it), `make_image`, `video_transcript` and `notify_owner`. Writing files, messaging contacts, typing in the browser,
`forget`, `grant_tool`, the phone's location and widgets that connect out still ask then. AGENTS.md rule 10 follows.

<a id="d-048"></a>
## D-048 — 2026-10-07 — A task is worked in its agent's own chat; the task keeps only comments
A turn used to run inside the task's conversation, so every tool call of the work landed among the comments.
Now giving a task to an agent (creating it with one, or assigning it) starts the work in that agent's own chat for the
task: a plain chat listed in the inbox, linked by `threads.task_id`, opening with the task's words (the owner's, or
"work on this task" with the task as outside data when an agent wrote it). An @mention in a comment asks that agent in
its chat for the task, and each finished turn there is posted back to the task as that agent's comment (with the
@owner attention and the mention cascade, still two hops deep). Reassigning starts the new agent's chat; the old one
stays listed on the task, and the new agent's [task] block says who worked it before. Once an hour the office clock
picks up a few assigned tasks that never started, most pressing first, counting only assignments made since this
began (`task_work_since`), so the board already assigned before it does not start on its own.

<a id="d-049"></a>
## D-049 — 2026-10-07 — Channels, contacts and rooms: three words, a tool for each
Asked to read a Discord room, an agent went to the browser: nothing said the room existed, and the only send tool
reached people. The words are now fixed. A **channel** is an app APX talks through (WhatsApp, Telegram, Discord,
Slack, iMessage). On a channel, a **contact** is a person (their direct chat) and a **room** is a shared place many
people read (a Discord or Slack channel; a WhatsApp or Telegram group would be one too). "Thread" stays APX's own word
for any conversation: every contact chat and every room is kept in one. The agent is not told this in each turn: one
line of the system prompt names the words, and it looks when it needs to. `channel_list` (over `channels.overview`,
open to agents, no tokens, accounts or QR) shows each channel's state and rooms; `contact_list` shows people;
`message_contact` writes to a person and `channel_post` (over `channels.post`) posts in a room by its exact name: a
near name only gets a suggestion, since a public post cannot be taken back. Reading a room is `read_chat("#name")`.

<a id="d-050"></a>
## D-050 — 2026-10-07 — Each chat keeps its temporary files in a temp folder of its own
An agent in a project chat had only the project's folder: downloads, scripts it tried and the owner's uploaded
attachments (`.apx-attachments/`) landed in the repository. Each chat now has a temp folder (`scratchDir`), shared with
the sub-chats it delegates to, in the system's temp folder under `apx-scratch-<hash of APX's home>`: outside the project
and outside APX's home, so shell's refusal of commands that name APX's home still holds. The file tools, `send_file`,
`open_document` and shell's `cwd` take absolute paths there; another chat's folder is refused. Writing there never
waits for the owner, outside content or not: it changes nothing of theirs, and running what was written stays under
shell's own rule. Those files are not the owner's changes, so they get no changes card. The owner's attachments are
copied there too. The system prompt names the folder (one path per chat, so the prefix stays byte-stable) and tells the
agent that only what the owner keeps goes in the project. The system cleans its temp folder on its own schedule.
Outside engines' sessions (D-023) are unchanged: their own prompt does not name the folder.

<a id="d-051"></a>
## D-051 — 2026-10-07 — Skills matched by meaning are only recommended; the agent loads them
Revises [D-028](#d-028). A match by meaning no longer puts a skill's body in the turn: a skill well above its own
floor still had a raw similarity under 0.4 and loaded on messages about something else, costing context and steering
the answer. Every match is now named with its description and the agent judges it and calls `load_skill`. The bars are raw
similarity, set on the owner's chats with a small local engine: skills about APX itself reached 0.52 on messages about
something else, real matches 0.49 to 0.73. So a skill is named from 0.50 (and still 2.2 over its floor), listed first as
"most likely" and blue in the chat from 0.65; up to three in all. The chat shows near misses from 0.30. Only a skill
the owner names with `/name` goes in whole.

<a id="d-052"></a>
## D-052 — 2026-10-07 — A restart of APX picks the turns it cut off back up, once
A restart (an update, `node --watch` saving a file, a crash) ended every running turn as `failed`, and nothing ran it
again: a delegated task cut halfway stayed dead unless the caller's model happened to ask again, and a finished report
cut while closing showed "Failed". Now shutting down leaves a running turn open; the next boot closes its model log as
before (effect UNKNOWN for tools that had started) and admits it again with the same input, origin, reply target and
caller, marked `resume_of`. The resumed turn reads a short note saying why it stopped instead of the original message
again, and a caller whose delegations are still going is told not to delegate them again. A delegation reports to its
caller only when its resumed turn ends. A turn that was already a resume is not resumed again, so a crash loop stops;
a turn waiting on the owner still gets their answer as a new input instead.

<a id="d-053"></a>
## D-053 — 2026-10-07 — MCP tools are found with mcp_search and run with mcp_call
Every MCP tool used to go to the model on every call, and every server started at the start of every turn: ten
ordinary servers came to 319 tools and about 62k tokens per call, several times APX's own prompt. Now a turn offers two
tools while any server is enabled and approved: `mcp_search` (by words or by server; returns names, descriptions and
argument schemas, the servers' names in its description) and `mcp_call` (an MCP tool's exact name and its arguments).
Servers start on the first of either. The executor turns `mcp_call` into a call of the tool it names, so approvals,
confirmations, steps and cards are that tool's, as before; it runs MCP tools only. The list a turn sends no longer
changes with which servers started, which keeps the provider's prompt cache. An agent's `tools:` list that names MCP
tools still restricts, and the tools that join later are held to it and to every caller's. Same idea as v1's `call_mcp`
and the tool search of other agent apps.

<a id="d-054"></a>
## D-054 — 2026-10-07 — Each project has APX's side of it, `projects/<id>`, so no chat works among other projects
Outside code threads, Claude, Codex and ACP agents worked in APX's one `work/` folder whatever the project, and a
project chat whose folder was off this machine (an unplugged drive) fell back to it too: one project's files landed
among every other's. Now each project has APX's side of it in APX's home: the project's own folder when APX made it
(`projects/<name>`, a project with no folder elsewhere), else `projects/<id>` (ids carry a `_`, folder names never do,
so they cannot meet). An outside agent in a project chat works there, never in the project's own folder, where that
folder's `.claude/` settings would allow tools past APX's gate; a code thread keeps its folder. The native agent keeps
the project's folder and moves to its side only while the folder is missing. `work/` is left to chats outside a
project. Made on first use; the files panel shows it as the chat's folder.

<a id="d-055"></a>
## D-055 — 2026-10-08 — Widgets stay in the database, one project's or global, and are shared by copying them
A widget's HTML, version, places (board, app) and origins stay a row of `surfaces`, not files under the project's
side: the row is updated atomically by name, every open copy hears the change, the share link and its CSP read the
same row, and one backup keeps it all. A widget belongs to one project or is global (made in a chat outside a
project); a project's chat lists and reads only its own, a chat outside one only the global ones. To use one
elsewhere the owner copies it (`surfaces.copy`: into another project, or global with no project), opens it as an
app from the sidebar in any project, or publishes its link; an agent never reaches into another project's widgets.
Files come in only if a widget needs more than one (scripts, images) or a history of its versions: then its content
goes to `projects/<id>/widgets/<name>/` and the row keeps the rest.

<a id="d-056"></a>
## D-056 — 2026-10-08 — Computer use ships on macOS; total autonomy clicks without asking, the turn limit still asks
The spike passed on a real Mac (three screens, System Settings and Chrome), so computer use is a product feature,
off until the owner turns it on in Config › Desktop. Looking asks (`ask`); clicking, typing and keys are `always`, so
in total autonomy they run without a question, as D-047 says for every `always` tool. What still holds in total: the
switch itself, the two macOS permissions, the emergency stop (it ends every run using the computer, for that turn
only), the question every 60 actions in one turn (a question, not a confirmation, so autonomy does not skip it), a
refused password field, a refused click where another app's window covers the point, and a real click that waits for
the owner's mouse to rest. Reading every element of a large window can outlast its time limit: the look then comes
back with the picture alone and says so. Windows and Linux do not lend the capability yet.

<a id="d-057"></a>
## D-057 — 2026-10-08 — Security holes closed for the beta
The G0 audit (plan/parity/07-seguridad.md) left holes open for the owner to decide; for the beta they are closed:
- **Claude Code loads only the owner's own settings.** A repo's `.claude/settings*.json` could allow tools or run hooks
  that skip APX's approval; now `settingSources` is `["user"]` and APX reads the folder's `CLAUDE.md` itself (not
  through a link) and appends it to the prompt. A repo's own Claude skills and `@` imports are no longer loaded.
- **A URL that carries values asks after outside content.** `web_read`, `browser_open` and `browser_navigate` with a
  query are `untrusted`: with a page or a message in the turn, `?d=<data>` to someone's site waits for the owner.
  A plain URL does not. Data in the path is not caught.
- **Plugins reach the local network only if they ask.** With `"network": true` a plugin reaches the internet; the
  private ranges (10/8, 172.16/12, 192.168/16, the tailnet's 100.64/10, fc00::/7, multicast) need
  `"local_network": true` as well, shown to the owner before turning it on.
- **Engine sessions keep what they read.** Claude Code and Codex keep their own context between turns: once a turn of
  theirs read outside content, the thread's log keeps an untrusted note, so every later turn of that session starts
  untrusted, as a native turn with the same history would.
- **Codex in an `auto` code chat writes only when the agent may act.** It runs read-only (and tells the owner why)
  when the agent asks before acting, or when outside content is in the session; total autonomy still writes.
- **A variable never goes in an MCP server's args.** The process list shows a command's arguments to anyone on the
  computer: `mcp.set` refuses `secret://` there, and a server that still has one does not start, saying to use env.
- **Accepted: a shell command the owner approves can call APX's local API.** A token file would not stop it (the
  command runs as the owner and can read it, and an Origin header is easy to forge); the child's environment has no
  APX secrets, and every non-trivial command asks in standard autonomy. The real fix is an OS sandbox for commands.
- **Contact names stay one line, and task titles the owner did not write are outside data.** A name from a channel
  (a contact's, a room's) sits inside APX's sentences and the contact prompt without newlines, tags or quotes, capped.
  `task_list` and `task_update` wrap the list when a title came from an agent (a contact's request among them), as the
  task's own chat already did; a board of the owner's own tasks stays plain.
- **The log redacts credentials.** Every line passes a redaction step: string fields named like secrets (token,
  password, api_key, authorization, cookie…) become `[redacted]`, and key shapes anywhere in a string (`sk-`, `ghp_`,
  `xox?-`, `AIza`, bot tokens, JWTs, `Bearer …`, `?key=`) too. `secret://` references and counts stay.

<a id="d-058"></a>
## D-058 — 2026-10-08 — Google Calendar and Gmail are APX's own tools behind the owner's Google sign-in
The owner brings their own OAuth client (Cloud Console, Desktop app or Web application); APX ships no client id. The
sign-in needs no route of its own in the core: the redirect URI is the panel's `/oauth/google` page on the core's
loopback address (the SPA fallback serves it), and that page hands the code to `integrations.oauth_finish`. The
consent URL carries PKCE (S256) and a state signed with a per-process key, valid ten minutes and used once. The
client secret and one refresh token per integration are secrets; access tokens live only in memory. The tools are
built-in tools with `Tool.when` (offered only while that integration is connected and on in the thread's project),
not an MCP server: no maintained server takes a refresh token by reference, a server per account would hold tokens
outside the core, and the tools need APX's confirmations and outside-data framing. Events and mail come back as
untrusted data; creating or changing an event and writing a draft are `ask`; mail leaves only as a draft the owner
approved sending (`gmail_send_draft`, `always`), never in one silent step.
