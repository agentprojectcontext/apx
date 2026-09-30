# Human model — APX v2

For an owner who will not read every file. Also serves as the system map; update it when a process, module or
boundary changes.

## 1. Processes that run

| Process | Entry | Role | Lifetime |
|---|---|---|---|
| **core** | `apps/core/src/main.ts` (`pnpm dev`) | The only owner of state. Serves the protocol on `127.0.0.1:7440`. | Long-running (service later, F1/F3). |
| **terminal** | `apps/terminal/src/main.ts` (`apx2`) | One command → protocol call(s) → exit. | Per command. |
| **web** | `apps/web` (Vite on `:7441` in dev) | Panel in a browser. Talks to core through the Vite proxy. | Per tab. |
| **desktop** *(F1)* | `apps/desktop` (Electron) | Loads web as its renderer; connects to core as a **node** offering `browser`. | While the app is open. |
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

The registry is `packages/protocol/src/methods.ts`. Adding a method = registry entry + handler; every client
gets the types. There is no other way into a handler.

## 3. Modules and dependency direction

- `packages/protocol` ← used by everything. Isomorphic: no Node-only imports.
- `packages/ui` ← web (and desktop through web). React + Base UI + CSS tokens.
- `packages/surfaces` ← web/desktop/mobile hosts and core store (F3).
- `apps/core`: `transport → rpc → domain`; `domain` is pure (planned: `agent/`, `tools/`, `nodes/`, `surfaces/`,
  `db/`, `channels/`, see `plan/01-arquitectura-v2.md` §2.1).
- `apps/*` never import each other; `packages/*` never import `apps/*`.

## 4. State and persistence

Today: only `~/.apx2/home-id` (stable install id). SQLite (`node:sqlite`, WAL) lands with F2; human-edited
files (`AGENTS.md`, `.apc/**`, memories) stay as files with the DB as index.

## 5. Auth and trust

- Loopback bind needs no token; any other bind **requires** `APX_TOKEN` (enforced at startup).
- `/rpc/*` checks `Authorization: Bearer` when a token is set. WS auth + device pairing arrive with nodes.
- Trust boundaries to remember: web page content (embedded browser), channel messages, other agents' text,
  tool output → all untrusted data.

## 6. External integrations

None yet. Planned: Claude Agent SDK / `codex app-server` / ACP harnesses (F2), Electron + CDP (F1), Telegram and
WhatsApp (F5).

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
8. `plan/01-arquitectura-v2.md` — where this is going.

## 9. Fragile seams

- **Node type stripping** only works for erasable syntax and for files **not** under `node_modules` — workspace
  packages resolve through symlinks to their real path, which is why `@apx/protocol` can ship `.ts`.
- **`packages/ui` ↔ Claude Design**: `dist/` is what design-sync reads; formatting or API changes need a re-sync.
- **Protocol version**: a client with another `PROTOCOL_VERSION` is closed at `hello`. Bump only with a migration
  plan for every client.

## 10. Enforced vs convention

See [`GUARDRAILS_PROFILE.md`](GUARDRAILS_PROFILE.md#gates).
