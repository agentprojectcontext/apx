# Human model — APX v2

For an owner who will not read every file. Also serves as the system map; update it when a process, module or
boundary changes.

## 1. Processes that run

| Process | Entry | Role | Lifetime |
|---|---|---|---|
| **core** | `apps/core/src/main.ts` (`pnpm dev`) | The only owner of state. Serves the protocol on `127.0.0.1:7440`. | Long-running (service later, F1/F3). |
| **terminal** | `apps/terminal/src/main.ts` (`apx2`) | One command → protocol call(s) → exit. | Per command. |
| **web** | `apps/web` (Vite on `:7441` in dev) | Panel in a browser. Talks to core through the Vite proxy. | Per tab. |
| **desktop** | `apps/desktop` (`pnpm --filter @apx/desktop dev`) | Panel on the left, embedded browser on the right; connects to core as a **node** offering `browser`. | While the app is open. |
| **mobile** *(F7)* | `apps/mobile` (Expo) | Operator + node (camera, notify). | App lifecycle. |

## 2. How a call flows

```
client (terminal | web | desktop | agent tool)
   │  HTTP POST /rpc/<method>   or   WS: hello → welcome, then req/res, event
   ▼
apps/core/src/transport/{http,ws}.ts        adapters only: parse, auth header, hand to router
   ▼
apps/core/src/rpc/router.ts                  known method? idempotency key if effect? params valid (zod)?
   ▼
apps/core/src/rpc/<domain>.ts handler        does the work (later: calls domain/, db/, nodes/)
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
- `packages/surfaces` ← web/desktop/mobile hosts and core store (F3).
- `apps/core`: `transport → rpc → engine (turns) → harness / providers / tools → domain (one repository per
  aggregate over SQLite)`; `nodes/` routes capability calls to the desktop. Planned: `channels/`, `office/`,
  `memory/` (see `plan/03-relevo-y-plan-motor.md` §6).
- `apps/*` never import each other; `packages/*` never import `apps/*`.

## 4. State and persistence

`~/.apx2/apx.db` (SQLite, WAL): projects, agents, threads (incl. a2a sub-threads), messages (what the UI shows),
`model_log` (what the model saw — never rendered, tagged by run), runs (the durable queue: input, origin, depth,
deadline, A2A-shaped states, usage), steps (one per tool call, written before it runs), surfaces (+ share tokens),
idempotency. `~/.apx2/secrets.json` (0600) holds secrets referenced as `secret://name`. `~/.apx2/home-id` is the
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
- **a2a** (`engine/delegation.ts`): `delegate` opens a named session (an a2a sub-thread) or continues one by name;
  the child works with no more than its callers (`inherit`); if the caller stopped waiting, the result comes back as
  an `a2a_result` run. Limits live in `engine/limits.ts`; `engine/breaker.ts` pauses chains that run without the
  owner.
- **Terminal jobs** (`engine/jobs.ts`): the `shell` tool runs commands in the project's folder; background ones
  are `jobs` rows with an output file, and their end wakes the agent.
- **Steer**: `threads.send` with `mode: "steer"` puts the owner's text into the running turn at its next step.

On start, `engine/recovery.ts` closes runs a crash cut (effect UNKNOWN for started tools), expired inputs and cut
jobs are closed, and queued runs are picked up.

## 5. Auth and trust

- Loopback bind needs no token; any other bind **requires** `APX_TOKEN` (enforced at startup).
- `/rpc/*` checks `Authorization: Bearer` when a token is set. WS auth + device pairing arrive with nodes.
- Trust boundaries to remember: web page content (embedded browser), channel messages, other agents' text,
  tool output → all untrusted data.

## 6. External integrations

- LLM: any OpenAI-compatible endpoint; default Gemini with the key read by reference from APX v1's config.
- APX v1 daemon: read-only import of projects/agents (`import/v1.ts`, loopback only).
- Electron + in-process CDP for the embedded browser; macOS Keychain + `sqlite3` for cookie import.
Harnesses: native (our loop over `providers/`), Claude Code (Agent SDK) and Codex (Codex SDK) — D-007, D-008. Planned: ACP, Telegram and WhatsApp.

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
