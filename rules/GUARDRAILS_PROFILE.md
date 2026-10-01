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
| Persistence | none yet; SQLite via `node:sqlite` planned (F2) |
| Auth | loopback-only by default; `APX_TOKEN` required off-loopback; device pairing planned (F7) |
| Agentic surfaces | harnesses + tools (F2), embedded browser node (F1), surfaces/widgets (F3) |
| Tests | `node:test` (core, protocol, terminal) |
| Lint / format | Biome 2 |
| CI / deploy | none yet (planned: GitHub Actions running `pnpm preflight`) |

<a id="gates"></a>
## Gates (mechanically enforced)

| Gate | Command | Enforces |
|---|---|---|
| Typecheck | `pnpm typecheck` | Contract types across all clients; erasable TS only (rule 5) |
| Lint | `pnpm lint` | Biome recommended + no `console` outside CLI/scripts, `import type`, no `!` assertions |
| Tests | `pnpm test` | Router: unknown method / bad params / idempotency; safe bind (rule 7); HTTP ≡ WS |
| Private data | `pnpm check:private` | Rule 17 — local denylist (never committed) + public shapes (phone numbers, `/Users`/`/Volumes` paths) |
| All | `pnpm preflight` | The four above; run before every push |

Convention-only today (review must catch them): dependency direction inside core (rule 4), no a2a side path
(rule 2), untrusted content handling (rule 10), secrets by reference (rule 11), no tests reading source (rule 13).
**Planned gate:** a Biome `noRestrictedImports` / dependency-cruiser rule for rule 4 once `domain/` exists, and a
CI workflow running `preflight`.

No lint ratchets outstanding: every package, `packages/ui` included, gets the full rule set (the former `packages/ui`
override is closed — see [`DECISIONS.md#d-005`](DECISIONS.md#d-005)).

## High-risk changes (always independent review + runtime proof)

- Anything in `packages/protocol/src/frames.ts` or a method's params/result (breaks every client).
- `apps/core/src/config.ts` bind/token logic and any auth code.
- The embedded browser: profiles, cookie import, CDP control, take-control handoff.
- Tools with side effects (send, pay, shell, filesystem writes) and anything that lets model output trigger them.
- Harness integrations touching the user's Claude/Codex logins (never read or copy their tokens).
- Anything that could make v2 read or write v1's home (`~/.apx`).
