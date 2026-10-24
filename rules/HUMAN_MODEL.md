# Human model — APX v2

For an owner who will not read every file. Also serves as the system map; update it when a process, module or
boundary changes.

## 1. Processes that run

| Process | Entry | Role | Lifetime |
|---|---|---|---|
| **core** | `apps/core/src/main.ts` (`pnpm dev`) | The only owner of state. Serves the protocol on `127.0.0.1:7440`. | Long-running (a user service: `apx service`, or the desktop app starts it). |
| **terminal** | `apps/terminal/src/main.ts` (`apx`) | One command → protocol call(s) → exit. | Per command. |
| **web** | `apps/web` (Vite on `:7441` in dev) | Panel in a browser. Talks to core through the Vite proxy. | Per tab. |
| **desktop** | `apps/desktop` (`pnpm --filter @apx/desktop dev`) | Panel on the left, embedded browser on the right; connects to core as a **node** offering `browser`. | While the app is open. |
| **mobile** | `apps/mobile` (Expo) | Operator + node (camera, notify). | App lifecycle. |

Desktop supervises only a bundled child for its explicitly local home/port. URL and SSH connections never grant
implicit lifecycle control over the server; client restart/update does not update the server. Production daemon
startup holds an OS-released SQLite lock per canonical home, independent of port. Local service identities are
home-specific; `APX_URL` does not redirect OS service commands. See [Desktop lifecycle](DESKTOP_LIFECYCLE.md).

## 2. How a call flows

```
client (terminal | web | desktop | agent tool)
   │  HTTP POST /rpc/<method>   or   WS: hello → welcome, then req/res, event
   ▼
apps/core/src/transport/{http,ws}.ts        adapters only: parse, auth header, hand to router
   ▼
apps/core/src/rpc/router.ts                  known method? idempotency key if effect? params valid (zod)?
   ▼
apps/core/src/rpc/<domain>.ts handler        does the work (calls engine/, domain/, db/, nodes/)
   ▼
result validated against the registry → same frame shape on both transports
```

Optional project preparation uses owner-only `projects.helper_review` and `projects.helper_set`. The core reuses
project context, memory, open tasks and existing chats; settings keep the opt-in flag and bounded dismissal
fingerprints, not new permissions. Context inserted into a brief or prompt proposal is escaped JSON, explicitly
marked as untrusted reference data. The panel previews the complete before/after and asks separately before
applying proposed instructions to an unchanged, empty agent draft. Dismissal or navigation never applies them;
only the existing `agents.create` operation persists a new agent. Starting work uses the existing `threads.send`
operation; preparation never blocks creation or ordinary chat.

Node capabilities (`browser.*`): the handler is `apps/core/src/rpc/browser.ts`, which asks
`apps/core/src/nodes/broker.ts` to send the same method + params to the connected desktop over its socket; the
desktop executes it in `apps/desktop/src/main/browser/host.ts` (re-validating params and tab control) and the
core validates the answer against the registry. No desktop connected → `unavailable` immediately.

The registry is `packages/protocol/src/methods.ts`. Adding a method = registry entry + handler; every client
gets the types. There is no other way into a handler.

## 3. Modules and dependency direction

- `packages/protocol` ← used by everything. Isomorphic: no Node-only imports.
- `packages/ui` ← web (and desktop through web). React + Base UI + CSS tokens.
- `packages/install`: Node-only desktop download, checksum, installation and launch shared by core and terminal.
  The protocol remains isomorphic. Direct local human-only `desktop.install` starts one bounded operation;
  `desktop.install_status` reports progress and `desktop.install_cancel` aborts a download still in progress.
  The local web panel offers this when the desktop is absent; its sidebar keeps Open desktop above the account once installed.
- `packages/surfaces` ← placement types and an inline CSS kit shared by panel, mobile and public widget hosts.
  The stored app flag controls layout in every host: widgets keep a 16–24px inset even when maximized;
  declared apps use zero inset and no kit width cap. Height fitting and view do not change the saved type; kit classes opt into
  APX typography, cards and responsive controls.
  The bundled `apx-artifacts` skill (artifacts of kind widget or app) includes the starters. Agent `edit_widget` changes app/pin flags through
  `surfaces.update` without reading or replacing HTML; metadata-only changes preserve the content version and share link. No stylesheet requests or extra sandbox permissions.
- `apps/core`: `transport → rpc → engine (turns) → harness / providers / tools → domain (one repository per
  aggregate over SQLite)`; `nodes/` routes capability calls to the desktop; `channels/` adapts the messaging apps
  (Telegram, WhatsApp, Discord, Slack, iMessage, email, Signal, Matrix, Mattermost) and enters through `threads.send`.
- `apps/*` never import each other; `packages/*` never import `apps/*`.

## 4. State and persistence

`~/.apx/v2/apx.db` (SQLite, WAL): projects, agents, threads (incl. a2a sub-threads), messages (what the UI shows),
`model_log` (what the model saw — never rendered, tagged by run), runs (the durable queue: input, origin, reply destination, depth,
deadline, A2A-shaped states, usage), steps (one per tool call, written before it runs), surfaces (+ share tokens),
idempotency, and the rest of the product's records (persons and their addresses, channel inbox/outbox, tasks, routines,
memories, notifications, devices, extensions, nudges, suggestions, media); `db/migrations.ts` is the list, `db/schema.ts`
the generated types. Channel photos/documents and voice notes enter through `threads.send` as persisted uploads; image references reach
vision models and the panel shows attachments from both sides. Owner uploads are copied into an ignored
`.apx-attachments/upload-*` folder inside the turn work directory so file tools can inspect PDFs and other
documents. Contact uploads stay in their sealed chat and never get a shared work-folder copy. Voice uploads stay
playable beside their words, even if transcription fails; `media.transcribe` can reuse the uploaded file by id.
Agents share local project files through `send_file` → `media.attach`: a snapshot, at most 20 MB, scoped to
their running owner's chat and work folder. Images appear inline; video/audio files play and download in the
panel. Attachments survive changes to the source file and a chat reload.
Composer uploads accept files and videos up to 20 MB, images up to 5 MB and audio up to 10 MB.
HTTP and WebSocket payload bounds include base64 expansion; remote uploads have a two-minute client deadline.
Agents open long reports, plans and reusable text documents with `open_document` after writing the file.
It extends `media.attach` with bounded UTF-8 validation (400,000 bytes, `.md`/`.markdown`/`.txt`), uses the same
owner-run/work-folder boundary, and persists a file part with document presentation metadata. The web/desktop
panel renders the saved snapshot as Markdown (including `.txt`), source or download, labeled Document rather
than App. Only an explicit presentation in the visible chat opens it; file edits never open it automatically.
File tools persist bounded unified patches in the existing changes part (64,000 characters per file,
200,000 per turn); repeated edits compare the first original with the final text. The Changes panel lists
files once, with independent folding diffs and scopes for the last edit turn, all recorded turns (latest edit
per path), or the current Git folder. Owner-only `files.diff` reads a saved patch by chat/message/part, even
after source deletion. Older records without patches show labeled current content only when their recorded
folder still matches the chat's work folder; escapes, Git metadata, binaries and special files are refused.
Files live in three places ([D-054](DECISIONS.md#d-054), [D-055](DECISIONS.md#d-055)): the project's own folder (the
repository and its `.apc/`, where the native agent works); APX's side of each project in its home, `projects/<id>` (or
the project's folder itself when APX made it, `projects/<name>`), where outside agents work outside code threads and
the native agent falls back while the folder is off this machine; and each chat's temp folder (`apx-scratch-…` in the
system's temp folder), for downloads and tries, kept with `files.keep`. `work/` is the folder of chats outside a
project. Widgets are not files: their HTML and where they show live in `surfaces`, scoped to one project or global.
Secrets are referenced as `secret://name`: on macOS the values live in the login Keychain, elsewhere (and with
`APX_SECRETS=file`, as in tests) in `~/.apx/v2/secrets.json` (0600). `~/.apx/v2/home-id` is the
install id. Browser sessions live in Electron partitions on the
desktop (`persist:apx-shared`, `persist:apx-agent-<id>`, in-memory `apx-incog-*`), never in the core.

Asana is a native REST integration (`integrations/asana.ts`), configured with a validated personal access token
referenced as `secret://asana-token`. The existing integration form and global-integration project switches apply,
without creating an MCP server. `asana.read` and human-only `asana.write` enter through the router; conditional
agent tools wrap their output as untrusted and request owner authorization for writes. Project switches control
availability, not Asana object-level permissions.

## 4b. The agent loop

`threads.send` (the only door) stores the message and a `submitted` run with its input → `engine/engine.ts` runs
a thread's queue one run at a time → `engine/turn.ts` builds the context (`engine/context.ts`: byte-stable system
prompt, projected history, per-turn input with the origin envelope), logs the input, and hands the turn to the
agent's harness (`harness/`: native over `providers/`, Claude Code, Codex, ACP agents, Aider and headless Antigravity) → every tool call goes through one
executor (`engine/executor.ts`: check the arguments against the tool's zod schema → `tools/policy.ts` `authorize`
→ the folders it may use, from `engine/permissions.ts`, the one service every permission question goes through
→ wait for the owner when it says so → `steps` row → run with a deadline → full output kept, a capped copy to the
model) → the answer's parts stream as `message.part` events → the run ends completed / failed / canceled with a
notice when there is no text. Tools that touch core state call protocol methods through the router as the agent
(`ctx.call`), so owner-only methods refuse them.

- **One-shot CLIs** (`harness/oneshot.ts`): Aider and headless Antigravity use `threads.send` in their own code
  sessions, not ACP. Each approved invocation gets a private request file and a credential-filtered environment;
  `agy` receives only the file-reading instruction in argv. A single external step represents the unmediated CLI,
  never per-tool control. The engine persists outcomes; the process has cancellation and an absolute ten-minute
  deadline. CLI discovery does not claim authentication, and GUI-only Antigravity is not runnable.
- **Adding a harness** touches every place that names one, or it shows half-done: its id in `HarnessId`
  (`packages/protocol/src/domain.ts`); its entry in the registry (`harness/index.ts`) with its status for the setup
  screen; its kind and login copy in `apps/web/src/config/ExternalSection.tsx` (both languages in `i18n`); its
  **official mark** in `packages/ui` (`acp-marks.ts` for a coding agent, `provider-marks.ts` for a model API, from the
  maker's own site or registry, never redrawn) plus its id in `engineBrand`, or the panel shows the neutral bot; and
  the engines page in `apps/docs` (English and Spanish).
- **Memory and long threads** (D-013): notes live in `memories` (FTS5) and reach a turn in its `[memory]` block
  (`engine/recall.ts`); `.apc/memory.md` joins `AGENTS.md` in the system prompt. After each run `engine/upkeep.ts`
  titles new chats and, when the history gets long, summarizes older turns into a new epoch that
  `projectHistory` puts before the newest turns. `engine/chat-recall.ts` retrieves literal owner messages from the
  agent's own eligible chats in the same project, including old current-chat turns outside the projected context.
  Visible sources are excluded before search limits. `engine/memory-episodes.ts` checkpoints historical indexing
  independently of capture; bounded overlapping embeddings retain individual topics in long owner messages.
  `engine/memory-maintenance.ts` drains durable `memory_work` jobs:
  grounded private capture (up to three owner turns, literal sources and a separate semantic review) and idle AutoDream
  (`engine/memory-dream.ts`: bounded source evidence, reviewed retirement, unambiguous local dates and a forget-share guard), through
  the same router as tools. `engine/memory-procedure.ts` writes procedure history only after owner confirmation or a complete file readback;
  `domain/memory-verification.ts` rechecks that evidence at the canonical write. Successful and failed attempts stay separate, and
  `engine/recall.ts` adds an index of the agent's own notes to owner turns. Notes have revisions,
  source evidence and reversible history; exclusions suppress forgotten sources in recall and retries. Model-log
  snapshots record dependencies so edits invalidate old context and derived replies. See D-111–D-114.
- **Waiting for the owner** (`engine/inputs.ts`): confirmations and `ask_owner` questions are `pending_inputs`
  rows, answered with `runs.respond` (owner only). The run's clock stops while it waits; an answer after a restart
  wakes the agent with a new run.
- **Conversation retrieval** (`tools/chats.ts`): global specialists can search the owner's global chats;
  project agents keep their project/participation scope. External-client chats remain private to their client.
  Other agents' channel chats, rooms and subthreads are not shared with global specialists. Search applies
  visibility before ranking limits, requires every named agent as a participant, and includes archived history.
  Participants can read delegated chats by session name as well as thread id or title.
  A named agent can retrieve unavailable context through the existing `delegate` path before asking the owner.
- **Contact requests** (`tools/contact.ts`): `pass_request` checks open requests submitted in the same contact's
  chat before writing. When candidates exist, the agent compares their original submissions with the conversation
  and updates the matching task by id, or explicitly creates a new, unrelated request. Owner edits and task notes
  never enter this lookup. Updates preserve the task's conversation and prior details; only new requests count
  against the five-waiting-requests limit. Provenance comes from existing task creation events and tool steps.
- **Task assignment** (`rpc/tasks.ts`, `engine/task-work.ts`): subtasks created by agents need a responsible agent
  and a non-empty description; missing fields reject the operation before a record is written. Agent calls cannot
  clear either field. An answering delegate proposes work to its caller instead of creating an unassigned handoff.
  For the owner's drafts, an assigned task waits without automatic work until
  its description contains non-whitespace text. Completing the description starts work if it never began;
  later edits do not restart it. Unassigned ideas remain valid. Hourly pickup skips incomplete descriptions.
- **Cross-project tasks** (`domain/tasks.ts`, `rpc/tasks.ts`, `tools/tasks.ts`): outside any project, the super-agent's
  `task_create` uses the assignee's project by default, or an explicit project id. Ordinary agents and a super-agent
  inside a project keep their thread's scope. To have a destination project's orchestrator prepare the task instead,
  use `delegate` with that agent and project, asking for an unassigned task and its id; the caller then uses
  `task_update` to assign it. Delegates still start no task work (D-079); both flows use the existing router methods.
  `agents.list` adds directory metadata without changing the stored `orchestrator` flag: global/project scope, project
  name (null if unavailable), resolved project orchestrator (null if none), and whether this entry is that orchestrator.
  Discovery and imported-chat routing share `domain/agent-directory.ts`: explicit marks take precedence, then a root's
  role, then a sole root; explicit opt-outs are respected. The selection source is returned so inferred heads are never
  presented as explicit configuration. `list_agents` and the terminal's MCP directory display these distinctions.
- **Task conversations** (`rpc/tasks.ts`, `engine/office.ts`): `tasks.comment` persists a comment and admits named
  agents in the task's own chat. Replies can mention teammates, with a bounded chain and the same project scope
  for names and exact ids. `@owner`, `@human` or the owner's name requests attention without an agent turn;
  `domain/task-attention.ts` notices the transition to waiting once, and the owner's reply clears it.
  The panel offers the project team and the super-agent first, keeps the comment footer separate from the
  scrollable description and conversation, and hides the footer in History while retaining its draft.
- **a2a** (`engine/delegation.ts`): `delegate` opens a named session (an a2a sub-thread) or continues one by name;
  the child works with no more than its callers (`inherit`); if the caller stopped waiting, the result comes back as
  an `a2a_result` run. A turn resumed by an owner answer after restart retains its caller and depth, so its final
  report still returns automatically. Only the final report enters the caller's context; the child's tool log and
  progress stay in its own thread. Limits live in `engine/limits.ts` (the owner changes the unattended ones in Config ›
  Agents); `engine/breaker.ts` pauses chains that run without the owner. A child stops after its idle window or its
  cap; one a limit cut short goes on once in its session (`continueCut`) and the owner hears it (`limitNotice`: chat
  notice, tray, the chat's channel), see [D-105](DECISIONS.md#d-105). `stop_session` lets the caller stop one.
  Limit notices show the session's current state. The owner can continue a stopped session through `threads.send`
  with its latest `continue_run`: one turn in the same workspace, reporting to the same caller and waiting for a
  delegation slot when necessary. A stale click cannot interrupt or duplicate newer work.
- **Chat processes panel** (`apps/web/src/panel/ProcessesPanel.tsx`): `threads.list { root_thread }` retrieves
  every delegated descendant without the global list cap. A2A cards open a read-only transcript beside the parent;
  maximize opens the child as the main chat. Terminal command history and recorded edits remain available without
  a project folder; opening an owner's shell and browsing files still need a folder.
- **Terminal jobs** (`engine/jobs.ts`): the `shell` tool runs commands in the project's folder; background ones
  are `jobs` rows with an output file, and their end wakes the agent.
- **Steer**: `threads.send` with `mode: "steer"` puts the owner's text into the running turn at its next step.

On start, `engine/recovery.ts` closes runs a crash cut (effect UNKNOWN for started tools), expired inputs and cut
jobs are closed, and queued runs are picked up.

## 5. Auth and trust

- Loopback bind needs no token; any other bind **requires** `APX_TOKEN` (enforced at startup).
- `/rpc/*` checks `Authorization: Bearer` when a token is set. Over WS the token (`?token=`), or a paired device's own, is checked during upgrade and before every incoming or outgoing frame. Revoked sockets cannot call methods, receive events or lend node capabilities.
- Trust boundaries to remember: web page content (embedded browser), channel messages, outside apps' agents,
  tool output → all untrusted data. The owner's own agents speak for the owner (DECISIONS.md#d-071).

## 6. External integrations

- LLM: `providers/` speaks OpenAI-compatible chat, Anthropic Messages and the ChatGPT plan's responses API; keys are `secret://` references.
- APX v1: read-only import (`import/v1.ts`, `import/v1-*.ts`) of projects, agents, chats, channels and, when asked, keys and skills; never writes to v1.
- Electron + in-process CDP for the embedded browser; macOS Keychain + `sqlite3` for cookie import.
Harnesses: native (our loop over `providers/`), Claude Code (Agent SDK), Codex (Codex SDK) and ACP agents — D-007, D-008.

## 7. Build / test / run lifecycle

No build for core/terminal/protocol (Node runs `.ts`). Web builds with Vite; `packages/ui` builds with its own
esbuild script (consumed as `dist/`). Checks: `pnpm preflight`. Details: [`TESTING.md`](TESTING.md).

## 8. Files worth knowing

1. `packages/protocol/src/methods.ts` — what the core can do.
2. `packages/protocol/src/frames.ts` — wire shapes, error codes, protocol version.
3. `packages/protocol/src/client.ts` — how every client calls the core.
4. `apps/core/src/rpc/router.ts` — the single dispatcher.
5. `apps/core/src/server.ts` — composition root.
6. `apps/core/src/config.ts` — env → config, safe-bind rule.
7. `scripts/check-private-terms.ts` — the public-safe gate.
8. `apps/desktop/src/main/browser/{host,cdp}.ts` — tabs, profiles, control, CDP actions, credential guard.
9. `apps/terminal/src/mcp.ts` — browser tools for external agents (Claude Code, Codex).
10. `plan/01-arquitectura-v2.md` — where this is going.

## 9. Fragile seams

The optional computer (`apps/core/src/environments`) is one Linux VM shared by the agents, inert at core startup and off
for every agent: using it is a per-agent grant (`apx:computer`) the owner gives in the agent's settings or on the card
the agent's `computer` tool raises ([D-151](DECISIONS.md#d-151)). Each agent works as its own locked Linux user on its own
screen (user `apx-a<n>`, display `:100+n`, a private VNC socket and X cookie, its own cgroup slice, and loopback
listeners no other agent can connect to); the owner has no screen of their own and
takes control of an agent's when needed ([D-152](DECISIONS.md#d-152)). The Computer panel shows the chat agent's screen;
the Computers view (`apps/web/src/computers`) shows every screen in use as a wall. The core keeps the ledger of which working run holds which screen (`screens.ts`,
in settings, swept of finished runs), caps the screens up at once by the VM's memory and refuses a turn when none is
free. The owner's `environments.enable`, or an allowed agent's `environments.start` from its own run, puts a chat on the
computer and boots the VM if needed: verified private Lima runtime if missing → pinned Debian guest → root-owned
firewall for the screen users → desktop helpers, templated screen units and APX appearance. Memory, CPUs and disk come
from `environments.configure`, held to the host and applied on the next start with `limactl edit`; a start is refused
while free host memory is below the VM's memory plus 2 GiB. `environments.release` takes a chat back to the Mac;
`environments.stop` (owner) shuts the VM down for everyone, cancelling the runs that hold screens. A core watchdog
shuts it down below 1 GiB of free host memory, or once nothing holds or uses a screen for the owner's idle minutes,
keeps its disk and tells the owner. The regular installer includes the controller and assets without downloading or
booting Linux. The isolated lab (`prototypes/vm-desktop`, `pnpm vm:prototype`) uses the same lifecycle with its own Lima
and core homes through `CoreOptions.computer`. A chat on the computer offers only its guest shell, guest browser and
`computer` tools; external harnesses, routines and MCP tools are refused, and it never falls back to host execution. A
private SSH/CDP pipe per screen reuses the core browser implementation for that screen's visible Chromium. Guest web
access goes through a host proxy over a private SSH reverse forward that allows public HTTP(S) only, with the screen users'
direct egress dropped by nftables ([`prototypes/vm-desktop/VERIFICATION.md`](../prototypes/vm-desktop/VERIFICATION.md)).
Control is a lease per screen: the owner taking an agent's screen cancels the run holding it, and agent work there is
refused until it is handed back. `environments.*` uses the normal registry and router; `/vm-display` carries only RFB
bytes of one screen after a human requests a short-lived single-use ticket for it. Light/dark desktops, terminals and the
bundled wallpaper follow APX. The backend supports macOS Apple Silicon only. Runtime state and VM disks live outside the
checkout.

- **Node type stripping** only works for erasable syntax and for files **not** under `node_modules` — workspace
  packages resolve through symlinks to their real path, which is why `@apx/protocol` can ship `.ts`.
- **`packages/ui` ↔ Claude Design**: `dist/` is what design-sync reads; formatting or API changes need a re-sync.
- **Protocol version**: a client with another `PROTOCOL_VERSION` is closed at `hello`. Bump only with a migration
  plan for every client.

- **CDP timing**: attach only after the first load; screenshots are bounded with a `capturePage` fallback;
  navigation waits for `dom-ready`. See `plan/01-arquitectura-v2.md` §9.

## 10. Enforced vs convention

See [`GUARDRAILS_PROFILE.md`](GUARDRAILS_PROFILE.md#gates).
