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

Node capabilities (`browser.*`): the handler is `apps/core/src/rpc/browser.ts`, which asks
`apps/core/src/nodes/broker.ts` to send the same method + params to the connected desktop over its socket; the
desktop executes it in `apps/desktop/src/main/browser/host.ts` (re-validating params and tab control) and the
core validates the answer against the registry. No desktop connected → `unavailable` immediately.

The registry is `packages/protocol/src/methods.ts`. Adding a method = registry entry + handler; every client
gets the types. There is no other way into a handler.

## 3. Modules and dependency direction

- `packages/protocol` ← used by everything. Isomorphic: no Node-only imports.
- `packages/ui` ← web (and desktop through web). React + Base UI + CSS tokens.
- `packages/surfaces` ← placement types shared by the surface hosts (the host itself is `apps/web/src/surfaces`).
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

## 4b. The agent loop

`threads.send` (the only door) stores the message and a `submitted` run with its input → `engine/engine.ts` runs
a thread's queue one run at a time → `engine/turn.ts` builds the context (`engine/context.ts`: byte-stable system
prompt, projected history, per-turn input with the origin envelope), logs the input, and hands the turn to the
agent's harness (`harness/`: native over `providers/`, Claude Code, Codex) → every tool call goes through one
executor (`engine/executor.ts`: check the arguments against the tool's zod schema → `tools/policy.ts` `authorize`
→ wait for the owner when it says so → `steps` row → run with a deadline → full output kept, a capped copy to the
model) → the answer's parts stream as `message.part` events → the run ends completed / failed / canceled with a
notice when there is no text. Tools that touch core state call protocol methods through the router as the agent
(`ctx.call`), so owner-only methods refuse them.

- **Memory and long threads** (D-013): notes live in `memories` (FTS5) and reach a turn in its `[memory]` block
  (`engine/recall.ts`); `.apc/memory.md` joins `AGENTS.md` in the system prompt. After each run `engine/upkeep.ts`
  titles new chats and, when the history gets long, summarizes older turns into a new epoch that
  `projectHistory` puts before the newest turns.
- **Waiting for the owner** (`engine/inputs.ts`): confirmations and `ask_owner` questions are `pending_inputs`
  rows, answered with `runs.respond` (owner only). The run's clock stops while it waits; an answer after a restart
  wakes the agent with a new run.
- **Conversation retrieval** (`tools/chats.ts`): global specialists can search the owner's global chats;
  project agents keep their project/participation scope. External-client chats remain private to their client.
  Other agents' channel chats, rooms and subthreads are not shared with global specialists. Search applies
  visibility before ranking limits, requires every named agent as a participant, and includes archived history.
  Participants can read delegated chats by session name as well as thread id or title.
  A named agent can retrieve unavailable context through the existing `delegate` path before asking the owner.
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
  Agents); `engine/breaker.ts` pauses chains that run without the owner.
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
- `/rpc/*` checks `Authorization: Bearer` when a token is set. Over WS the token (`?token=`), or a paired device's own, is checked when the socket upgrades.
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

- **Node type stripping** only works for erasable syntax and for files **not** under `node_modules` — workspace
  packages resolve through symlinks to their real path, which is why `@apx/protocol` can ship `.ts`.
- **`packages/ui` ↔ Claude Design**: `dist/` is what design-sync reads; formatting or API changes need a re-sync.
- **Protocol version**: a client with another `PROTOCOL_VERSION` is closed at `hello`. Bump only with a migration
  plan for every client.

- **CDP timing**: attach only after the first load; screenshots are bounded with a `capturePage` fallback;
  navigation waits for `dom-ready`. See `plan/01-arquitectura-v2.md` §9.

## 10. Enforced vs convention

See [`GUARDRAILS_PROFILE.md`](GUARDRAILS_PROFILE.md#gates).
