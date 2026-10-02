# Guardrails profile — APX v2

Mode: **personal** (owner-operated; stricter anyway around secrets, the embedded browser and anything that sends
messages or spends money on the owner's behalf).

| Aspect | Value |
|---|---|
| Runtime | Node ≥ 24.11 (`.nvmrc`), ESM, TypeScript run natively (type stripping) |
| Language | TypeScript strict, `erasableSyntaxOnly`, `noUncheckedIndexedAccess`, TS 7 compiler |
| Package manager | pnpm 11 workspaces (`apps/*`, `packages/*`), one lockfile |
| Surfaces | core (daemon), terminal (CLI), web (React 19 + Vite 8), desktop (Electron, F1), mobile (Expo, F7) |
| Contract | `packages/protocol` (zod) — HTTP `/rpc/<method>` + WS frames |
| Persistence | SQLite (`node:sqlite`, WAL) in `~/.apx2/apx.db`; append-only migrations in `apps/core/src/db/migrations.ts` |
| Auth | loopback by default; browser origins limited to the panel's own (`transport/guard.ts`); `APX_TOKEN` required off-loopback (HTTP header or WS `?token=`); device pairing planned |
| Agentic surfaces | own tool loop (OpenAI-compatible, Gemini by default), browser tools via the desktop node, widgets (sandboxed iframes), delegation between agents (a2a sub-threads) |
| Tests | `node:test` (core, protocol, terminal) |
| Lint / format | Biome 2 |
| CI / deploy | none yet (planned: GitHub Actions running `pnpm preflight`) |

<a id="gates"></a>
## Gates (mechanically enforced)

| Gate | Command | Enforces |
|---|---|---|
| Typecheck | `pnpm typecheck` | Contract types across all clients; erasable TS only (rule 5) |
| Lint | `pnpm lint` | Biome recommended + no `console` outside CLI/scripts, `import type`, no `!` assertions; dependency direction (rule 4: `domain` never imports `transport`/`rpc`/`channels`, `rpc` never imports `transport`, `packages/*` never import `apps/*`) |
| Tests | `pnpm test` | Router, idempotency, safe bind, HTTP ≡ WS, origin/token gate, static path safety, agent runs (streaming, cancel, interrupted turns), delegation (sync + async wake-up), artifacts isolation, node routing, cookie mapping/decryption |
| Private data | `pnpm check:private` | Rule 17 — local denylist (never committed) + public shapes (phone numbers, `/Users`/`/Volumes` paths) |
| All | `pnpm preflight` | The four above; run before every push |

Convention-only today (review must catch them): no a2a side path (rule 2), untrusted content handling (rule 10),
secrets by reference (rule 11), no tests reading source (rule 13).
**Planned gate:** a CI workflow running `preflight`.

No lint ratchets outstanding: every package, `packages/ui` included, gets the full rule set (the former `packages/ui`
override is closed — see [`DECISIONS.md#d-005`](DECISIONS.md#d-005)).

## High-risk changes (always independent review + runtime proof)

- Anything in `packages/protocol/src/frames.ts` or a method's params/result (breaks every client).
- `apps/core/src/config.ts` bind/token logic and any auth code.
- The embedded browser: profiles, cookie import, CDP control, take-control handoff.
- Tools with side effects (send, pay, shell, filesystem writes) and anything that lets model output trigger them.
- Harness integrations touching the user's Claude/Codex logins (never read or copy their tokens).
- Anything that could make v2 read or write v1's home (`~/.apx`).
