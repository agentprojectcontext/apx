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
disk image to drag in (unsigned, so no silent install; replaced by [D-058](#d-058)). Every platform is built from any computer (`pnpm package:<os>`):
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
## D-047 — 2026-10-07 — Total autonomy asks for nothing; low-impact tools stop asking in standard (amended by D-140)
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
off until the owner turns it on in Config › Desktop. Looking asks (`ask`; outside Manual it no longer does, D-109); clicking, typing and keys are `always`, so
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
  A plain URL does not. Data in the path is not caught. Since [D-121](#d-121) the card says so, and `browser_navigate`
  is part of `browser_open`.
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

<a id="d-103"></a>
## D-103 — 2026-10-08 — Google Calendar and Gmail are APX's own tools behind the owner's Google sign-in
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

<a id="d-058"></a>
## D-058 — 2026-10-08 — The desktop app downloads its update and asks when to restart
D-044 had macOS open the disk image for the owner to drag in, because an unsigned app cannot use the system's silent
updater. The app now replaces itself without it: it downloads the release's `.zip`, checks its `.sha256`, unpacks it
beside the running `APX.app`, and swaps the two once APX (and the core it runs from inside the bundle) has quit, putting
the old one back if the swap fails. A file the app downloads itself carries no quarantine flag, so nothing asks again.
The update is found by the app's own check (every 6 hours; the first a minute after start) and downloaded on its own;
it then says once that it is ready (a notification, the top bar's pill, the corner card) and goes in when the owner
picks "Restart now", or when they quit APX. Started from the app menu ("Check for updates…", "Update to APX x.y.z…")
or the panel, it asks right away: restart now or later. While one waits, the app menu says "Restart to update to APX
x.y.z". The AppImage works the same way (its file is replaced at once and the next start is the new one); Windows
keeps its installer, which runs on "Restart now" only, since it reopens APX when it ends. Where the app cannot write
its own place (a read-only folder, run from the disk image, a translocated copy) macOS still opens the disk image. An
unsigned build keeps losing the macOS permissions (Accessibility, Screen Recording) at each update, as it did with the
drag; only a Developer ID signature ends that. `APX_RELEASES` also takes a base URL, so a local feed can stand in for
GitHub to try an update between two builds (`APX_VERSION` names a build's version in `pnpm package`).

## D-059 — 2026-10-10 — Agents change routines through `routine_set`, and the owner approves each call
D-016 kept routines owner-only until an agent creating standing work had a confirmation design. D-047's `always`
level is that design: `routine_set` creates a routine, changes one by id or name (only what it is given), turns it on
or off, or runs it now, and every call waits for the owner's yes (total autonomy, the owner's explicit choice, asks
for nothing). The approved call runs `routines.set` / `routines.run` as the owner's act (`callAsOwner`), the same door
the app and `apx routines edit` use. It never sets a pre- or post-command or a shell routine: those run commands on
the owner's machine on a schedule and stay in the app and the terminal. Removing a routine stays the owner's too.
`routine_list` with a name returns that routine's whole prompt, so an agent edits the text it read, not a guess.

## D-060 — 2026-10-10 — The super-agent runs the team with `agent_set`; the owner approves each change
v1 had nine tools to manage agents (create, import, configure, rename, remove, set a prompt, set identity…), offered
to every agent. v2 has one, `agent_set`, and only the super-agent gets it (policy.ts filters it out for every other
agent, whatever its `tools:` list says): with only `agent` it reads that agent's definition and whole prompt (no OK
needed); otherwise it creates one, changes only the fields given (name, role, description, prompt, personality,
parent, a project agent's slug) or archives it, through `agents.create` / `agents.update` / `agents.archive` as the
owner's act, each call waiting for the owner's yes (D-047 `always`; total autonomy asks nothing). Autonomy, tools,
models and the browser profile are not among its fields: how far an agent may act stays the owner's own setting. A
rename keeps the agent's id, so threads, tasks, routines and messages that point at it need no rewrite; a project
agent's new slug keeps the old one as an alias and moves its reports' `parent` along.

<a id="d-059"></a>
## D-059 — 2026-10-10 — A sealed chat may search the web, as its channel allows
D-014 sealed rooms and contacts' chats with no tools, so the owner asking the agent in a public Discord room to look
something up got "I can't from here". A channel now says who may have its sealed chats search the web and read public
pages (`research`: `off`, `owner`, `everyone`; unset means `owner`): `owner` opens it only to a turn the owner started
(their message in a room, checked by account, or their words in a contact's chat from the app). It adds exactly
`web_search` and `web_read` and nothing else: no shell, files, browser, memory, projects or MCP. Both tools already
reach only public addresses (resolved names included, never this machine or the local network) and return untrusted
data; a page's address carrying values still asks after outside content, as D-057 says. What a sealed turn could leak
through them is only what it holds: the room's public talk, or a contact's own chat (and the owner's general
notes, where the owner let that person's chat read them).

<a id="d-061"></a>
## D-061 — 2026-10-11 — An outside engine's session has an idle deadline, not a fixed one
Rule 9 gives every turn a deadline. A Claude Code, Codex or ACP session works for long stretches on its own (a build,
a test run, a refactor), and any fixed limit cut real work mid-way and showed it as "aborted by user". Its run's
deadline now moves: the turn ends only after `ENGINE_IDLE_MS` (20 minutes) without a single event from the engine
(a token, a tool's progress heartbeat, a status). Each event restarts the clock, and the run's `deadline_at` is
rewritten at most once a minute, so the persisted deadline stays honest. While the engine waits for the owner's OK the
clock is held, as for any turn. The owner can always stop a session; a stopped-for-silence turn fails with that reason
and reaches the tray like any other failure. Chat turns on our own loop keep their fixed minutes.

<a id="d-062"></a>
## D-062 — 2026-10-11 — An "always" OK covers APX's own tools too, per agent, and the owner manages it
Only MCP tools could be approved for good: approving one of APX's own tools (writing a file, messaging a contact, a
command that changes something) held for that call alone, so an agent on standard or ask autonomy asked again every
time. Each built-in tool now carries an approval target too (`apx:<tool>`), so its confirmation offers the same three
answers as an MCP tool's: once, in this chat, or always for this agent. The grant lives with the MCP ones
(`tools.approvals`, `tools.revoke`) and shows in the agent's editor, where the owner revokes it. A call that always
asks (a destructive or APX-reaching command, a routine or agent change, iMessage, the owner's browser login) never
uses a grant, and `grant_tool` still hands on MCP tools only: APX's own are the owner's to allow. An agent's editor
also sets its `tools:` and `skills:` lists (written to a project agent's file); [] goes back to all of them.


<a id="d-063"></a>
## D-063 — 2026-10-11 — The owner works a room from the app, and the owner's turns there may mention people
Asked in a room's chat in the app to thank someone there, the agent answered the owner in the app: nothing reached the
room, and D-041 forbade mentions anyway. A room's chat now works like a contact's: what the owner writes there in the
app is an instruction nobody in the room sees (framed as `<owner_instruction>`), and the agent's answer is posted in the
room; "I'll write" (`channels.send`) posts the owner's words as they are, through the bot's account, the only one APX
has there. Mentions: an incoming `<@id>` reads as `@username`, and an answer's `@handle` pings that person only when
they wrote or were mentioned in that room's latest 500 messages and the turn is the owner's (from the app, their
message in the room, or `channel_post`). A member's turn still pings nobody, so no one can make the bot ping others;
@everyone and @here never ping. The turn stays sealed (D-041, D-059): it gains no tools. The owner's words said in
the room (on Discord, or "I'll write") are `direct`; their words from the app are not, and a room's turn reads its
latest five apart from the room's talk, as words nobody there saw (a migration marks the older ones the room received).

<a id="d-064"></a>
## D-064 — 2026-10-11 — On WhatsApp the owner's agent writes to people and rooms itself
WhatsApp turns of the owner only kept notes and delegated, but what the owner asks to send cannot be relayed to another
agent (it would act on authorization passed through the first), so "post this in #help" from WhatsApp could not be
done at all. Those turns now also have `message_contact`, `channel_post`, `channel_list`, `contact_list` and
`read_chat`; anything else still goes to an agent through `delegate`. A send asks first as on any channel (after
outside content, unless autonomy is total), and on WhatsApp its confirmation arrives as numbered options in that chat.

<a id="d-065"></a>
## D-065 — 2026-10-11 — An agent's send waits for the platform's answer; rooms are picked from the bot's servers
`message_contact` and `channel_post` said "queued for delivery" before anything was sent, so when Discord refused a
post (the bot had no "Send messages" in that room) the agent told the owner it went. `channels.message` and
`channels.post` now wait up to 8 seconds for the outbox item to settle and return its `delivery` (sent, refused with
the platform's reason, uncertain, or still queued when the channel is down), and the tools tell the agent to pass that
on. Rooms are added by picking them from the servers the bot is in (`channels.rooms`), each marked when the bot may
not write there, computed from the server's roles and the room's overwrites; typing an id stays as a fallback.

<a id="d-066"></a>
## D-066 — 2026-10-11 — A delegation names its project
A session another agent started from Home had no project, so the agent asked worked in APX's work folder and could not
read the repository the task was about. `delegate` takes `project` (an id, a name, or a path inside the project's
folder, the deepest project holding it): the session is created in that project and works in its folder. Without it,
the session takes the caller's chat's project, else the asked agent's own. A project's own agent can only name its
project; a session already in another project is not moved.

<a id="d-067"></a>
## D-067 — 2026-10-13 — A turn on our own loop also ends for lack of progress, not at a fixed minute
D-061 kept six fixed minutes for turns on our own loop. A turn in the browser or on the owner's computer gets 60 or 150
steps, and six minutes cut it mid-way with "the turn ran out of time" while it was still working. Its deadline now moves
like an outside engine's: each token and each tool result restarts the six minutes, and a turn that goes six minutes
without either is stopped with that reason. Its step limit still bounds it, each tool keeps its own deadline, waits for
the owner hold the clock, and a turn delegated by another agent keeps its fixed ten minutes (its caller waits on them).

<a id="d-068"></a>
## D-068 — 2026-10-13 — An agent delegates for what the other one has, and APX tells the caller what the delegate did
The delegation rule said "if another agent's role covers the request, delegate it", and the seeded designer's role
named widgets: the secretary loaded the widgets skill, gathered the data, then handed the widget off, and the designer
loaded the same skill again. A widget, a document or a chart is the answer's form, and every agent has those tools. The
rule now delegates only when the other agent has what the caller lacks (its own project, tools or knowledge, a session
with context) or the task is big and separate, and work already started is finished by whoever started it. The
designer's seeded role is visual design (brand, layouts, design reviews, multi-screen apps). A delegated run's result,
inline or in a later turn, now carries APX's own list of its calls with an effect and how each ended, outside the
agent's words, so the caller does not read a widget or a file back to check it. A chat's storage kind shows as "chat"
in the system prompt: shown as "loose", a model passed it to `delegate` as a project's name.

<a id="d-069"></a>
## D-069 — 2026-10-13 — The owner sets how far agents go on their own; agents make projects through `apx projects`
The breaker's 16 turns and 600k tokens (counted since the owner last wrote in a conversation tree) were constants: an
owner whose agents research for a while hit "Paused" with no way to move it. They are now the owner's, in Config ›
Agents (`agents.limits` / `agents.set_limits`, setting `agent_limits`), each one on or off (0 = no limit), and the
paused notice links there. Unset, the defaults in `engine/limits.ts` hold. Agents had no way to make a project:
`projects.create` is owner-only and no tool covered it. Following the footprint ladder (rule 15) it is not a new tool
but `apx projects create|set` plus the `apx-projects` guide: `shell` running `apx` always waits for the owner's OK
(total autonomy, their explicit choice, asks for nothing), the same door as `apx mcps` and `apx secrets`.

<a id="d-070"></a>
## D-070 — 2026-10-13 — A team is copied into another project, never shared, and the copies may take new names
An owner wanted a second project with the same team. An agent belongs to one project (its file is in that project's
`.apc/agents/`, its memory and chats are its own), so one agent in two projects is not offered: `agents.clone` copies
the whole definition (role, prompt, tools, skills, area, personality, autonomy, model) as new agents, keeps reports
under their cloned boss and never copies the super-agent, routines or memory. Two agents with one name read as a bug,
so the copies take new free names by default (`rename`, from `AGENT_NAMES`, now about 200 names); the owner can keep
the names. The owner does it from Team › Import › Another project; agents through `apx agents clone` (the shell asks
the owner), taught by the `apx-projects` guide, instead of recreating each agent with `agent_set`.

<a id="d-071"></a>
## D-071 — 2026-10-14 — The owner's own agents are the owner's side, not outside content
A team working a task stopped at every file it wrote: what one agent asked another (a delegation, a task it made, an
@mention) arrived wrapped as untrusted, so the next agent's whole turn counted as "outside content" and every write
waited for the owner, who had asked for the work in the first place. Text written by one of the owner's agents (a
request, a delegated answer, a task with no contact on it, a session list) is now enveloped as `trust="team"`: still
marked as another agent's words, but not outside content. What an outside app's agent sends (`external`, `client:…`),
a contact's words (a task with a person, a channel message), web pages, files, command output and widgets stay
untrusted. The trade: an agent that read a hostile page can now pass its words on to a teammate as the team's. What
limits it is unchanged: `always` actions still ask outside total autonomy, a delegated run works under the strictest
autonomy up its chain, and each agent's own reading still taints its own turn.

<a id="d-072"></a>
## D-072 — 2026-10-14 — Autonomy is set per project, agents inherit it, and "accept edits" sits between standard and total
A team building something in a project stopped at every file and command: standard autonomy asks for anything that
writes once a command's output or a page is in the turn, and a developer reads command output all the time. The only
way out was total, set agent by agent. Following Claude Code's modes, autonomy has a fourth level, `edits`: as
standard, but the tools that work in the agent's folder (`file_write`, `file_edit`, `shell`, an outside harness's edit
or command inside its folder) run without asking whatever the turn read; what always asks still does (destructive
commands, commands that reach APX's API, APC files and AGENTS.md, now `always`), and so does what leaves the machine
(messages, the browser, URLs with values). Codex writes in its sandbox under `edits`. A project has an autonomy
(Project settings, `projects.update`, `apx projects set --autonomy`), the base project too for global agents, and an
agent with none of its own takes its project's ("The project's: …" in its detail; `agents.update` with `autonomy:
null` gives it back). The project's is kept in APX's database, not in `.apc/project.json`: a folder someone else
wrote cannot raise it. A delegated run still works under the strictest autonomy up its chain. Claude Code's `auto`
mode (a model judging each risky call) is not copied yet.

<a id="d-073"></a>
## D-073 — 2026-10-14 — An @mention of a teammate on a task is a consult, not a chat of its own
D-048 gave every agent @mentioned on a task its own chat for that task and posted each answer back as a comment.
A real run with three tasks and three agents who mentioned each other ended with eight chats on three tasks, every
answer twice (in the chat and as a comment), and agents treating a question as their whole task. Now only the task's
own agent works in its chat for the task (an @mention of it still asks it there). Anyone else @mentioned, by the
owner or by an agent's answer, answers in a consult: an `a2a` sub-thread of the task's conversation holding the
question and the answer, like a delegation, shown in the conversation as a card that names the task and who asked
(`asked_by` on the sub-thread part) and fills in with the answer. Nothing is copied: the question is the comment
above the card. The answer's own @mentions cascade the same way, two hops deep. Whoever spoke on a task joins its
conversation's `agent_ids`, so the list shows a group, and the phone shows a card's answer, not only its title.
An agent assigning a task or @mentioning a teammate no longer waits for the owner while outside content is in its
turn (command output always is, for a developer), as `delegate` never did: the teammate's turn runs under its own
autonomy, gated where it acts.

<a id="d-074"></a>
## D-074 — 2026-10-14 — An agent answering another one asks no one else
Delegations were capped at two levels counted by sub-threads, but a task's work chat has no parent thread, so every
hop through the board started the count again (owner's agent → orchestrator → a task → its agent delegating → …);
real runs reached depth 3, and a consult's answer @mentioning someone asked them too, two hops deep. Now the rule is
one hop: an agent working for another one (a delegation's sub-thread, a consult on a task) does the work itself and
calls nobody. It is not offered `delegate` (`MAX_DEPTH` 1), `delegate` refuses from an `a2a` thread, its task
comments summon no one, and a consult's answer asks nobody (this replaces D-073's two-hop cascade). The board stays
open: it may still create and assign tasks, which start their agent's own work, bounded by the turn's depth
(`MAX_MENTION_DEPTH`). The owner's agent, and an agent working its own task, can still delegate and consult. Amended by
[D-077](#d-077): the delegate names who owns the rest and the caller asks them.

<a id="d-075"></a>
## D-075 — 2026-10-14 — The core gives agents their own `apx`
APX's guides teach agents to use the `apx` command (projects, agents, tasks), but it only existed after the owner
ran "use v2 as apx" or install.sh, and an agent's shell does not read the owner's profile, so on a desktop install
agents got `apx: command not found` and stopped. At start the core writes `<home>/bin/apx` (`apx.cmd` on Windows): a
launcher of its own terminal with this core's home and port (never its token, which the CLI reads from the home as
for the owner) and puts that folder first on the PATH of everything agents run (shell commands, MCP servers,
Claude Code, Codex, ACP agents). Running `apx` from a shell still asks the owner as before (D-069).

<a id="d-076"></a>
## D-076 — 2026-10-14 — A task an agent gave to another reports back to it when it closes
Since D-074 an agent working for another one cannot delegate, so handing a whole goal to an orchestrator that runs
its own team goes through the board: the owner's agent creates a task assigned to the orchestrator, which works it
in its own durable task chat and may delegate from there. But a close woke nobody: the creator learned of it only by
reading the board. Now the task's create event records the chat and turn an agent created it from (`from_thread`,
`from_run`), and when another of the owner's agents closes it (`task_close` done or dropped, or a settled
commitment) its creator gets a turn there, like a delegation's result: trigger `a2a_result`, origin `task_result`
(task, title, state, closer), and as input the closer's last comment on the task plus its closing note, enveloped as
the team's words (D-071). A close made from the closer's own chat for the task reports when that turn ends, so its
final answer (posted as its comment) is the report. Nobody is woken when the owner created or closed the task, when
its creator closed it, or when it was created from a chat answering another agent (D-074: that chat's caller has
moved on). Each close reports once (`close_reported` on the task's conversation); reopened and closed again, it
reports again. The wake counts against the unattended limits of the creator's conversation: past them the report
is kept for its next turn and the owner sees the paused notice, as for a delegation's result.

Corrections are explicit: `tasks.close` / `task_close` with `state: "open"`, `rework: true` and a nonblank `note`
reopens a closed, assigned task and admits a turn in its existing work chat. The reopen, visible reason and run link
are persisted together. Scope and hand-off permissions still apply; active task work or paused agent limits refuse
the request without changing the task, so it can be retried after the blocker is cleared. Plain reopening and
ordinary updates never request corrections. A subsequent delivery uses the same close-report path above.

<a id="d-077"></a>
## D-077 — 2026-10-14 — A delegate names who owns the rest; the caller asks them
Amends D-074. With one hop, a delegate asked for something that is another agent's work could not ask them, so it
guessed: told to "ask Roby for the latest version", it looked it up on the web itself, got it wrong and never said it
was Roby's; the caller never asked Roby either. The agent that owns the session coordinates; helpers answer and point.
A delegated or consulted run's input (origin `agent`, the owner's own agents) now says to do its own part and name
the agent that owns the rest, by id, instead of guessing it, and its roster in a sub-thread lists the other agents
as ones to name, not to delegate to. The caller's side, both the inline `agent_reply` when it waited and a later
`delegation_result`, says that if the answer names another agent for what is left, it asks that agent itself with a
new delegation of only that part (never the same task again). The delegate still has no `delegate` tool; this lives
in per-turn inputs, not the system prompt (PROMPT_SIZE.md).

<a id="d-078"></a>
## D-078 — 2026-10-14 — An agent asks a teammate only with `delegate`; only the owner's @mentions summon
Agents had two ways to ask each other: `delegate`, whose answer comes back to the caller, and an @mention in a task
comment or a task chat's answer, which opened a consult whose answer only filled a card on the task. The agent that
asked never got that answer, yet each casual @name started a paid turn. Now an agent asks with `delegate` only: its
@mentions (in `task_comment` or in its answer posted to a task) summon nobody, and its task block and the
`task_comment` tool say so. The owner's @mentions on a task work as before (D-073): the task's agent in its chat for
the task, anyone else in a consult. An agent's @owner still asks for the owner's attention.

<a id="d-079"></a>
## D-079 — 2026-10-15 — A task made while working a task is its subtask; an agent answering another gives nobody work
Since D-074 an agent answering another one could not delegate, but it could still create a task with an assignee,
whose work started at once, and that agent could delegate again: a chain through the board. Now an agent answering
another one (a delegation's sub-thread, a consult) cannot give task work to anyone (`tasks.create` and
`tasks.update` refuse an assignee from an `a2a` chat). `task_create` preserves the requested assignee: a refused
handoff creates nothing, and the delegate proposes the work and its responsible agent to its caller instead.
A task an agent creates from a chat about a task (its own task chat, a consult on it, a session under one) is that task's subtask (`parent_id`) unless it names
another parent, so the work an orchestrator splits stays under the task it was given. `tasks.get` lists a task's
`subtasks`, and the task panel shows them and the task a subtask is part of. A real run showed a caller told "assign
it to Roby" delegating to Roby to assign it to himself, which the answering Roby could not do: the caller's note now
says a task the delegate left for someone is assigned with `task_update`, and the refusal says an answering agent starts
no task work, its own included. Amended by [D-120](#d-120): a consult the owner opened may hand out work.

Agent-created subtasks require both an assignee and a non-empty description, checked by `tasks.create` before any
record or conversation is written. `tasks.update` refuses to clear either through an agent call. This also applies
to an explicit parent and to tasks created in a task's work chat or a session beneath it. Missing fields return an
argument-specific error: there is no orphan record for a caller to forget. The owner may deliberately keep drafts
unassigned or unspecified, and top-level agent drafts used to prepare cross-project work still follow their existing
flow. Status-only updates and closure remain available for legacy incomplete subtasks. The existing handoff and
spend limits still govern the assigned work; this does not start work from an answering agent.

<a id="d-080"></a>
## D-080 — 2026-10-15 — A task chat an agent started spends against the chat it came from
The breaker (D-069) counts unattended turns and tokens over a conversation tree, found through `parent_id`. A task's
work chat has no parent, so every task an agent gave started a tree of its own with a fresh budget, and starting a
task's work never looked at the breaker at all: work handed on through the board was not limited. Now the chat a
task's work runs in records the chat whose agent gave it (`asked_from` in its context), and the breaker's tree climbs
and descends through that link as through sub-threads, so a superagent's chat, the orchestrator's task chat, the
tasks it gives and their delegations share one budget, reset when the owner writes anywhere in it. An agent giving a
task while that tree is paused does not start it: the start is kept in the giving chat (`held`) and the owner sees a
`breaker.held` notice there naming who starts what once they let agents go on.

<a id="d-081"></a>
## D-081 — 2026-10-15 — A paused chain goes on with a fresh budget or with no limit this round
With task chats in one tree (D-080), 16 turns or 600k tokens can stop a long orchestrated task halfway, and "write to
continue" meant typing something to let it go on. A paused notice (`breaker.paused`, `breaker.held`) now names its
chat (`vars.thread`) and offers two buttons over `threads.go_on`: **Restart the budget** (`reset`: the count starts
again from now, on the tree's top chat as `budget_from`, so the agents get another full budget) and **Let them finish
this round** (`release`: no limit in that tree until the owner next writes there, `released_at`). Either one starts
the tasks given while paused (`held`) and gives a turn (origin `go_on`, trigger `system`) to each chat that kept a
result or report while paused (`kept`), so the chain goes on without the owner typing. Limits set to 0 in settings
still mean no limit at all, and the owner writing still resets the count as before.

<a id="d-082"></a>
## D-082 — 2026-10-15 — How far agents hand work on through the board is the owner's limit, never a silent cut
A task's work started by an agent was dropped past two hand-offs (`MAX_MENTION_DEPTH`) without a word: `task_create`
still answered "starts on it now", and an hour later the pickup started it as if the owner had asked, with no limit
at all. With an answering agent giving nobody work (D-079) and every task chat inside its giver's budget (D-080), the
fixed depth goes: the breaker, as the owner set it (0 = no limit), decides. A start it holds is reported truthfully
(`task_create` and `task_update` say it has not started and why, and not to assign it again), the hourly pickup
leaves held tasks alone, and they start when the chain may go on: the owner writing in that conversation tree, or
either button of D-081.

<a id="d-083"></a>
## D-083 — 2026-10-15 — The owner writing on a channel renews the budget; a refused delegation shows the way on
The breaker's window started at the owner's last run with trigger `user`, so an owner who talks to the agents over
Telegram (trigger `channel`) never renewed it: every delegation stayed refused with the same spent total, and the
refusal was a tool result only, with no notice and no buttons. Now a `channel` run whose origin role is `owner` counts
as the owner writing; a contact's message on a channel still never does, since a third party must not reset the owner's
limit. A delegation the breaker refuses posts the same `breaker.held` notice as a held task (D-080), once until the
chain goes on, and marks the caller's chat `kept`, so either button of D-081 gives the caller a turn to ask again. The
two buttons stay distinct and the limits are never lifted without the owner choosing one.

<a id="d-084"></a>
## D-084 — 2026-10-15 — The core's log is one file in its home, however it runs
The desktop app's core logged to Electron's logs folder, the service to `<home>/logs/core.log` (Linux: only the
journal) and `pnpm dev` only to its terminal, so the docs could not name one place and the panel could not show it.
Now the core's logger also appends to `<home>/logs/core.log`, unless its stderr already is that file (the desktop
app and the launchd/Windows service send its output there; comparing the device and inode avoids writing every line
twice). Whoever owns the file rotates it at 20 MB into `core.log.1` when the core starts. Reading goes through the
protocol (`system.logs`, human only: lines may name contacts and chats), filtered in the core, so the panel's
Settings › Logs and `apx logs` work for a remote core too; `apx service logs` still reads the local file.

<a id="d-085"></a>
## D-085 — 2026-10-15 — An agent may have a budget of its own inside the chain's
The breaker counted one budget for the whole conversation tree, so a coordinator only learned it was out when a
delegation was refused, and could not steer work away from one agent spending most of it. The owner can now give a
single agent its own turns and tokens (`agents.set_agent_limits`, kept in the `agent_limits` setting beside the chain's;
unset or 0: none of its own). It is counted in the same window as the chain's (since the owner last wrote, a reset or a
release of D-081 renews or lifts both), over that agent's unattended turns in the tree. The chain's limit stays the
outer one. Past its own budget, a delegation to that agent is refused to the caller with no notice and no hold, so the
caller picks someone else or tells the owner; a task given to it is held with a `breaker.held` notice of variant
`agentRuns`/`agentTokens` and starts when the owner lets agents go on. `list_agents` reports what the chain and each
agent with a budget have used, in the tool result (not the prompt). A delegated turn's run row is created in the same
synchronous step as the check, so delegations racing in one turn count each other's turns; tokens count once spent.

<a id="d-086"></a>
## D-086 — 2026-10-15 — A widget shows its project's media as bytes the panel hands it, never by URL
A widget could only show media inlined as data: (under the 400 KB HTML cap), so a reel preview could not play the
project's own MP4. The widget now names the file (`data-apx-src="clips/reel.mp4"`, `media:<id>` for a file APX stored,
or `apx.media(ref)` from script); its frame asks the panel over postMessage, the panel calls `surfaces.media` (human
only) and moves the bytes into the frame, which loads them from its own `blob:` URL. The CSP is unchanged: no media
URL, no route outside the protocol and no origin the frame could reach, which a scoped URL in `media-src` would have
needed (and a token in it, since the opaque-origin frame carries no credentials). The core decides scope: a path in
the widget's project folder (the base project's for a global widget), never outside it or into `.git`; a stored file
only from one of that project's chats; images, video and audio only, up to 15 MB; and only refs written in the
widget's HTML, so what a widget can load is fixed when it is written and visible in `read_widget`. The trade-off: a
widget with `connect` origins could send those files out, as it could anything else it shows; that is why a widget
with `connect` already asks the owner while outside content is in play. A published artifact (`/a/<token>`) does not
resolve these refs.

<a id="d-087"></a>
## D-087 — 2026-10-15 — CI checks the commits a push or pull request brings, never published history again
`verify` ran `pnpm check:commits HEAD` on every push, rescanning the whole public history, so one commit already
published there (b3d609e0, a pull request merged in GitHub's web UI under the account's own email) failed every run
after it, and nothing short of rewriting public history could clear it. History is never rewritten once published
(RELEASE.md#history), so the check now covers what each run adds: a pull request's own commits (base..head), a push's
new ones (before..after), and for a new branch or tag, or a `before` no longer in the repo, whatever `release/v2`
lacks. A commit that brings a personal email still fails the push that brings it; the gate moved, it did not loosen.
GitHub's own web-flow committer (`noreply@github.com`, the same for everyone) is accepted as a committer, never as
an author: a pull request merged in the web UI passes when the merging account keeps its email private (GitHub's
"Keep my email addresses private"), and fails when it does not. The trade-off: after a force-push to `release/v2` its
old `before` is gone and the run scans nothing; a published branch is never force-pushed (RELEASE.md#history).

<a id="d-088"></a>
## D-088 — 2026-10-15 — A supervised contact gets drafts, never answers on its own
Between answering a contact on its own and silencing them there was nothing: the owner who wants to see what the agent
would say before it goes out had to read the chat and write it themselves. A contact can now be **supervised**
(`persons.supervised`, set by `contacts.set`; silenced and supervised exclude each other, setting one clears the
other, and silenced wins if both were ever stored). Their messages are kept as a silenced contact's are (voice notes
transcribed, since the draft needs the words); once a burst settles (15 s), one model call with the same sealed
contact prompt over their chat and no tools drafts the reply (`engine/suggest.ts`, the agent's own API models, its
tokens kept as an auxiliary call of purpose `suggestion`). The owner gets who wrote, everything they said since they
were last answered and the draft, on their channel and in the tray, with "Send this", "I'll answer" (their next words
on that chat go to the contact as theirs, for 10 minutes) and "Ignore". Drafts are rows of `suggestions`, pending
until sent, discarded or replaced by a newer draft of the same chat; `contacts.suggestions.list|send|discard` are the
same choices for any client (owner only). A sent draft goes out as the agent's message, through the outbox, and
enters what the agent reads next. At most 10 drafts per contact per hour; past it their messages are only kept and
the owner is told once. A burst cut by a restart gets no draft until their next message.

<a id="d-089"></a>
## D-089 — 2026-10-16 — A call that always asks can be approved for the chat or for the agent
A call that always asks (D-047, D-059: a routine change, a destructive command, iMessage, answering a contact…) took
no standing grant, so its card had only "Approve" and "Deny": an agent creating a routine, running it to test it and
fixing its prompt asked five times in one chat, with no way to say yes for the rest. Now its card offers the same four
answers as any other: once, for this chat, always for this agent, and deny. Its grant has its own key (the tool's key
plus `#always`), so an OK already given for a tool's ordinary calls (a plain shell command) never starts covering its
calls that always ask (a destructive one), and the agent's permissions list says which grant is which. Like every
grant the owner gives, it holds with outside content in the turn too: the owner picks it on the card, and revokes it
from the agent's permissions. External agents' own tools (ACP) still get a yes for that one call only.
`routine_set` also says to create or change a routine and run it in one call.

<a id="d-090"></a>
## D-090 — 2026-10-16 — An agent's own rules by kind of action, and grants narrowed to a condition or a date
Autonomy is one dial for every action, so an owner who wanted an agent to edit the project freely but ask before every
message had to pick between `ask` (it asks for everything) and `standard` (it writes without asking but also sends when
nothing outside is in the turn). Now each call falls into one of four risks, decided in `tools/policy.ts` from what the
tool already declares: a call that always asks is **irreversible**; otherwise `effect: none` **reads**, `local`
**writes** the project, `external` and `message` act **outside**. An agent's `rules:` (in its file as
`rules: write=auto, outside=ask`) sets `auto`, `ask` or `off` per risk, over its autonomy: the owner chose it for that
kind of action, so `auto` runs with outside content in the turn too, as `total` does (D-047); `off` takes the risk's
tools out of the turn and refuses a call that turns out to be that risk (a shell command that deletes). A risk with no
rule follows the autonomy as before. A delegated run takes, per risk any agent in the chain ruled on, the strictest of
what each would do on its own (a rule, else what its autonomy amounts to), so a caller's `auto` never loosens a
helper. Owner grants still go over `ask`. The editor turns an agent that followed its project into one with its own
rules for every case the first time one changes, after saying so, so later project changes do not half-apply.
A grant for good can now carry a `condition` (comma-separated paths, domains or names: it covers a call only when one
of its text arguments starts with one, or is a URL on that domain) and an `expires_at`, after which it is gone; it also
keeps when and from which chat it was given (`tools.grant_set`). A grant with a condition never counts as using a tool
freely, so it is not handed on to another agent. `orchestrator: true` marks the head of a team explicitly and `orchestrator: false` says an agent is not it; the
guesses by role ("orchestrator", "CEO", "lead") remain only for files that say neither.

<a id="d-091"></a>
## D-091 — 2026-10-16 — A run no one watches gets more steps, and a routine can set its own
Our own loop gave every turn 14 model calls, and a routine that reviews several issues ran out halfway and ended with
"what is left", with no one there to say "go on": the next run started over. A run no one watches (a routine, a task
another agent delegated, a wake from a job or the breaker) now gets 60, the browser's figure; a chat turn keeps 14,
since the owner can ask for more. A routine may set `max_steps` (5 to 200) for work it knows is longer or shorter. The
browser and the computer still raise the limit as before, the repeat check still stops a stuck loop, and a turn that
goes six minutes without progress is still stopped (D-067).

Changed 2026-10-17: a chat turn gets 60 too. At 14, ordinary work (read a few files, edit, run the tests) stopped in
the middle and the owner had to say "go on" for it; the repeat check and the six-minute stop already bound a turn
that loops.

## D-092 — 2026-10-16 — Telemetry: a lifecycle ping for every install, usage numbers only with a yes
We could not tell how many people install APX, how many open it, finish the setup or use it, or how much they use it.
APX now keeps a random install id of its own (`<home>/telemetry-id`, apart from the home id the panel shows) and reports
the steps an install goes through once each — installed, opened, consent (the owner's answer), setup, first_run — and
`updated` on each new version, with the version, OS, CPU and where it came from (checkout, bundle, desktop app). Only
after the owner ticks "Share anonymous usage statistics" (asked in the setup on a fresh install, and once in a dialog on
an install that predates it; unticked by default) does it also send, once a UTC day, totals: tokens in and out over every
model, turns, and how many projects, agents, channels and routines there are. Never names, text, paths, models,
providers, keys or the home id; the first report starts the day after the yes. The settings show the last thing sent.
`APX_TELEMETRY=off`, `DO_NOT_TRACK=1` or `CI` send nothing at all; tests, e2e and perf cores never send.
It lands in the `apx-agents` Firestore through its REST API without an account (the Spark plan has no Functions):
`firebase/firestore.rules` allows only these shapes, stamps every time with the server's clock, keeps a stamped step
from moving and allows no reads or deletes from outside. The sink is one function (`telemetry-sink.ts`), so a backend of
our own (beside the marketplace and accounts) can take an https URL later without touching the core's logic.
Modeled on Homebrew (notice before anything optional, env opt-out), Next.js (anonymous random id, documented events)
and Zed (choice on the welcome screen, a log of what was sent). The lifecycle ping without a yes rests on it carrying no
personal data and being disclosed in the dialog and the privacy page; if that is ever judged not enough, it moves
behind the same checkbox by changing `due()` in telemetry.ts.

## D-093 — 2026-10-17 — The breaker counts fresh tokens, and its defaults follow whoever never changed them
The breaker summed each run's whole input, and every model call of a turn sends the conversation again, mostly from the
provider's cache: three helpers auditing a codebase "spent" 1.15M tokens of which 190k were new, and a 600k limit paused
the chain before the orchestrator could read their reports. It now counts input less cached input plus output, the same
figure providers bill near full price for, and the defaults are 30 turns and 1.5M fresh tokens. Settings saved both
fields on any change, so most installs held the old defaults as if the owner chose them: a migration drops a saved value
equal to a former default (16, 600k), and saving now keeps only what differs from the defaults, so a later default
reaches everyone who never touched it while a limit the owner picked stays.

<a id="d-094"></a>
## D-094 — 2026-10-17 — Telegram groups are rooms, learned from what arrives
A Telegram bot added to a group was silent unless the group was ignored entirely: its messages were marked not private
and had no room, so they were dropped. Groups are now rooms exactly like a Discord server's channels (D-041): deny by
default, a mode per group, sealed public turns, answers in the group as a reply. Called means an @mention of the bot, a
command addressed to it or a reply to its message. The Bot API has no call that lists a bot's chats, so the adapter
reports every group it sees (a message, or `my_chat_member` when it is added or removed) through `io.room`, and the
manager keeps them per channel in settings for the rooms picker; an unlisted group's messages are reported but never
handed over, so nothing of it is stored. Telegram pings any `@username` written in a message, so in a group the
adapter breaks every handle the core did not name with a zero-width space, the equivalent of Discord's
`allowed_mentions`. A group upgraded to a supergroup changes id: the owner picks it again.

<a id="d-095"></a>
## D-095 — 2026-10-17 — A helper's turn recalls its project and the task, not the owner's whole notebook
D-013 gives an agent's first turn the owner's standing global notes. In a delegated turn (input origin `agent`) that
put a dozen notes from unrelated projects in front of a helper handed one narrow task. Now a helper's first turn gets
its project's notes and its own, and a global note only when a match shares at least two distinctive words with the
task text, not counting words every task and owner note use (owner, project, agent, task, repo…); notes of other
projects were never visible. The word test is deliberate: search by meaning fuses ranks and exposes no score to filter
on, so a helper loses meaning-only and cross-language recall of global notes (a note that shares no word with the task
is not shown, whatever its meaning). The search asks for three times the usual hits before the filter, so unrelated
global ones do not crowd out the rest. The owner's direct turns keep D-013 as it was.

<a id="d-096"></a>
## D-096 — 2026-10-17 — A delegation past the cap waits in a queue instead of being refused
With three delegations already running from a thread, `delegate` answered "refused", and an orchestrator fanning out an
audit never asked again: a whole part of the owner's request was never looked at. Now the fourth (and later) is accepted
and queued: its sub-thread, task message, card and run are written at once, the run in a new state `queued` that the
engine never picks up by itself, and the tool says plainly that it starts when one finishes and its result comes back like
the others. When a slot frees, the oldest queued one starts (its ten minutes counted from then), and its result reaches
the caller as any delegation's does. A slot is held by a run at work in one of the thread's sub-threads, whether a
delegation started it or not; a run waiting for the owner's answer gives its slot back, so a question nobody answers never
stalls the queue (once answered, that run may work beside three others). A queued run is cancelled the way an unstarted
one is (stopping the caller's turn or thread, `jobs.cancel`), outlives a restart (the boot starts what fits only once the
cut ones resume, so never more than three), and is cancelled rather than started if its caller's run or thread is gone.
The cap itself is unchanged. A queued run counts against the breaker once it starts, and the breaker is checked again
then: past it, the run stays queued, the owner sees the paused notice once, and letting agents go on (or writing in that
chat) starts it.

<a id="d-097"></a>
## D-097 — 2026-10-17 — A project may have read-only folders: its agents read them and change nothing there
An audit of one checkout against a sibling one failed because the sibling was outside the project's folder: helpers
could not read it, and the only way in was a relative path one tool let through. The owner now adds read-only folders
to a project (Project settings, `projects.update` `read_only_folders`, `apx projects folders`). They are roots of the
one folder rule (`tools/folders.ts`), after the folder the agent works in and its temp folder, so `file_read` and
`shell` read there and every write is refused with the read-only refusal; the first root holding a path decides. A
folder holding the project's own cannot be one: listed as read-only it told an agent its own folder could not change. A shell command is judged path by path: what it reads (a
source, a script it runs, `git -C <dir> log`) may be in one, what it writes (a redirection, the target of `cp`/`mv`/
`rsync`, `sed -i`, `git -C <dir> commit`, any other program run there as its cwd) may not, and a word whose place only
the shell knows (`$X`, `{a,b}`, `$(…)`) may not write while the project has one. That is a static reading of the
command, not a sandbox: a script that builds a path as it runs is not caught, and the docs say so. The system's temp
folders are scratch space beside them (never one holding APX's home, nor other chats' temp folders), so a folder that
holds them cannot be read-only. Each turn's input names them (not the
system prompt). They are kept in APX's database like autonomy (D-072), never in `.apc/`: a folder someone else wrote
cannot widen what its agents read. A folder must be absolute, on disk, outside APX's home and not holding it (its
database and secrets), and not inside the project's own folder (already writable there). Outside agents: Claude Code
and ACP agents ask APX about each of their tools, and reads in these folders now run without asking while any change
there is refused (their commands judged as the shell tool's); Codex's sandbox already reads anywhere and its `additionalDirectories` would make a folder writable,
so it is not given them. The base project has none yet.

<a id="d-098"></a>
## D-098 — 2026-10-17 — A shell command that only reads on this machine never waits for the owner
An agent working on a repository stopped fourteen times in one chat for commands that only looked (`find . | grep`,
`git ls-tree`, `git log --format=…`, `git branch -avv`, `git -C <read-only folder> rev-parse`), every one approved:
the shell tool acts outside (`effect: external`), and only simple commands with plain relative arguments counted as
reading, so anything else asked, with outside content in the turn or not. Now a command line every part of which is a
known local reader (`ls`, `find` without `-delete` or an `-exec` that is not itself a reader, `grep`/`rg`/`ag`,
`cat`/`head`/`tail`/`wc`/`sort`/`uniq`/`cut`/`tr`/`jq`, `sed` without `-i` or a `w`/`e` command, `awk` without printing
into a file, a pipe or `system`, `stat`, `du`, `tree`, `diff`, `echo`, `pwd`, and git's reading subcommands and the list
forms of `branch`, `tag`, `stash`, `remote`, `config` and `worktree`), joined by pipes, `&&` or `;`, writing nowhere
(no redirection into a file, no `tee`, no output option) and with no word only the shell can place (`$X`, `$(…)`), is
risk `read` (D-090) whatever the tool may do otherwise: `read` is `auto` in every autonomy (D-047), so it runs without
asking even with outside content in the turn; an agent's own `rules: read=ask` still asks. Where it reads is not the
owner's to approve but the folder rule's (D-097), which judges every path it names. Anything that reaches the network
(`curl`, `gh`, `git fetch|pull|push`, `npm`), writes, sets a variable or a git option (`-c` can name a program to run),
or that the classifier does not know keeps asking as before. Outside agents' commands (Claude Code, ACP) are judged the
same way. AGENTS.md rule 10 holds: what stops asking has no side effect and no way off the machine.

<a id="d-099"></a>
## D-099 — 2026-10-17 — A read outside the project's folders asks the owner with a card instead of being refused
A refused read told the agent to "ask the owner with ask_owner to add it as a read-only folder": one ran `ls ..` as a
first look, concluded its chat had only a read-only repository, and asked the owner, in a question with a text box only,
to "enable a writable worktree". The owner had nothing to press. Now a read outside the agent's folders, in a project,
is a card on the approval flow: "<agent> wants to read <folder>" with "Only this time" (that call runs with the folder
lent to it, `thread.lent`, after every other root, so other chats' temp folders and APX's home stay closed), "Allow
reading it in this project" (the folder joins the project's read-only folders through the checks `projects.update`
uses, D-097: never APX's home or a folder holding it or the temp folders, so for those only "once" is offered) and
"No". The folder offered is the nearest one on disk holding the path (the parent folder for `..`), not the disk. A shell
command reading several outside folders raises one card for all of them; `file_read` asks the same way (tools declare
`outside`). An agent whose rule for acting outside is `auto` (total autonomy) reads without a card and nothing is kept;
`off` keeps the refusal. Writes outside stay refused, a chat with no project keeps the refusal (there is nothing to add
a folder to), and no refusal sends the agent to `ask_owner` for a folder any more. A "once" given after the turn
stopped waiting lets the same call run when the agent makes it again.

<a id="d-100"></a>
## D-100 — 2026-10-17 — After an update, the super-agent tells what changed in a chat of its own, with no model call
People should learn what an update brought without spending tokens. The first time the core starts on a newer release,
the super-agent opens a new chat, unread, titled with the version, holding each new release's changes as its own
message; it is written from a template (`domain/whats-new.ts`), like the setup's greeting, so it runs no turn. A "See
what's new" pill in the top bar opens that chat until it is read; the chat came first because it is the one place that
also answers questions, works on every operator (the phone lists it like any unread chat) and keeps the notes readable
later, offline, in the database; a separate changelog view would have been a second copy of the same text.

The text is the commits between version tags, each subject as a sentence: the one source the Discord announcement
and the issue replies already read (their `previousTag` and `sentence` now live in `apps/core/src/release-notes.ts`).
GitHub's generated release body was not used: it lists pull requests, which v2 does not use, and needs the network. A
packaged APX has no git, so `stage.ts` writes `release-notes.json` beside `build.json` (the last 20 releases and the
branch the build came from; the release workflow fetches every tag for it); a checkout reads its own tags, so the
owner's core under launchd is told once a new `v2.x.y` tag is reachable, not on every merge.

The release last told is a setting (`release_seen`). A new install (no message from the owner yet) records its release
untold; an install in use from before this existed is told the release it starts on. A downgrade tells nothing and
keeps the newest release told, so going back up is not told twice; an install that skipped releases gets one chat with
each under its version. Asking in that chat is an ordinary turn: its input (never the byte-stable system prompt) names
the version, its branch and the commit range to read (`git log` in a checkout, the compare page otherwise), about 300
characters. No tool was added: the agent's shell and web reading already reach the commits. `APX_WHATS_NEW=off` turns
the chat off; test cores start with it off. Amended by [D-117](#d-117): the chat is always in English, and news worth
acting on reach the owner apart, in the super-agent's words.

<a id="d-101"></a>
## D-101 — 2026-10-17 — The owner writing in a task's conversation reaches its agent's work chat, not a turn there
D-048 moved a task's work into its agent's own chat, but the task's conversation still took `threads.send` like any
chat: the owner writing there started a turn of the assigned agent in it. A developer agent working a task in its chat
(delegation results arriving) got a second turn in the task's conversation, and both edited the same git worktree
until one noticed and stopped. Now, when the task has an agent, the owner's words there are the owner's comment on the
task and go to that agent's chat for the task (opened if it has none yet): into the turn working there at its next
step, or as its next turn there when that turn cannot take them (an outside harness, attachments). The owner cannot see
that chat's state from the task, so the words join a running turn even when the client asked to queue; `interrupt`
still stops it first. An @mention of anyone else is a consult, as D-073 says; the task's own agent is not asked twice.
A task nobody has keeps the old behaviour: the agent of its conversation answers there, since no work chat exists.

<a id="d-102"></a>
## D-102 — 2026-10-17 — An agent that acts outside on its own works in any folder but APX's home
The super-agent on total autonomy, in Home (a chat with no project), was asked to make a video in another project's
folder and refused itself three times: D-099 kept every read outside a chat with no project refused, and every write
outside the agent's folders refused, whatever its autonomy. That contradicted rule 10, where total autonomy is the
owner's choice to be asked nothing, and left the agent that is meant to do anything unable to touch the owner's other
projects. Now, when an agent's rule for acting outside is `auto` (total autonomy, or that rule set on its own), each
call runs with every folder open (`thread.anywhere`: a last root after the others): it reads and writes anywhere, in a
project or not, with no card and nothing kept. APX's home stays refused, other chats' temp folders stay closed and a
project's read-only folders stay read-only, since those roots come first. Outside harnesses (Claude Code, Codex) keep
their own sandboxes; this is the folder rule of APX's tools.

<a id="d-104"></a>
## D-104 — 2026-10-17 — A delegation works in a folder of its project, never with more writes than its caller
An orchestrator delegating review or fixes into one git worktree under its project could only name the project: the
session worked in the project's root, so it fell back to `apx chat --code --cwd`, whose threads have no parent and
never report back, and polled for results. Now a path inside the project given to `delegate` as `project` is the
session's folder (`cwd` on the a2a sub-thread, checked like a code thread's folder: inside the project once links are
resolved), and `write` says how far it may change it. The policy is the strictest of the caller's code thread, the
caller's autonomy (`ask` stays `ask`) and the one asked for, `ask` when none is: a delegation never gets further than
its caller, and the result tells it when what it asked for was capped. A separate folder argument was left out: a
path already names both the project and the folder, and the tool definitions are at their budget (PROMPT_SIZE.md).
Continuing a session with another folder or policy is refused, as with another project. The sub-thread keeps
`parent_id` and its run `parent_run_id`, so the result returns to the caller as any delegation's does.

<a id="d-105"></a>
## D-105 — 2026-10-17 — A delegated run stops only when it stalls, and one a limit cuts short goes on once
A delegate rendering a video was stopped at the fixed ten minutes every delegated run had, while it was still working:
its caller read "could not finish" and the work died. Now a delegated run has the owner's turns' idle clock (it ends
after its window without progress: a model token, a tool result, an outside engine's event) and a cap of two hours in
all. A foreground command still running, and a caller's wait on a delegate at work, hold the idle clock: they are the
turn at work, bounded by their own timeouts. When a limit (steps or time) cuts a delegated run short and its caller is
not waiting for it inside its turn, APX starts one continuation in the same session, which keeps its context, reporting to the same caller;
the owner gets a notice in the caller's chat (with the session to open or stop), the tray and the channel that chat
lives on. The cap is per run: a continuation gets its own. A continuation cut short again, a caller still waiting inside its turn, or agents paused by the breaker go
back to the caller instead, with the progress-report note `step_limit` had and the session to delegate "the rest" to.
APX continues on its own once and not more: a run cut short while making progress usually needs only a little more,
while a second cut says the task is larger than one run or is stuck, which is the caller's (and the owner's) call; the
breaker still counts the continuation. `stop_session` lets a caller stop a session it started; it is offered only
while one of its thread's sessions works, so the default turn's tool definitions stay within PROMPT_SIZE.md.

The limit notice follows the session's live state. Opening it only navigates; Continue is offered only after it
stops, while working or queued sessions offer Stop. An owner-only `threads.send` with `continue_run` checks the
latest stopped run atomically, preserving its caller, folder and write policy. That click authorizes only one more
turn, including when it must wait for a delegation slot after the breaker is spent; unrelated queued work stays
held. The continuation remains subject to its run limits and is never continued automatically again.

<a id="d-106"></a>
## D-106 — 2026-10-17 — Five permission modes, Auto by default: agents ask only for strong actions
Agents stopped far too often. An agent on total autonomy in Home was refused a read of another project's file; a
marketing agent delegated work by the secretary (total) stopped on a card for a plain inspection command, because a
delegated run took the strictest autonomy of its chain and its own project's default was `standard`; and continuing a
session in another folder was refused with "name a new session". Modelled on Claude Code's modes and on Codex's
workspace-write sandbox, the four autonomies become five modes, in the order the owner picks from: **Manual**
(`manual`, every change asks, and so does a read outside the project, D-099's card), **Auto** (`auto`, the new
default), **Accept edits** (`accept_edits`, as Auto for files; a command that changes something asks), **Plan**
(`plan`, reads and proposes; any call that would change something is refused with "propose it in your answer", while
`ask_owner`, `load_skill`, `recall` and `delegate` still run) and **Total** (`total`, unchanged: D-047, D-102). The
field stays `autonomy`, in files and in the protocol.

Auto, like Codex: an agent reads any path on the machine but APX's home (a last root, `reach: "read"`, after every
other one, so other chats' temp folders stay closed and read-only folders stay read-only); writes files and runs
commands in the folder it works in and its temp folder without asking, whatever the turn read; and asks only for strong
actions: what acts in the owner's name (messages, posts, payments, a URL with values once outside content is in the
turn, D-047's list), what always asks (destructive commands, APX's own API, APC files, D-089), and writing outside its
work folder. That last one is a folder card for the call ("wants to change files in …, outside its project": Only this
time or No; never kept, since read-only folders cannot be written), raised by `file_write`, `file_edit` and `shell`
through the same `lend` step D-099 reads use. Outside content in the turn no longer gates a call that works in the
agent's folder (`workspace`): only `untrusted`-level calls that act outside or keep something of the owner's (memory,
location) still ask then. A code thread or a session in a sub-folder (a worktree) keeps to it: writing elsewhere in the
project asks for that call, which D-104 needs. Codex's sandbox writes in Auto and Accept edits, read-only in Manual and
Plan. Known limit: the shell rule is a static reading of the command (D-097), not a sandbox, and a word only the shell
can place (`$X`) is no longer refused just because every folder is readable; `curl -X POST` in the work folder runs
in Auto as it did under `edits`.

Delegation: a helper works in its caller's mode, not the strictest of the chain: the top of the chain sets the mode,
each agent below keeps its own rules by case over it, and a rule that turns a risk off anywhere up the chain stays off
(the old `strictestRules` is gone). Tools are still the ones every agent in the chain may use, so a caller's tool list
still narrows its helpers. The trade: a helper whose own mode is Manual, asked by an agent on Total, acts as Total;
an agent meant never to change anything says so with `rules: write=off` (or its caller's mode is Plan). Delegating to a
session that works in another project, folder or write policy now opens a new session with the same agent there
(`<name>-2`), and the result says it has none of the old session's context. Every refusal names a next step.

Stored values move once in a migration (rule 14; there is no `doctor` yet, as D-024 says): `ask` → `manual`,
`standard` and `edits` → `auto` (Auto covers what `edits` did), for projects, the base project and APX's own agents.
An agent file in someone's repository is not APX's to rewrite, so the APC sync reads the old names the same way;
reading `ask` as the default would have let that agent act unasked.

A project's linked git worktrees count as the project wherever they sit (`git worktree add ../northwind-issue-7`):
the same repository, so writing there in Auto needs no card. They are found from the project's `.git/worktrees`,
not by a parent folder. A thread kept to one folder (a code thread, a session in a worktree) still keeps to it.

<a id="d-107"></a>
## D-107 — 2026-10-17 — An agent hands its files to MCP tools by reference; APX never publishes them for a link
An agent drew carousel slides (kept only as `med_` ids in the media store, which agents may not read) and could not
attach them to a draft on a remote MCP server: its upload tool took a public `url`, `base64`, or a `path` the server
reads on its own disk. Now an MCP argument may name a file of the agent's: a bare `med_` id of its chat, or
`apx-file:<path or med_ id>` for a path in its folders. The MCP adapter (`mcp/file-args.ts`, called from the tool's
`run`) replaces it with what the field takes, judged from the field's name, then its JSON schema (`contentEncoding`,
`format: uri`), then its description: base64 (a data URL when the field asks for one) for a server elsewhere, within
the smallest size its description names and its `maxLength`, never over 20 MB; a real path for a server on this
computer, a kept file copied into the chat's temp folder first so the server never reads APX's home. A field that only
takes a public link, or a path on a remote server, is refused with the base64 field to use. One file in an object
fills its empty `mime_type`/`file_name` fields. The step keeps the reference, not the bytes; the tool's `check` stops
a reference to nothing before the owner is asked; a call carrying a file waits for the owner while untrusted content
is in the turn, even for a tool that claims to only read (rule 10). The conversion happens in the core where the call
already runs, so there is no new method or route (rule 1), and `mcp_call`'s description grew by one sentence, outside
the default turn's budget (rule 23). An agent copies a kept file into a file of its own with `file_write`'s `media`
argument instead of a new tool: the default tool definitions are at their budget.
A short-lived public URL for large files (video) was left out. The core's exposure is the tailnet (`tailscale serve`),
not the internet; a public link needs Tailscale Funnel, which would put the core's port on the internet, and serving
one file from it would be a second HTTP route outside the protocol. A third-party host would publish the owner's
files. So a field that wants a URL is the service's to solve: an upload link it hands out through one of its tools,
which the agent fills with `curl -T` from its temp folder.

<a id="d-108"></a>
## D-108 — 2026-10-19 — Auto changes the owner's other projects freely, and a folder card can let an agent write there for good
After D-106 the cards that still stopped the owner were mostly folders: a developer moving from the APX repository to
the folder that holds it (itself a registered project), or to a sibling worktree, got "wants to change files in …,
outside its project" for each command, and a folder card could only say yes for that call. Now, in Auto and Accept
edits, every registered project on disk and its linked git worktrees is writable like the agent's own folder: the owner
registered them, so moving between them is not acting outside. They come after the project's read-only folders and
other chats' temp folders, which keep their rule inside them, and never one holding APX's home or inside it. A thread
kept to one folder (a code thread, a session in a worktree) still keeps to it. A folder that is not a project still
asks, and its card now offers "Always let this agent change it": a grant for good for that agent (key
`apx:write_folder:<dir>`, shown in its permissions with the folder as the condition, revoked there), never for other
agents. A worktree kept under `.apc/worktree(s)/` is a checkout of the code, not APC definitions: editing it no
longer asks as a high-impact action; `.apc`'s own files and any AGENTS.md still do. Known limit: Claude Code and
Codex sessions keep their own folder rule (their side folder or code thread), unchanged here.

<a id="d-109"></a>
## D-109 — 2026-10-19 — Fewer "outside content" cards: a look at the screen, a local URL, a build's output, and chat grants that last
After D-106 and D-108, what still stopped an agent in Auto came from rule 10's "outside content in the turn". A look
at the screen (`screen_snapshot`) asked in every mode but total (D-056): it changes nothing and sends nothing out, so
it is now `never` with effect `external` — Auto and Accept edits take it, Manual still asks, Plan still refuses. A URL
with a query to this computer itself (`localhost`, `127.x`, `*.localhost`, `[::1]`, a dev server) no longer counts as
carrying values out (D-057). A shell command's output no longer marks the run as holding outside content unless the
command may bring text in from elsewhere (a URL, a network program, an install, `npx`, a git fetch): a build or a test
run's output is the project's own, as `file_read`'s is; the reading is static, as D-097's. Grants "for this chat" are
kept in settings, so a core restart no longer drops them; archiving or deleting the chat ends them. Kept on purpose:
MCP tools that act (a phone's tap can send a message in the owner's name) still ask until the owner answers "always for
this agent", and `screen_open` still asks, since it opens pages with the owner's own logins.

<a id="d-110"></a>
## D-110 — 2026-10-19 — A project's AGENTS.md reaches its agents whole; how long it is, is the project's choice
APX cut a project's AGENTS.md past 12,000 characters (and `.apc/memory.md` past 6,000) to its head and tail, with only
"[… N chars omitted …]" in place of the middle: a rule there was lost and neither the agents nor the owner knew. The
owner's call: APX does not decide how long a project's instructions are. Both files now reach the agents whole; a
project that wants them short says so in its own rules and review (this repository's AGENTS.md does), not in code that
cuts. They are not part of the default-turn budget (PROMPT_SIZE.md), which measures what APX itself sends.
Both files share a safety limit of 200,000 UTF-16 code units (`AGENTS_MD_LIMIT`); this is not a guarantee that
any content fits every model's token budget. Past it, the head and tail are sent, preferring line ends, with a marker
naming the file's path, omitted lines and a `file_read` offset and limit. Line-based recovery is subject to the file
tool's per-line output limit. The persisted counter and owner-facing notice cover **AGENTS.md only**: its full length
is kept as `projects.context_chars` and sent as `Project.agents_md_chars` only past the limit, shown in project
settings and by `apx projects list`. `.apc/memory.md` shares the cap and agent-facing marker, but has no CLI/UI notice.


<a id="d-111"></a>
## D-111 — 2026-10-19 — Memory continuity: automatic own-chat recall, grounded capture and reversible AutoDream
Ordinary owner turns should carry useful context into another chat without depending on a model choosing `remember`.
Automatic recall uses existing chat access policy plus stricter participation, same-project and owner-origin checks;
contacts, rooms, clients, subthreads, workers and direct engine sessions stay excluded. Literal historical owner
statements use the team-data envelope (D-071), with an explicit warning that they grant no new authorization. Capture
selects exact owner quotes, never assistant claims. Automatic notes stay private to the agent and project; explicit
remember retains its scopes and global confirmation rules. No runtime state goes in `.apc/`.

Core-owned SQLite jobs survive restarts, reserve calls in a dated ledger before calling the configured helper, and
have leases, bounded attempts, input/output limits and deadlines. Disabling memory, forgetting a source, removing an
agent or changing chat access while a call runs prevents its result from being applied. The helper can propose
AutoDream duplicate groups, but a deterministic equality check and revision checks authorize the merge; conflicting
facts and changed numbers stay separate. Owner notes are never merged. Sources and taint survive; version history
supports undo. This deliberately favors conservative deduplication over rewriting or semantic paraphrase merging.

A forgotten note records scoped exclusions, including source IDs. Recall, chat tools and retries honor them. Hard
deletion removes revision text and cached note responses but retains a fingerprint and source IDs. Original chats
are separate records. Model-log snapshots carry dependencies: changed or forgotten notes invalidate their old turns
and derived replies in the model projection. Summaries are invalidated on memory changes, and an in-flight summary
cannot commit across a memory-generation change. The system prompt remains stable; dynamic context stays in input.

Legacy model-log entries lack dependency offsets. Only an exact canonical input suffix proves where their injected
context ends: stale legacy context is removed as a whole, and an unverifiable legacy run is omitted from the model
projection. Arbitrary note text can contain blank lines or APX-like headers, so those are never treated as boundaries.
The original chat remains readable; current turns rebuild task and skill context.

Historical recall also covers completed turns of the current chat outside the projected context. Visible runs and
source fragments are excluded before search limits; semantic relevance is not replaced by recency. The current
question drives historical retrieval independently of unrelated recent topics. Only original owner messages are
injected; explicit chat reads can expand their responses. Short non-informative and queued/running turns are never sources.

Long owner messages are embedded as bounded overlapping literal fragments; ranking aggregates the best fragment per
source before applying the existing relevance threshold and result limit. Only the winning original excerpt reaches
the turn; fragment vectors survive restart and cascade with their episode.

Episode indexing has a per-run transactional checkpoint and advances independently of helper extraction and daily
model-call quotas, including discarded batches and late completions. Recent capture jobs take priority; exhausted
quotas defer model calls until the next UTC day without blocking historical retrieval.

<a id="d-112"></a>
## D-112 — 2026-10-20 — Memory notes in the agent's words, procedures that worked, an always-loaded index, fuller AutoDream
Verbatim owner quotes made poor notes: requests and status lines were saved as facts, and nothing remembered how the
agent itself got something done, so "do it like you did today" found nothing. Notes now follow the shape a working
agent writes for itself, and D-111's "capture selects exact owner quotes" becomes "capture keeps an exact owner quote
as evidence".

- **Synthesized capture.** The helper returns a fact in the agent's words beside the exact quote. The quote is still
  verified against the source message, and a deterministic check (`factSupported`) refuses a fact whose numbers, names
  or identifiers are not in the quote, whose rule lost or gained a negation (apostrophe forms included), or any of
  whose lines (rule, Why, How to apply) shares fewer than half its distinctive words with it. A candidate without a fact is dropped rather than stored verbatim. `memory.add` applies the same check.
- **Procedures.** Built from the run's own successful steps, with no model call: tool names and the argument that
  names a target (URL without its query, command, path), plus output paths named in the arguments. Tool results are
  never read into the note (rule 10). Credential-shaped values are dropped, checked
  before any cut (rule 11). The note is always tainted: a step's arguments may have been steered by what an earlier
  step read, and the tool name cannot tell. Triggered when an owner run
  recovers from a failed step, follows a failed turn in the same chat, or is confirmed by a short owner reply. Every
  quoted fragment must appear in that run's steps (`procedureSupported`), checked again in `memory.add`.
- **Index.** Per-turn input, never the system prompt (rule 12): one hook per own note not shown whole, newest first,
  capped at 2,000 characters including the untrusted envelope. It rides in the memory block, so the existing snapshot
  invalidation covers it; a thread shows it once and then only notes saved or changed since (by id and revision). Notes past the cap are
  reached by search. Usage-based ordering is not tracked.
- **AutoDream.** The helper names ids only. Supersession retires an older note in favor of a newer one; stale notes
  go only once the notebook passes 40; relative days are rewritten by code, in the owner's time zone, outside quoted spans and never in procedure notes.
  Past 48 notes a dream reads the newest and the oldest; a tainted note never retires another. A pass that
  would forget more than a fifth of the notebook (at least one) is refused whole, and `memory.tidy` holds that share
  per agent and day, so repeated calls cannot add up. Retirement is soft (`forgotten_at`,
  a `superseded:<id>` or `stale` revision) without the owner's exclusion, so the note can be brought back.

<a id="d-113"></a>
## D-113 — 2026-10-20 — The owner's channel turns count for automatic memory
D-111 limited capture, episodes, own-chat recall and (D-112) procedure notes to app-originated turns, so what the
owner said on Telegram or WhatsApp, where most use happens, was never remembered. `ownerOrigin` (domain/runs.ts) is
now the one test: a `user` origin, or a `channel` origin with role `owner`. Admission stamps the owner's message id on
both, and `memorySources` reads the same rule in SQL. The owner's own channel chat (`owner_thread: "own"`) is eligible
like Home; contacts, rooms, external clients, subthreads, workers and engine sessions stay excluded. A closing word the
channel keeps without a turn ("buenísimo") reaches memory through `ownerReplied`, so a confirmation there can still
leave a procedure note.


<a id="d-114"></a>
## D-114 — 2026-10-20 — Evidence-backed learning and reviewed retirement
D-112's lexical checks protect numbers and vocabulary, but cannot establish who prefers which format or whether a
reason was actually stated. Capture now reads at most three eligible owner turns, anchored before the source run,
and keeps up to four literal evidence quotes. Deterministic checks remain; a separate helper call validates each
candidate's relationships, scope, exceptions and reasons. Only an unambiguous supported verdict receives an internal
certificate bound to the exact text and evidence. `memory.add` requires it for automatic synthesis. Explicit
`remember` remains the agent's immediate write path and carries no claim of automatic semantic validation.

Windows with no durable lexical cue skip extraction without skipping historical indexing. Imperative use requests
remain transient unless an explicit standing-policy cue changes their scope. Accent folding must not turn the Spanish
imperative into a standing usage assertion, including inside a quoted fallback for the current deliverable. Both
auxiliary prompts distinguish such fallbacks from durable preferences. Extraction and review each reserve one logical
gateway call from the existing daily memory allowance. Checkpoints
retain extraction and verdicts across retries and quota deferral, so a second-stage limit does not repeat extraction.
Capture checks owner-message identifiers before checkpointing. Unknown source references are retried within the same
attempt and call budgets; invalid legacy references discard their checkpoint instead of completing silently without a note.
The gateway may retry a transient transport failure; the allowance counts gateway requests, not HTTP attempts. Settings,
source eligibility, exclusions and project boundaries are rechecked before later calls and before persistence.

Procedure history now requires the owner's actual positive confirmation or the narrow observable criterion that a
complete file read exactly matches an earlier successful write to the same path. A tool's `ok` state alone never
establishes success. Evidence stores the confirmation message or the verified write/read call IDs in an optional
`verification` object, using existing JSON and revision storage. `memory.add` recomputes the proof and checks an
internal text certificate. Missing legacy metadata remains historical, never upgraded to verified success.
Safe method targets include export routes; failed attempts have a distinct section validated against error steps.
Each step is kept as a reduced gist (`domain/procedure-steps.ts`: host for links, program and decisive flags for
commands, scratch/work-relative paths), lookups are dropped, and failed attempts (error steps, or commands that exited
non-zero) before the method are named by program with a short reason. `memory.add` recomputes those reductions and
accepts only quoted fragments contained in one of the run's own steps.
Procedure notes remain tainted historical data, grant no permissions and require current-state checks before reuse.
Other outcomes, such as an API mutation or a browser action, need owner confirmation until a concrete observable
criterion exists; this change does not treat generic tool outputs as proof.

AutoDream retirement receives a second semantic review for the same assertion and scope, with explicit replacement
or supported expiry. Verdicts judge the proposed retirement: an explicit newer correction contradicting the old
content can support retirement; disagreement between the notes is not itself an unsupported-retirement verdict.
Internal certificates bind both note revisions and texts. The canonical handler retains private
scope, taint, snapshot revisions, notebook and daily forget-share guards. Concurrent edits do not become processed
merely because they appeared after the model read its snapshot. Exact duplicate consolidation remains deterministic.
Dream proposals read bounded literal source excerpts as historical data, so a correction omitted from a short
summary remains available. Unknown note identifiers reject the proposal before checkpointing; invalid legacy
checkpoints are discarded within the existing retry and call budgets. A policy-versioned fingerprint makes
existing notebooks eligible for that review. Relative dates use the owner's local source day only when the
sources agree on that day; mixed-day or missing sources stay unchanged rather than guessing an anchor.
Sharing a previously cited source does not deduplicate a new assertion: exact fact text does, with semantic
review and canonical source checks still required.

Editing the text clears its former evidence. A later supported capture can certify that same private note in place,
using its expected revision and the current source thread and run. Repairable notes are omitted from extraction's
duplicate hints; pending global notes cannot block private capture. The canonical handler validates the target's
agent and project, not just the requested scope. Direct agent text edits in eligible owner chats also update provenance,
so a former origin in another chat cannot bypass a prior fork's cutoff. Workers retain the original boundary.
Forget exclusions hide private copies by text, source quote
or source run, including after permanent deletion of the original note.

The five shared prompt rules now cover evidence already present, permitted recovery, role-appropriate delegation,
known methods in handoffs and scoped memory with supported reasons. Dynamic memory stays in turn input; no new tool,
permission or prompt-budget exception is introduced. Engine sessions remain outside APX's automatic memory boundary
(D-113); a CLI session is not an API-backed APX agent.

Behavioral evaluation uses isolated homes, fresh conversations, real model decisions and temporary artifact tools.
The live runner is opt-in, has explicit call/output caps and stores local reports outside version control. Scripted
regressions establish infrastructure behavior; they are not evidence of real learning. Artifact scoring rejects
negated format matches, string success flags, missing outputs, exports without subsequent observation and automatic
notes sourced from evaluation requests rather than prior teaching. Reports
retain failures and model/configuration provenance; passing a finite evaluation never guarantees universal fidelity.
Known-method handoffs check the recipient's first asset attempt, not a preliminary check by the parent; reusing a
known failed download path also fails the evaluation. The delegated instructions remain available in episode traces.

<a id="d-115"></a>
## D-115 — 2026-10-21 — One permissions service: every path asks it, and a thread without reach cannot be judged
An agent on Total was refused `send_file` of a video in another project from Home ("outside the folders you can read
… in Auto mode an agent reads any folder"), while the same agent could read that file with `file_read`. The executor
worked out how far the agent reached (`reachOf`) and put it on a copy of the thread for the call; `send_file` calls
`media.attach`, which loaded the thread again from the store, without it, and judged the path with less than the
agent may do. The same split hit `file_read` of an image or audio file and `open_document` (both go through
`media.attach`), outside agents (Claude Code, ACP: their commands were judged on folders built from the bare thread,
so Total could not `cat` outside its folder), Codex (its write sandbox read the agent's own mode, not its project's or
its caller's) and delegations (the caller's own mode, not the one it acts in).

`engine/permissions.ts` is now the one place that answers: the mode an agent acts in (`agentIn`: its own, else its
project's, a helper in its callers', D-106), how far its files reach (`scope`), and what a running call was let use
(`hold` while the tool runs, `forCaller` for a method it calls; the router's `ctx.agent` carries the call id). The
executor, turns, harness callbacks and `media.attach` ask it; harnesses and delegations get the agent as it acts. The
folder rule's thread type (`FolderThread`) now requires `reach`, which only that service sets: a thread read from the
store no longer type-checks there, so the next path that forgets fails `pnpm typecheck` instead of the owner's request.

The owner's other requests in the same report, all through that rule:
- Asking instead of refusing: Manual in a chat with no project gets the folder card (only this time) for a read
  outside, and a write outside raises the write card in every mode that asks, instead of "outside the folders you can
  change". `send_file`, `open_document`, `make_image`'s references and `message_contact`'s files offer the card too.
- Temp files are the agent's own: a `file_write` in the chat's temp folder, or a command run there that writes only
  there and reaches nothing outside (`scratch` on the tool), runs unasked in every mode, plan and manual included, and
  even in a read-only code thread; what always asks still does.
- `message_contact` to the owner (`to: "me"`) carries any file the agent may read; to anyone else, and `channel_post`,
  still only its work folder's. `.git` is refused there as everywhere.
- Outside agents follow the mode like our tools: an edit where they may write is a local change (Accept edits takes it,
  `rules.write` governs it), and a code thread's `auto` write policy no longer lets an agent on Manual or Plan edit
  unasked. A read-only code thread now refuses `file_write`/`file_edit` too, which its confirm level let through.
- Codex writes in any code thread but a read-only one on Total; elsewhere only in an `auto` one, as before.
- `delegate` with a project's id or name no longer reads it as a folder relative to the core's own folder.

Left as they are, and why: the board's project scope for tasks and memory scopes are about which project's data an
agent sees, not its mode; the 60-action computer-use check is a runaway guard; the Rules editor writing all four
rules when an agent leaves its project's mode freezes them over a later mode change (none on this machine today),
which is a product question for that page; the owner's own Claude Code settings still apply to Claude Code's tools.

<a id="d-116"></a>
## D-116 — 2026-10-21 — 150 steps a turn, and a cut delegate goes on while it makes progress
A turn on our own loop stopped at 60 model calls. In thirty days 19 turns hit it, all of developer agents in the last
five (the longest real one used 141 calls), and a delegated one cut short went on once on its own; cut again, its
caller was told to ask the owner, who had to write "continue" on WhatsApp or Telegram for work that was not stuck.
Now a turn has 150 steps (the screen and the browser no longer need a higher one of their own), and a delegated run a
limit cuts short goes on in the same session as a supervisor would decide: the first part always once, then each part
while it made progress (`engine/progress.ts`: some calls worked, something with an effect got done, it did not go
round the same calls or redo the last part's changes), up to eight parts in a row; the breaker's budgets still bound
it all (D-080). A part that only looked things up, failed or repeated itself stops, and that is the only time the owner
hears of it: the notice in the caller's chat carries Continue (web, desktop and now Android), the tray and the owner's
channel get it, and the caller is told why and to tell the owner, not to go on by itself. Going on is APX's own
business: that notice stays in the chat, quiet, and never reaches the tray or a channel. An owner's Continue starts the
count over. Kept: 150 and not 500, since one 60-step turn already sends about 3.5 M input tokens (most cached) with a
context near 100 k, and a loop that slipped past the checks would spend all of it before stopping.

<a id="d-117"></a>
## D-117 — 2026-10-21 — Release news worth acting on: the super-agent tells them once, in its words, only when they apply
D-100's chat stays as it is (written from the notes, no model call, the "See what's new" pill), but always in English:
its body is commit sentences, which only a model could translate, and a frame in the owner's language around English
lines read as broken. What it could not do is tell the owner what an update lets their agent do *for them* ("I can now
upgrade your widgets"), in its own voice and language, where the owner reads it.

That is now separate: entries in `apps/core/src/news/` (an id, the release that has it, a test on this install's facts
such as "has widgets", what changed for the agent to tell, and actions: a label in English and Spanish and the prompt a
press sends). The ones told are a setting (`news_seen`). A new install (nothing from the owner yet) knows every entry
as a capability and is told none: the skill and the docs present them, and a new owner is not flooded. An install
already on an entry's release when news began knows it too. On a start, the unseen entries that apply are told in one
message: one model call on the super-agent's own API models (then the auxiliary one), no tools, 400 output tokens, a
60-second deadline, its name and personality as the system prompt and a few hundred characters of input naming the
entries and the owner's language. No entry applies, no call. The message goes to Home (unread, in the model log as its
own words, so answering there is an ordinary turn) and through `notifyOwner` to the owner's preferred channel or
phone, with buttons: one entry offers its own actions, several offer the first of each, at most three, and the model
says how many more there are. A press is the owner's words in their chat on that channel; a channel without buttons
numbers them, as for every notice. An entry is marked told once the message is posted; a failed model call marks
nothing, and the next start tries again. With no API model (an agent on a CLI only) the entries go out as written, in
English. This was a direct call, not an engine turn: a turn would bring the agent's tools and, on a CLI harness, a
whole session, which this short message must not have.

`APX_NEWS=off` stops it; test cores start with it off. `system.news` lists the entries (told, applies) and
`system.news_tell` (the owner only) tells now: the given ones again, or the untold ones that apply; `apx news` and
`apx news tell [id]` reach them from the terminal. Nothing was added to the system prompt or the tool definitions.

<a id="d-118"></a>
## D-118 — 2026-10-21 — Artifacts: one primitive, two kinds, three memory layers, three lifecycle tiers
Widgets and apps were one thing already (a surface: an HTML page, kept by name per project), but the owner and the
agent saw two words and the agent leaned towards building apps. Owner-facing, both are now **artifacts**, of kind
**widget** (the default) or **app**; internally it stays a surface (`surfaces.*`, `show_widget`), so no table, method
or tool was renamed and no compatibility shim exists. The skill is `apx-artifacts`: a short SKILL.md for the common
case (one hand-written HTML with APX Kit, how to update one without losing what it remembers) and references loaded
only when needed (kit, app, build, update). The tool says "default to a simple widget; an app only when asked or it
must keep records" and names the kit's main classes, so a quick widget needs no skill load at all; the system prompt
line got shorter, and the tool definitions did not grow.

**Three memory layers, per artifact, none shared.** `state` (what the owner chose, ≤64,000 chars, the agent reads it),
`store` (cached data such as the last reading, ≤5 MB, the agent sees only key names and size) and `db` (SQLite records
for apps, ≤50 MB, the agent sees tables and row counts). They differ in who reads them and how big they get: the
agent's context must not carry a cache, and records do not fit in a JSON column. Each artifact's store and database
live in `<home>/artifacts/<project|global>/<name>/`, not in `apx.db`, so one app cannot grow the core's database or
lock it. A credential never lives in the page: secrets named `artifact.<name>.<key>` are injected by the core in
`surfaces.fetch`, only towards the artifact's `connect` origins.

**Three lifecycle tiers.** Static (mounted while shown), cached (still destroyed when hidden, but `APX.live` paints the
stored reading at once) and live (a page that declares `apx-live` stays mounted, at most three, LRU). Most artifacts
need no running process: cached gives the "it was already there" feeling without keeping iframes alive.

**Built artifacts are one HTML.** A large app is built with Preact + Vite + `vite-plugin-singlefile` and shown with
`apx artifacts push` (a `surfaces.show` call; `project` was added as an optional param for a call without a thread).
The host, the sandbox, the kit inlining and publishing stay the same for every artifact. Its source lives under
`artifact-sources/<scope>/<name>`, never in the owner's project, whose repo is the owner's, and apart from its memory: the
agents of that project may write and build there (a folder root, and the shell's APX-home rule leaves it out), while
`artifacts/` (the database, the store, the secret pins) stays the core's alone, so an agent cannot rewrite a pin.

**Bundle format for a future marketplace.** `apx-artifact@1`: a manifest (name, title, kind, version, kit, connect,
secret keys without values, live, `data_version` for future db migrations, source), the html and, only when the owner
asks, the memory. An upload will never carry the owner's memory: installing starts empty and asks for its own secrets.
Nothing is uploaded yet; the format is fixed now so exports made today stay importable. The file is `<name>.apxart`
for a widget and an app alike (the kind is in the manifest): `.apxapp` and `.apxext` stay for the marketplace's packaged
apps and extensions, which install through the extension installer; an `.apxart` is content an agent made, carried
between installs. Installing shows what the file is before anything is written (kind, origins, secrets, data) and lets
the owner choose the project, pin it and drop its data.

<a id="d-119"></a>
## D-119 — 2026-10-21 — An app keeps running until the owner closes it; a widget closes when left
The owner wanted apps to behave as apps: open three, go to the inbox, come back, and find each as it was left (a menu
open, a form half filled), not reloaded from its memory. A page's own running state cannot be saved and restored by
APX, so the page is simply not destroyed: an app opened full screen joins the live layer (D-118's pool, which never
moves an iframe in the DOM, since a moved iframe reloads) and stays there until the owner closes it (Close app, the
Apps menu) or quits APX.

Only apps. Kind decides it, not size: an **app** is a tool the owner works in (in the dock, running until closed, the
page owns the whole window); a **widget** is a view of something, mostly read in a chat or on a project's board, and
opening one full screen is only a bigger look at it, closed when the owner leaves. A widget that must keep running
(a live price) says so itself with `apx-live`. How an app is laid out is the page's own design: one that wants a
centered column uses `ax-page` inside; no third flag was added for "an app the size of a widget". Pinning a widget to
Apps makes it an app from then on; unpinning one stops it running.

The cost is bounded and visible. At most six apps run at once (the seventh closes the one seen least recently) and three
`apx-live` pages, each kind in its own room so one never closes the other. A hidden app is told so: the kit pauses
`APX.live`, and the skill asks pages to pause their own timers with `APX.onVisible`. The sidebar's Apps section works
like a dock: every app, a dot on each running one; "+" searches every artifact in the system and opens it. Advanced
names each running artifact's process when Chromium gives it one of its own.

One copy runs at a time. Opening an app in a window of its own (a desktop window, a web popup at `/?artifact=<id>`)
stops the copy in the panel, which shows a note with "Bring it back here"; closing that window brings it back. The
window starts from the artifact's memory: moving the running page itself across windows would need each app to be a
native view of its own, a larger change kept for when it is needed.

<a id="d-120"></a>
## D-120 — 2026-10-21 — An agent the owner consults on a task can create and start the tasks they ask for
D-079 counted a consult as "an agent answering another one", so `tasks.create` and `tasks.update` refused an assignee
there. But a consult is the owner asking: only an owner's @mention on a task opens one, at depth 0. A real run showed
the owner @mentioning an agent on an unassigned task to turn three ideas into tasks and start them; every
`task_create` was refused with "the agent that asked you assigns it", though no agent had asked, and the one without an
assignee was refused as a subtask with no responsible agent. Nothing could be done.

Now a consult (an `a2a` thread whose context has `consult`) is not "answering": its agent may create tasks with an
assignee, assign them and send them back for rework, and their work starts one hop down, as from any chat of the
owner's. Delegation is unchanged: a consult still asks nobody with `delegate` (D-074), and a delegation's sub-thread
still gives nobody task work, so the chain D-079 closed stays closed. What a consult starts spends against the consult's
chat, under the same limits on turns without the owner as any work an agent gives ([D-080](#d-080)).

<a id="d-121"></a>
## D-121 — 2026-10-21 — One tool opens a URL in the browser, and a URL that carries data says why it waits
Two tools loaded a URL: `browser_open` (a new tab) and `browser_navigate` (a tab the agent had). Agents reached for
`browser_open` each time, so a chat collected a live card per call, and the owner, seeing one ask and the other not,
read it as a difference between the tools. It was not: both ask only for a URL with a query after outside content
(D-057). The one that asked carried `?release=…`, and the card said only that outside content was in the turn.

Now `browser_open` is the one tool. It loads the URL in the newest tab this chat's cards show that the agent may still
drive (idle, or its own; never the owner's or another agent's), in `tab` when given, or in a new tab with `new_tab` or
when the chat has none. A tool can name why its `untrusted` call waits (`untrustedWhy`): `web_read` and `browser_open`
say `url_data`, and the card reads "with a URL that carries data (what follows the «?»), and content from a web page,
another agent or a message is in this turn". The rule itself is unchanged: a query is how outside content would send
the owner's data away, so it still waits.

<a id="d-122"></a>
## D-122 — 2026-10-21 — A big artifact is built as files, shown on save and run once to see it start
An agent asked for an app retyped a 15 KB starter through `show_widget` in one call, summarised it on the way, left
references to elements it had dropped, and never learned the page broke when it loaded: the tool only parsed the
scripts. Agents edit files well; retyping a whole page each time is where they lose pieces.

So a big artifact is a project in `<home>/artifact-sources/<project|global>/<name>/` (D-118's folder, writable by that
project's agents). Saving `index.html` there (or `dist/index.html`) with APX's own `file_write` or `file_edit` shows
it as the artifact `<name>`, a new version, as `show_widget` would, and its result says how it went: refused if a
script does not parse, otherwise shown, then run once. No tool was added and no tool text grew: the skill names the
folder (`{{artifact_sources}}`, filled in when it loads) and the agent copies a starter there with the shell
(`{{skill_dir}}`) instead of retyping it. `show_widget` stays for a quick view.

**Run once (`surfaces.check`).** The core's headless Chrome opens the page in a throwaway tab and browser context, with
the kit inlined, no network (fetch and WebSocket never answer, every URL is blocked) and a bridge like the panel's
whose calls run against a scratch artifact memory in a temp folder, so the page's first schema and queries really run
on nothing of the owner's. After two and a half seconds it returns the uncaught errors, rejected promises and console
errors, and the text the page shows (a page that catches its own failure only says so on screen). Without Chrome the
result says it was not run. The tab does not count against the browser's tabs and does not call Runtime.enable on
the agent's own browsing tabs.

**An app is built whole.** The skill asks for a plan file listing every view, then each view built and saved in turn
until all work, in the same turn, with questions only when they block: the owner asks once and expects the whole app.

<a id="d-123"></a>
## D-123 — 2026-10-22 — Work on a task stays legible: one session per agent, deliberate comments, comments that reach someone
A user moving a project into APX for two days kept re-uploading a guide and reminding agents where they were; on the
owner's own office one task opened 21 chats (each `delegate` a new sub-thread, each review a new one) and its
conversation repeated every turn's full answer. Nobody could tell what was going on without reading everything.

**One session per agent.** `delegate` naming an agent with no `session` goes on in that agent's latest session under
this chat (it keeps the context it built); naming a new `session` opens another. A worker's session and a task
consult are never reused.

**A helper knows the task.** A session delegated from a task's chat reads the task's `[task]` block too: what it is,
where it stands, whose chat it is, and that `task_get` and `read_chat` hold the comments and sessions to read before
redoing work. A task's own chat lists the earlier chats by id.

**Comments are deliberate.** A work turn's answer stays in its chat. It is posted to the task only when the turn
closes the task (the report, D-076) or asks the owner (@owner). Agents comment with `task_comment`, a few lines, when
others should know: a step verified, a block, something to review or decide. The drawer's tab is **Comments**, and
the task's sessions are a count at the top that opens their list.

**The owner's comment reaches someone.** One that names no agent is marked sent and, a minute later (so a few go
together), the office clock hands it to the task's agent in its chat, or to the super-agent when nobody has the task;
it then shows as delivered, and read once that turn ends. An @mention still asks at once (D-101).

<a id="d-124"></a>
## D-124 — 2026-10-22 — Review says who checks it, "Blocked" is "Waiting on you", and a task can start later
Owners could not tell **In review** from **Blocked**: both read as "someone else's", and nobody said who reviews.

**Waiting on you** (was Blocked): an agent asked the owner something or needs their decision (`awaits_owner`); it
goes on when they answer. Only the label changed.

**In review names its checker.** A task has a `reviewer`: the owner when unset, or an agent (`task_update reviewer`,
"Reviewed by" in the drawer, `apx tasks edit --reviewer`). Put in review, the owner's tray gets one notice (it clears
when the task leaves review); an agent named is asked to review it in a consult on the task, with the trigger `system`
so APX asking does not start a new budget window as the owner writing would (D-081). The row reads "Reviews: …".

**A task can start later.** `start_at`: an assigned task whose start is ahead does not start on assignment; the office
clock starts it when the time comes (each tick, not the hourly pickup). Only `task_create` takes it among agent tools:
an agent asked to plan something for tomorrow sets it there; moving it is the owner's, in the drawer or the terminal.
The two new tool arguments fit the tools budget by shortening three descriptions (rules/PROMPT_SIZE.md).

Details settled in review: the agent doing a task does not review its own work; an agent answering another one, or
paused by the breaker, asks no reviewer (the owner checks it), so reviews cannot loop. A start the clock reaches
starts as whoever gave the task (its creating agent's chain still spends its budget and a tripped one holds it); a
start cleared or moved to now before the work began starts it at once; an owner's comment starts it early, as
writing to it always does.

<a id="d-125"></a>
## D-125 — 2026-10-22 — The watcher also reports tasks set up so they cannot move, checked in code first
A task can sit open forever with nothing wrong anyone sees: its agent was removed, it was assigned with no
description (it never starts), it is in progress with nobody on it, its reviewer is gone, its start passed without it
beginning, it stays open under a closed parent, or it is in progress and nothing has run on it for two days (past the
stall revive's day, D-123). The watch routine's signals (`domain/signals.ts`) find these with plain store reads, as
`broken_task` signals, so the model is called only when one is new and only to word it for the owner. Commitments and
tasks waiting on the owner are left to their own signals.

<a id="d-126"></a>
## D-126 — 2026-10-22 — A delegate works in its own project, and a folder asked for goes as far as its caller may
A reviewer delegated with a folder but no `write` got `ask`, whatever its caller could do, so prompts had to say "pass
write auto" and agents forgot. D-104's rule stays (never more than the caller); the default and the cap change.

- **A folder asked with no `write`** gets the most its caller may (`auto` for a caller in auto, `ask` for one in
  manual or in a code thread that asks, `read-only` in plan or a read-only thread), instead of `ask`. A `write` named
  still only narrows it.
- **The ceiling is the strictest of three**: the caller's, the callee's own mode (its project's when it has none), and
  the mode of the project the session works in. A super-agent in total mode does not lift a project kept to manual.
- **A project's agent works in its own project**, wherever it is asked from: the super-agent in another project's chat
  asking a project agent of Acme gets it working in Acme. A worker, or a global agent, works in the chat's project as
  before; `project` named still decides.
- **Asked for nothing, nothing changes**: no folder of its own. Our loop works in its project anyway, as far as its
  mode lets it; an outside engine (Codex, an ACP agent) stays on APX's side of the project, where the folder's own
  settings cannot apply unchecked. A security review found that giving every delegate the real folder would have let
  those engines write there with nobody choosing it.
- On our own loop only `read-only` is enforced per session; `ask` and `auto` are what an outside engine runs under.

<a id="d-127"></a>
## D-127 — 2026-10-22 — An agent asks other agents with delegate; `apx chat` from its commands refuses
An agent ran `apx chat --agent … --detach` from its shell: the words reached the other agent as the owner's, in a new
chat, with no result coming back, past the breaker, depth and permissions, and the task ran twice in parallel. `apx chat`
is the owner's (and outside apps') way in; `delegate` is an agent's, and the only one with those checks (rule 2).

An agent's commands now carry `APX_AGENT=<its id>` (our shell and jobs, and the processes of Claude Code, Codex and ACP
sessions), and `apx chat` and `apx tasks say` refuse there, saying to use `delegate` or `task_comment`. The rest of the
CLI (tasks, status, reading) still works from an agent's command; the owner and outside apps use both as before. It is
a guardrail against a habit, not a boundary: the core trusts loopback as the owner, so a command that calls it directly
still could.

<a id="d-128"></a>
## D-128 — 2026-10-22 — Fewer summaries and chats, a plan that outlives them, widgets that can go, reviews that close
Follow-ups of the same audit (an owner who had to supervise APX to get a migration done):

- **Summaries measured as the model sees them.** A chat was summarized when the raw log since the last summary passed
  90k characters, counting every old tool output in full although the model only sees a stub of it; chats that read
  files or pages were summarized every turn or two, each time with a new notice. The threshold now counts older tool
  output as its stub, and a recent compaction notice (among the last 30 messages) is updated instead of repeated.
- **A plan on the task.** `task_update plan` keeps the agent's steps and progress on the task (Markdown, 4,000 at
  most); the `[task]` block shows it whole every turn, marked as data (an agent may have written it from what it read
  outside), to the task's agent and to helpers delegated from its chat, so a
  guide does not have to be uploaded again after a summary. The drawer shows it under the description.
- **Widgets can be deleted** (`surfaces.remove`, owner only, after a confirmation in its actions): the row and its
  memory folder go; chats keep their messages; its source files stay. A chat opened to ask for a new artifact and
  closed with nothing written in it is deleted.
- **One chat for release news**: each release goes on in the same chat, retitled.
- **Reviews close the loop.** A review an agent was asked for (D-124) that does not open with "Approved" (or
  "Aprobado") moves the task back to doing and reaches its agent in its chat as the reviewer's words (an agent's,
  trigger `a2a`), to fix and put back in review, which asks the next round; an approval tells the owner it is ready to
  close. Nothing is asked when the task was closed or taken out of review meanwhile, or the doer's chain is paused (the
  owner hears instead). At most two agent review rounds per task: then the owner decides. A reviewer's @owner still
  asks the owner. The review's chat is titled "Review: <task>".
- **A reused session reads as its latest request** in the lists.
- **A delegated session capped at ask asks** before changing files on our own loop too (an outside engine already ran
  under it). The owner's own chats keep following the agent's mode: a code chat's default `ask` is for outside
  engines (D-106).
- **Size bounds stay out of what our loop sends** (`minLength`, `maxLength`, `minItems`, `maxItems`): arguments are
  still checked against the full schema here, and Claude Code and Codex still read it whole. The tools budget went
  from 27,998 to about 25,700 characters, room for what comes next.

<a id="d-129"></a>
## D-129 — 2026-10-22 — The owner's phone hears Home; one session per teammate; what needs the owner is one group
**The phone is Home's.** Answering a button on Telegram set that chat's reply route, so a project agent's whole
conversation followed the owner to their phone. Now only Home (the super-agent) and contacts' chats answer on a
channel; another chat of the owner's sends there only what needs them (a question, an OK) and its answers stay in the
app, whoever answered from where. Home's turn reads what the owner's other chats sent them since its last turn, with
the chat it came from, so a reply typed after an action reaches someone who knows what it is about and passes it on.

**One session per teammate.** A new session name for an agent that already has a free session in that chat goes on
in it, and a free session asked to work in another folder or with another policy of the same project moves there with
its context (D-106 opened a new one). A busy session still leaves room for work in parallel; another project still
opens another.

**What needs the owner is one group, first.** "Needs your review" holds a question or decision for the owner and a
finished task with no agent to review it; each row says which. "In review" is an agent's review. Each group's title
has its "?" in the list. The mobile app groups the same way.

<a id="d-130"></a>
## D-130 — 2026-10-22 — APX ships its own Google sign-in; Drive joins; an event only on the owner's calendar needs no OK
D-103 had the owner make an OAuth client in Cloud Console, a step most owners never finish. APX now ships one: a
**Desktop app** client, which Google treats as public (an installed app cannot keep a secret; its own guide says so)
and which reaches nothing by itself: every access is a consent the owner gives in Google's page, guarded by PKCE and
the signed one-use state of D-103, and the refresh token stays in the owner's secret store. Leaked, the pair lets
someone show a consent page named APX, which Google's warning and the owner's own click still stand between. Even so it
is not committed, nor obfuscated: Google requires the secret in the code exchange (checked: without it, "client_secret
is missing"), so a release build writes `google-client.json` beside `build.json` from CI's `APX_GOOGLE_CLIENT` secret,
and a checkout keeps the same file, git-ignored, at its root (Cloud Console's download works as is).
`APX_GOOGLE_CLIENT` (`id:secret`) in the environment replaces it, and a core pointed at a stand-in Google never uses it. The owner's own
client stays as **My own OAuth client**; each integration remembers which client signed it in (a refresh token works
only with the client that issued it), and the owner's client is forgotten once nothing signs in with it. Rejected: a
hosted token broker with a confidential web client (every refresh through APX's servers, a service to keep up, and
the owner's Google access leaving their machine).

APX's client asks only for scopes Google verifies without its paid yearly security assessment (CASA): Calendar
(`calendar.events`, `calendar.readonly`, sensitive), `gmail.send` (sensitive) and `drive.file` (not sensitive). So with
it agents send mail (always confirmed, `gmail_send`) but do not read it (the Email channel does), and reach only the
Docs APX wrote. The restricted scopes (`gmail.readonly`, `gmail.compose`, `drive.readonly`) and their tools stay with
the owner's own client, whose consent page says the app is unverified. So the dialog starts Calendar on APX's client
and Gmail and Drive on the owner's (APX's is there, marked limited), with a guide to create one in Google Cloud and the
downloaded JSON as the way to enter it; one sign-in can connect the other parts with the same client (`also`), each
keeping the refresh token. OpenClaw (`gog`) and Hermes ask every user for their own client too; neither ships one.
The app is **In production**, not Testing, or Google would end every grant after seven days; until its verification
passes, at most 100 accounts can grant it the sensitive scopes.

**Google Drive** is a third part, connected on its own like Calendar and Gmail: `drive.readonly` to find and read
files (Docs as text, Sheets as CSV, Slides as text, text files as they are; binaries are refused with their link) and
`drive.file` to write Docs and share what APX wrote (with APX's client, only the latter); nothing else of the owner's
can be changed. Calendar edits the
current guest list (`add_attendees`/`remove_attendees`, answers kept), adds a Meet link to an event without one, and
cancels. Confirmations follow D-106's strong actions: an event only on the owner's calendar, a change to one, and a
Doc APX writes are the owner's own and do not ask; inviting people, cancelling and sharing a file speak to others in
the owner's name and ask; sending mail still always asks.

<a id="d-131"></a>
## D-131 — 2026-10-22 — One owner per task, hand-offs through tasks, and follow-ups an agent proposes
**One owner per task.** The agent a task is given to carries it end to end; it uses its own workers for separate
context and asks another agent a quick question with `delegate`. Work for another agent goes through a sub-task, not a
chat, so it has a state, an owner and a history.

**Proposed tasks.** `task_create` takes `propose`: the task is saved with `proposed`, gets no work until the owner
accepts it (`tasks.update` with `proposed: false`, the owner only), and the owner gets one notice per proposing agent.
An agent creates what its own role hands out and proposes the rest (QA, reviews, another area's work). The panel lists
proposals first, with **Accept all**; the mobile app groups them the same way.

**Proposals the agent did not ask for.** The fan-out check (a third agent in one turn asks first) no longer stops a wide `task_create` with a card:
those tasks become proposals, so the owner picks which go ahead; a wide `delegate` still asks. A sub-task three
hand-offs deep, or one for an agent that created a task above it, is a proposal too, so agents cannot pass work down
forever or ping-pong it. Rejected: a counter on the task (it misses a chain that runs across tasks).

<a id="d-132"></a>
## D-132 — 2026-10-22 — An agent's @mention on a task asks that teammate, and the answer comes back to it
D-078 kept agents' @mentions silent (an agent asked with `delegate`), so agents working a task asked each other in
chats the task never showed. Now an agent's `task_comment` that @mentions teammates opens a consult on the task for
each (two at most): the card shows the question and the answer, and the answer comes back to the chat the agent asked
from as the teammate's words (`a2a`, no new budget window), so it goes on without polling. A comment said inside a
consult or a delegation asks no one, so answers never chain; a paused chat or agent (D-081) is not woken. `delegate`
stays for a question that does not belong on a task.

<a id="d-133"></a>
## D-133 — 2026-10-22 — Secrets in the system's own store on Windows and Linux too
D-010 kept values in the macOS Keychain and left Windows and Linux in `secrets.json` (0600), readable by any process of
the user, an agent harness's sandbox included. The Google sign-in (D-130) made that file hold refresh tokens, so every
system now has a store of its own, each through its own command with values on stdin, never on argv
(`secrets-stores.ts`):
- **Windows: DPAPI.** Values sealed for the user's account (`CurrentUser`, the home's service name as entropy) in one
  `secrets.dpapi`, through Windows PowerShell's `ProtectedData` (always installed). Credential Manager is DPAPI too, but
  caps a value at 2.5 KB, which a service account's key passes.
- **Linux: the Secret Service** (GNOME Keyring, KWallet, KeePassXC) through `secret-tool`, attributes `service` and
  `account` as the Keychain's.
- **macOS: the Keychain**, unchanged.

The index (`secrets.index.json`: names, dates, hints) stays a file. A store is chosen when it answers a round trip;
otherwise (a Linux server with no keyring, PowerShell blocked) the file stays, as before. Once values went to a store,
that store stays chosen even while it does not answer, so a core started before the keyring unlocks (a service at boot)
shows the owner's names and finds their values once it opens, instead of falling back to an empty file; such installs
can set `APX_SECRETS=file`. Values in `secrets.json` move to the store once at start, as D-010 did for the Keychain.
The newer stores look up only names the index lists, so a check for a missing secret runs no command. Checked against a
real keyring in a Linux container; the Windows store runs only against a stand-in so far.

<a id="d-134"></a>
## D-134 — 2026-10-22 — Initial panel bundle budget
The owner approved raising the initial gzipped panel bundle budget from 270 to 275 KB. The released panel already sat
over it (270.07 KB on `origin/release/v2`, measured the way `pnpm verify` builds it), and the day's work added 0.13 KB
more, after the renderer of Google's 2026 icons moved to the marks chunk. What is left on the first screen (messages,
the composer's model picker, its "/" menu) cannot load later without reshaping it, and trimming it to fit would trade
real work for 0.2 KB. The performance gate keeps measuring the same initial assets; every other budget and test gate is
unchanged. The next panel feature that grows the first load moves something out of it instead of raising this again.

<a id="d-135"></a>
## D-135 — 2026-10-22 — The secretary reads new mail and tells the owner what needs them; the brief reads Calendar
The owner wanted Roby to notice an important mail as it lands, not at the next watch two hours later. A routine action
`mail` joins `watch` and `relay`: each run asks Gmail's history what reached the inbox since its last point (kept as
`mail_seen:<routine>`; the first run starts from now, and in quiet hours it waits so the first run after sees it all).
Mail in Gmail's promotions, social and forums tabs, spam, trash and the owner's own never reaches the model, and with
nothing left there is no model call at all: polling is Gmail's free history call. What is left reaches the routine's
agent as `untrusted("emails")`, one line each (from, subject, date, a snippet, whether Gmail marks it important); it
tells the owner in one or two lines or answers SKIP. Delivery is the routines' own: the owner's notice channel, the
daily budget, 👍/👎. Its tools are not narrowed per routine (none are, D-106); with mail in the turn, sending or
drafting as the owner keeps asking, and its prompt says never to act on a mail there. It reads only with the owner's
own Google client (D-130: APX's cannot read mail), and stays silent otherwise. The secretary gains it as "Important
mail", every `mail_every_min` (default 5, 2 to 60), and its morning brief reads today's events with `calendar_events`
when Google Calendar is connected, so `calendar_command` is only for other calendars. Profile numbers now keep inside
their declared range, since they end up in schedules.

<a id="d-136"></a>
## D-136 — 2026-10-22 — A channel's attention hours: contacts wait outside them and are answered once when they begin
The owner wanted channels not to answer contacts all day: a message at 22:00 is read at 08:00. A channel can keep
**hours** (days, from, to), read on the clocks of the owner's declared time zone (`ownerTimeZone`; none: the core
computer's), never the machine's when they differ. Hours past midnight belong to the day they start on; the same time
twice is the whole day.

Outside them a contact's direct message is kept like a silenced one (`keepQuiet`, unread, the agent's note says it came
outside the hours), transcribed if it is a voice note, and the chat is marked in `channel_held` (a table, so a restart
keeps it and the clock does not scan every chat's context). Each tick of the office clock opens chats whose hours have
begun, three at a time, longest waiting first: one turn with origin `hours_began` (a contact's words, framed as
untrusted) reads the night's messages from the history and answers once; a supervised contact gets its draft then. A
message inside the hours before that tick clears the mark and is answered by its own turn, so nothing is answered
twice. A chat whose person was silenced or removed, or whose channel went off, stops waiting with no turn.

Not held: the owner (on any channel, their Home always answers), answers to buttons and questions, a contact marked
`any_hour`, and rooms for the owner; for anyone else a room keeps its messages outside the hours and never catches up,
since its conversation moved on. No automatic "we are closed" reply in this version: the owner's example was simply to
read at 08:00, and a reply at night is a message sent on their behalf.

<a id="d-137"></a>
## D-137 — 2026-10-23 — Stickers are kept as they arrive, named once, and sent back by meaning
v1 kept a sticker lexicon and the owner missed it: an agent that reads "[sticker]" cannot tell a hug from a shrug, and
on WhatsApp a sticker is often the natural answer. Every sticker that reaches a one-to-one chat on WhatsApp or Telegram
is kept the moment it arrives in `stickers`, one row per **platform** and file (the bytes' SHA-256, the same whoever
sends it), its file a media row of its own so it outlives the chat. Platforms never share: a Telegram sticker (often
animated `.tgs`) is not a WhatsApp one, and the agent only sends a platform's own.

It is named once, by the models known to read images, auxiliary first, then the router's (`see` in upkeep, aux purpose `sticker`),
in the owner's language; an animated one, or an install with no such model, takes the emoji the platform says it stands
for. The message waits up to 20 seconds for the name, then the agent reads it unnamed and the name lands later. The
agent reads `[sticker: meaning]`; a silenced contact's sticker is kept without a model call.

To answer with one the agent writes `STICKER <what it shows>`, a signal like `REACT` (no tool: no prompt cost on turns
without stickers). Matching is by words of the meaning, at least half of them; below that nothing goes and the owner is
told, since the wrong sticker says something the agent did not mean. A channel turn lists the platform's twelve most
used meanings under `[stickers]`, so the agent picks among stickers that exist. Whether the agent may send a sticker is the owner's: by default a new one is
the agent's to use as soon as a model named it (the owner blocks what they do not want), or, with `stickers_auto` off,
each waits for their OK. One the naming model marks `[18+]`, or one no model could see (an animated sticker, an install
with no vision model), always waits: what nobody looked at may be anything. The owner is told in the tray when one
waits, and approves it in the channel's Stickers section or by asking the super-agent (`apx_settings`, approved). Discord's stickers are not read nor sent
yet: a bot can only send its own servers' stickers.

<a id="d-138"></a>
## D-138 — 2026-10-23 — The super-agent changes the owner's settings through one tool, and every owner method is placed
The owner wants to ask the super-agent for anything they can change in the panel ("add rules to this contact and say
who she is") without other agents getting the same reach. Two ways were open. The `apx` CLI from the agent's shell
announces itself as the agent, so the router refuses owner-only methods there; letting it through would make a shell
command, read as a command line, the only card the owner approves, and a command an agent may run freely would act as
the owner. One tool per setting would grow every super-agent call with the panel (rules/PROMPT_SIZE.md).

So `apx_settings` is one tool, offered only to the super-agent (`SUPER_AGENT_TOOLS`): with no args it lists what it
reads and changes, with a method alone it gives that method's fields (from the protocol's own schema), and with params
it runs the owner's method through the router as the owner, after the owner approves a card that names the record and
shows each field before and after (`explain`). The arguments are checked against the method before anyone is asked.
Reads come from the store, with nothing secret in them.

`tools/settings-reach.ts` places every owner-only method that changes something: in `apx_settings`, in a tool of its
own (`agent_set`, `routine_set`…), kept the owner's with its reason (keys and sign-ins, what agents may do and their
models per D-060, the machine, the panel's own views, the owner's own answer or send), or `NOT_YET`, the list still to
place. `settings.test.ts` fails on a new owner method nobody placed, so the super-agent's reach is decided with each
new setting instead of found missing by the owner. Contacts are the first area in it.

Every area is placed now (`NOT_YET` is empty), in `tools/settings-people.ts` (contacts, channels, iMessage, the
owner's profile, notices), `settings-team.ts` (archived agents, copies and templates, one agent's limits, routines,
agent profiles, tasks, chats, imported sessions) and `settings-work.ts` (projects, memory, skills, MCP servers and
extensions on or off, media services, widgets). A method that replaces a whole record (a channel, the owner's
profile, notices, memory's settings, image defaults) gets the record merged under the fields asked for, so a field
left out keeps its value and the card lists only what changes, nested ones by path (`channel.strangers`); a change
equal to the record answers "nothing to change" and asks nobody. Some fields are refused before the owner is asked,
because the method carries more than the area: a channel's token, mail account, type and `research` (D-059), removing
a channel (its sign-in goes with it), a project's autonomy and read-only folders and a chat's write policy (D-060),
memory's model. Kept the owner's as a whole: adding an MCP server (its command runs here and its env carries keys),
the fan-out question (how far agents act), installing a profile, an extension, a local model (the machine), and the
panel's own acts (recovering a chat's lost files, importing a widget file, resuming a coding session). Reads stay
from the store with nothing secret: channels without tokens, services without keys.

<a id="d-139"></a>
## D-139 — 2026-10-23 — Channels that deliver only to a webhook get a public address, on a listener of their own
Teams, LINE and WhatsApp's business API do not let a bot pull its messages: they POST each one to a public HTTPS URL.
The core listens only on loopback (rule 7) and has one contract, the router (rule 1), so those channels stayed
"coming". openclaw and hermes open their gateway's port and leave the owner to put a tunnel in front (Microsoft's dev
tunnels, ngrok, Tailscale Funnel); hermes also tries a hosted relay. Exposing the core's own port would publish the
panel and the API, and a hosted relay is a service APX would have to run for everyone.

So webhooks get a second HTTP listener (`transport/hooks.ts`), on 127.0.0.1, at the core's port + 8 (`APX_HOOKS_PORT`;
a free one when that is taken), that takes only `POST …/hooks/<channel id>[/…]` up to 1 MB and hands the raw request
to that channel's running adapter (`ChannelAdapter.webhook`); every other path is 404, and an adapter answers in 15 s
or the platform gets 503. It is not a client↔core call, so it is not a router method: the platform is no client, and
each adapter verifies its platform's own signature (Teams' Bot Framework JWT, LINE's HMAC) over the bytes as they came
and refuses what it cannot verify. A failure's detail stays in the log.

What publishes that port is the owner's choice (`webhooks.set`, Settings › Channels › Public address), kept and applied
again at every start (`webhooks.ts`): Tailscale Funnel on HTTPS port 8443 (443 stays what `apx tailscale connect`
serves to the tailnet, and only APX's own Funnel is undone when it is turned off); ngrok, started and watched by the
core, which remembers the last address ngrok gave and tells the owner only when one is new (a free account usually
keeps one across starts; a reserved domain can be given); or the owner's own https URL (a proxy they run). Each adapter reads its address through `io.hookUrl()`, and a
channel that needs one and has none says so in its status until one exists.

<a id="d-140"></a>
## D-140 — 2026-10-23 — The owner's settings change on their card, at their word alone
With D-138 the super-agent can change nearly everything the owner sets up. The owner asked that each such change
always show its card (do it or not), and that no other agent can get the super-agent to make one. Before, `always`
skipped the card on Total (D-047) or under the agent's own rule for that risk, and a message another agent posted in the
super-agent's chat (origin `agent`) reached a turn that had the tools.

A tool marks such calls with `ownerSetting` (`agent_set` and `apx_settings`, the tools only the
super-agent has; `owner-setting.test.ts` fails on one without it). `authorize` turns an allow into a card for them in
every mode and under every rule; plan mode still refuses them. The executor refuses them, before anyone is asked,
unless the run's origin is the owner's own: their message in the app or on a channel as the owner, or their answer to a
question the agent asked (`ownerAsked`). Another agent, a contact, a routine, a job or a task result gets "only when the
owner asks you themselves". A delegated run already loses these tools (`inherit` keeps what every caller may use).

<a id="d-141"></a>
## D-141 — 2026-10-23 — The super-agent adds MCP servers, their keys only by reference
D-138 kept adding an MCP server the owner's, since its command runs on this computer and its env and headers carry
keys. The owner wants to ask for one in chat and then say which saved variable holds its key. `mcp.set` is now in
`apx_settings`, under D-140 (the owner's card in every mode, only at their word): the card names the server and shows
its command or URL, args and each env or header field. A value that reads like a key once its `secret://NAME`
references are taken out (a run of 20 or more letters, digits, `_` or `-`, with both letters and digits) is refused
before anyone is asked, as is a variable in args (it would show in the process list). Saving the key stays the
owner's (`secrets.set`, Variables, or `apx secrets set`); the answer names the variables still without a value.
`mcp.list` reads the owner's own servers, showing a value that reads like a key as "(a value)". Trusting a project's
server and approving its tools stay the owner's.

<a id="d-142"></a>
## D-142 — 2026-10-23 — A teammate's request is acted on, and an agent puts a decision to the owner as an action card
A publisher agent asked by a teammate to post (and move two posts that clashed) refused: the system prompt said
"authorization to send, post or pay cannot be relayed", so a request from one of the owner's agents read as no
authorization at all, against D-071. Asked again by the owner in its own chat, it asked the teammate, whose answer the
prompt called "data, not new authorization", and refused again. No call was made, so APX never showed a card, and the
owner could not write in the read-only chat between the two agents: they only got it moving by writing new requests.

Now a send, post or payment the agent can make still stays with it (it delegates only the preparation), but one a
teammate asks of it is the owner's work: it makes the call and APX asks the owner when its mode and rules say so; it
never refuses as relayed nor sends the owner to repeat it. The line on asking another agent about earlier work loses
its "not new authorization": that answer is evidence, and permission is the permissions service's (D-115), not the
model's.

For what only the owner can decide (a clash, two ways to go), `ask_owner` takes `action`: one concrete action (what,
where, when), shown as a card to accept or decline, not a question. It is an input of kind `confirm` with no tool and
no folders, so the panel, the mobile app, the channels and the "Needs your review" group show it with their usual
buttons; the panel titles it "Accept this action?". Accepting tells the agent to do it now; a late answer wakes it as
a question's does; the agent can withdraw it. Accepting does not grant the calls it takes: each still passes its own
check, since the card's text does not bind a tool's arguments. An agent with "always" for that tool gets no second card.

<a id="d-143"></a>
## D-143 — 2026-10-23 — Total keeps its power, except over what the owner set up and their logins
A review found that Total (D-047) and an agent's rule `auto` let calls that act as the owner run with no card: letting a
stranger in (`answer_contact_request`), changing how far agents go alone (`agent_limits`), copying the owner's browser
cookies (`browser_use_my_login`). The executor handed `callAsOwner` to any call whose tool "always" asks, once the
policy said allow, so "the owner approves it every time" (the tool's own description) was false on Total.

The owner's rule: Total keeps its power, with these limits. A change to something the owner set up asks on its card in
every mode: D-140's `ownerSetting` now marks every tool that acts through `callAsOwner` on their setup, not only
`SUPER_AGENT_TOOLS` (`answer_contact_request` when it lets someone in, `agent_limits` when it changes or lets go on), so
accepting a contact request also needs the owner's own word (`ownerAsked`). Such a card offers no "always" answer, and
no grant skips it. Routines change freely: `routine_set` keeps no card in Total. A tool can also keep its card where the
mode would skip it (`keepsCard`): `card`, nothing skips it; `grant`, only the owner's grant does.
`settings-reach.ts` `TOTAL_SKIPS` lists the tools that act as the owner and may run unasked in Total (routines, an Asana
write), with their reason; every other tool in `BY_TOOL` keeps its card, and `owner-setting.test.ts` fails otherwise.
`callAsOwner` is given only when this call passed its card (answered, or the owner's grant) or ran unasked under a mode
or rule on a tool that keeps no card. The MCP server card (D-141) shows each value whole, never cut at 300 characters
(`Setting.whole`), and says in a plain line which saved variables go, as which env or header, to which address or
command.

`browser_use_my_login` runs without a card only when the agent's browser is declared shared. Every agent's profile is
`shared` unless the owner picks another (the column's default, and the seed's), so the stored value says nothing about
a choice, and copying the owner's logins on a default is what the review found. The declaration is the owner's own
"Always for this agent" on its card: the tool keeps its card in Total (`grant`) for a shared profile, and an isolated
one keeps it whatever is granted (`card`). A setting of its own would have meant a new field in the protocol, the
editor and every agent file for one tool; the card already asks, and its answer is the explicit choice.

<a id="d-144"></a>
## D-144 — 2026-10-23 — Only the app approves, and the owner's words on other channels go through the super-agent
A review found that the owner's identity on most channels is the platform's word, and that word is weak: ntfy knows
only a topic, IRC a nick without an account, an SMS sender's number and a mail's From can be forged, an email channel
may trust unverified mail. Whoever passed as the owner there got an owner run (`inbound.ts` sent their words as the
owner's) and could answer the cards APX sent to that chat (a button, a number, a text answer), and since D-141 that
reaches `mcp.set`: a command run on the owner's machine.

The owner's rule. A card about the owner's settings (`ownerSetting`) is approved only in the app: the panel, the
desktop or the paired phone. Its input is stored `app_only`; `runs.respond` refuses it when the call came from a
channel (the channel manager sets `channel` on its calls, never a request), a channel shows it without buttons and
says where to answer it, and a press on it is refused. Telegram stays the one channel whose owner messages act
directly (`OWNER_ACTS_ON` in `domain/channels.ts`), its other cards answered there as before; that reading of the
owner's words ("Telegram is the exception for direct owner runs, but setting approvals still happen only in the
app") is a judgment call, flagged as such. On every other channel the owner's words trigger nothing directly: no owner
run, no answer to a card or question, no button, no draft sent to a supervised contact. The words are kept in the
owner's chat as a sender's (untrusted, marked as claiming to be the owner, not verified) and become a conversation
with the super-agent, even when the channel's agent is the super-agent itself: `engine/owner-relay.ts` opens the
"owner-check" sub-thread of that chat and starts the super-agent there, with the channel and what its platform can
vouch for. It judges whether it really is the owner and whether the request is risky, may ask the owner in the app
(`ask_owner`: a question or an action card, D-142; its run's answers go to the app, never to that channel), and its
answer comes back to the channel's chat as a delegated result (`delegation_result`, the sub-thread's session), whose
agent then does what was decided and answers on the channel. Nothing new carries it: the run enters through `admit`
like a delegation, the answer returns on the delegation result's path, and the owner is asked through inputs.

What follows from it. The relayed run's origin is another agent's, so it is not owner-asked: the super-agent cannot
change the owner's settings from there (D-140), and an owner's late answer to its question does not make it so either
(an `input_answer` counts only when the run that asked was owner-asked). Cards and notices with buttons sent to a
channel other than Telegram lose their buttons and say to answer in the app; a supervised contact's draft, a request
from a stranger and a news button are decided in the app. The unverified words sit in the owner's chat as outside
content, so that chat's next turns see outside content in their context (rule 10) until it leaves the window. Each
relayed message still starts a new spend window for the breaker (D-080), as the owner's own words did: it opens at the
answer turn, which stands for the owner's own and is not counted, so the check and its answer never pile up into a
pause. "Pará" still stops a running turn from any channel: stopping acts for
nobody. Steering a running turn and interrupting it are Telegram's and the app's. A public room the owner speaks in
stays sealed as before (its turns have no owner tools).

## D-145 — 2026-10-23 — CI in parallel parts, flaky Windows files rerun once and counted, only verified commits tagged
`verify` took 16–28 minutes: the panel's 229 specs ran in one part (13–21 min) because they shared one sandbox, and
Linux preflight ran every unit test in series (8.5 of its 11.5 min). The v2.9.0 tag went on a commit whose run then
failed on a Windows flake, and publication slipped ten hours until a re-tag on a verified commit.

- **The panel runs in three parts**, each with its own core. What specs may share is a Playwright `setup` project
  (the first-run setup, the owner's Telegram, the WhatsApp line), replayed first in every part; any other state a spec
  needs, it makes itself. Local runs keep one core and the same order.
- **Preflight is split, not reduced:** static checks (`pnpm preflight:static`) on one machine, every package's unit
  tests over two (`test-shard.ts`). The lightness budgets join the static job instead of queueing for a runner.
- **Windows reruns a failed test file once.** Its runners are slow and noisy enough that waits tuned elsewhere miss
  (hence also `TEST_TIME_SCALE=3`), and one such miss held a release for ten hours. A file that passes on the rerun
  is reported, never muted: a warning annotation on the run and a row in the job summary, so every flake is seen and
  counted from the run's annotations; each is a bug to fix, not a pass. A file that fails twice fails the job. A
  crash no test reported is never rerun. Linux and macOS, coverage and the panel do not rerun (Playwright's own one
  retry in CI stays as it was). If the flaky count does not fall, the rerun goes, not the reporting.
- **Windows before merge:** `windows.yml` runs the Windows parts on pushes to `feat/**` and `fix/**`.
- **Only a verified commit is tagged** (AGENTS.md rule 28): `pnpm release:check --tag v2.x.y` reads that commit's
  newest verify run and tags only after it passed. The publish job's wait stays as the second guard.

<a id="d-147"></a>
## D-147 — 2026-10-23 — The panel's late code is declared in one registry, and the first load is measured from the build
The first-load budget counted only the files `index.html` names, about 270 of its 275 KB. The language chunk
`main.tsx` waits for imported its notice strings from the `@apx/protocol` barrel, and that barrel's side effects kept
zod and every method schema on the boot path, unmeasured: what a first screen really downloaded was 379 KB gz. Opening
the inbox then fetched the widget chat and the project settings too (the Apps dock and the new-project dialog took
helpers from them), bringing that protocol chunk again. Lazy declarations were spread over 19 files, some targets
declared three times, and the `$initial` chunk group merges whatever the entry reaches, so one stray static import
moves a whole screen into the first script without any error.

Now `scripts/bundle.ts` reads the built `dist/`: `boot_gzip_kb` is the entry, its CSS, the heavier language chunk and
the static imports of each, budgeted beside `initial_bundle_gzip_kb`; `pnpm perf` also fails when zod reaches that set
or a named lazy screen loses its own chunk, and names the heaviest chunks and, from a sourcemap, packages. Every
`lazy()` and late `import()` of panel code lives in `apps/web/src/lazy.ts`, and a Biome `noRestrictedImports` override
lists those files for `App`, `main`, `shell/`, `inbox/` and `chat/`. The registry was kept only after measuring that it
adds nothing: entry −0.1 KB gz, the same chunk count, the same heap after load. `e2e/specs/89-first-load.spec.ts`
checks what opening the inbox fetches, the late parts included.

Measured on the built panel and in the e2e sandbox (JS heap after opening the inbox, median of 5): first load
379.3 → 324.7 KB gz, entry 272.8 → 260.7 KB gz, heap 11.1 → 7.3 MB.
<a id="d-148"></a>
## D-148 — 2026-10-23 — An agent offers to connect what a request needs, never from a sealed chat
Asked for something an app or channel the owner has not connected would do (open a Figma file, send it on WhatsApp),
an agent could only say it could not. `suggest_connection` looks the request up through `integrations.find`, a method
open to agents that returns only names, descriptions, kinds and whether each is connected: the integrations catalog,
Google, Asana and the channel kinds (`integrations/find.ts`). A name match outranks a description match, and a
connected one comes first.

- **When the card appears:** only when the best match is not connected. Up to three of the unconnected matches go on a
  "Suggested connections" card in the answer; Connect opens that integration's form in the chat, a channel opens its
  setup in Settings › Channels. The agent is told what it showed and to stop there until the owner says it is
  connected. An already connected match gets no card: the agent is told to use it. No match: the agent says APX does
  not connect to it yet.
- **Never in sealed chats:** a contact's or a room's turn gets only the tools the owner allowed for that person, and
  `suggest_connection` is not one of them, so nobody but the owner is ever offered a connection. It stays in the
  owner's turns even when no channel is on (unlike the channel tools), since connecting the first one is its job.
- **What agents see:** labels and descriptions of what APX can connect and a connected flag; never credentials,
  accounts or settings. Connecting stays the owner's act on the card or in Settings.

<a id="d-149"></a>
## D-149 — 2026-10-24 — A close contact's message for the owner always reaches them, and every passed request is told
A contact's agent told the person "I'll pass it on", but without the requests flag (D-022) nothing was passed, and
with it the task only showed in the app's tray: the owner learned of it at the next morning summary. `pass_request`
now has a third kind, `message` (something they want the owner to know or do, like calling someone they shared), open
to anyone with the requests flag and, with no flag, to the owner's partner, family and friends. It still only files a
task for the owner, capped per person. Each request, appointment or message passed or updated in a turn is told to the
owner on their notice channel when the turn ends (silent in quiet hours), as well as in the tray.

<a id="d-150"></a>
## D-150 — 2026-10-24 — WhatsApp and Signal act on the owner's word, like Telegram
D-144 sent the owner's words on every channel but Telegram through the super-agent's check. On WhatsApp that left the
owner unanswered when writing from their own number: the check asked them in the app, the chat waited, and the agent
later doubted the link between the number and the owner. WhatsApp and Signal are not weak the way D-144's list is: the
sender is the account whose end-to-end keys signed the message, which nobody forges by typing a name, a topic or a
From line; the remaining risk (someone holding the owner's unlocked phone) is the same as Telegram's. So both join
`OWNER_ACTS_ON` (`domain/channels.ts`): the owner's words there start an owner run, and cards and notices come with
their options (numbered on WhatsApp). What D-144 keeps stands: a change to the owner's settings is approved only in
the app (`app_only`), and the channels whose sender can be forged (ntfy, IRC, SMS, email, Twitch) and the rest still go
through the super-agent first. Discord, Slack and the other account-based platforms stay as D-144 left them until the
owner asks otherwise.
