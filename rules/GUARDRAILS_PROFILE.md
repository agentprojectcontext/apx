# Guardrails profile — APX v2

Mode: **personal** (owner-operated; stricter anyway around secrets, the embedded browser and anything that sends
messages or spends money on the owner's behalf).

| Aspect | Value |
|---|---|
| Runtime | Node ≥ 24.11 (`.nvmrc`), ESM, TypeScript run natively (type stripping) |
| Language | TypeScript strict, `erasableSyntaxOnly`, `noUncheckedIndexedAccess`, TS 7 compiler |
| Package manager | pnpm 11 workspaces (`apps/*`, `packages/*`), one lockfile |
| Surfaces | core (daemon), terminal (CLI), web (React 19 + Vite 8), desktop (Electron), mobile (Expo, Android), docs (Astro) |
| Contract | `packages/protocol` (zod) — HTTP `/rpc/<method>` + WS frames; platforms' webhooks reach a listener of their own outside it (`apps/core/src/transport/hooks.ts`, [D-139](DECISIONS.md#d-139)) |
| Persistence | SQLite (`node:sqlite`, WAL) in `~/.apx/v2/apx.db`; append-only migrations in `apps/core/src/db/migrations.ts` |
| Auth | loopback by default; browser origins limited to the panel's own (`transport/guard.ts`); `APX_TOKEN` required off-loopback (HTTP header or WS `?token=`); a paired device (`apx pair`, `devices.*`) carries its own token, which passes like the core's; the webhook listener (`transport/hooks.ts`) takes no token: each channel adapter's `webhook()` verifies its platform's signature (Teams' Bot Framework JWT, LINE's HMAC) over the bytes as they came |
| Agentic surfaces | harnesses: our own tool loop over providers (OpenAI-compatible, Anthropic Messages, ChatGPT plan), Claude Code, Codex and ACP agents; browser and computer tools via the desktop node; widgets (sandboxed iframes); delegation between agents (a2a sub-threads) |
| Tests | `node:test` (packages, `scripts/`, mobile logic), Jest Expo + React Native Testing Library (mounted mobile hooks/screens), Playwright (`e2e/`, web and desktop) |
| Lint / format | Biome 2 |
| CI / deploy | GitHub Actions: `verify.yml` (preflight, e2e, desktop e2e, perf), `release.yml` (`v2.*` tags build installers, bundles, APK), `site.yml` (docs site) |

<a id="gates"></a>
## Gates (mechanically enforced)

| Gate | Command | Enforces |
|---|---|---|
| Typecheck | `pnpm typecheck` | Contract types across all clients; erasable TS only (rule 5) |
| Lint | `pnpm lint` | Biome recommended + no `console` outside CLI/scripts, `import type`, no `!` assertions; dependency direction (rule 4: `domain` never imports `transport`/`rpc`/`channels`, `rpc` never imports `transport`, `packages/*` never import `apps/*`); the panel's first screen never imports a late-loaded module (rule 27) |
| Tests | `pnpm test` | Router, idempotency, safe bind, HTTP ≡ WS, origin/token gate, static path safety, agent runs (streaming, cancel, interrupted turns), delegation (sync + async wake-up), artifacts isolation, node routing, cookie mapping/decryption; prompt budget (rule 23: a default turn's system prompt and tools within [`PROMPT_SIZE.md`](PROMPT_SIZE.md)) |
| Test quality | `pnpm check:tests` | AST checks for disabled/exclusive/empty tests, literal-only assertions and unobserved Node/Jest promise assertions; portability (rule 26: real-time windows, counted waits, raw temp folders and removal, path prefixes, `process.exit`), with an allowlist that only shrinks; does not establish behavioral coverage (rule 24) |
| Execution coverage | `pnpm test:coverage:all` | Unit, mounted mobile, browser and desktop suites must pass; repository build mappings must be present, including intermediate library maps. Reports include unexecuted functions; only `pnpm test:coverage:all:strict` also fails on remaining execution gaps |
| Private data | `pnpm check:private` | Rule 17 — local denylist (never committed) + public shapes (phone numbers, `/Users`/`/Volumes` paths); `pnpm check:commits` runs it over commit messages and authors |
| Schema | `pnpm check:schema` | `db/schema.ts` (the typed queries' tables) matches the migrations |
| All | `pnpm preflight` | Private data, schema, lint, typecheck and tests; run before every push. `pnpm verify` adds e2e and perf |

Convention-only today (review must catch them): no a2a side path (rule 2), untrusted content handling (rule 10),
secrets by reference (rule 11), no tests reading source (rule 13), meaningful regression protection and affected
consumer verification for fixes (rule 24; [contract](TESTING.md#fix-regression-contract)).
CI (`verify.yml`) runs the gates on every push to `release/v2` and every pull request.

No lint ratchets outstanding: every package, `packages/ui` included, gets the full rule set (the former `packages/ui`
override is closed — see [`DECISIONS.md#d-005`](DECISIONS.md#d-005)).

## High-risk changes (always independent review + runtime proof)

- Anything in `packages/protocol/src/frames.ts` or a method's params/result (breaks every client).
- `apps/core/src/config.ts` bind/token logic and any auth code.
- The webhook listener (`apps/core/src/transport/hooks.ts`) and each channel adapter's `webhook()` verification: they
  take requests from the internet once a public address is on.
- The embedded browser: profiles, cookie import, CDP control, take-control handoff.
- Tools with side effects (send, pay, shell, filesystem writes) and anything that lets model output trigger them.
- A tool that acts as the owner (`callAsOwner`): where it sits in `tools/settings-reach.ts` (`ownerSetting`,
  `keepsCard`, `TOTAL_SKIPS`) decides whether Total skips its card ([D-143](DECISIONS.md#d-143)).
- Who counts as the owner on a channel and where an owner card may be answered: `channels/inbound.ts`,
  `engine/owner-relay.ts`, `OWNER_ACTS_ON`, `app_only` inputs ([D-144](DECISIONS.md#d-144)).
- Harness integrations touching the user's Claude/Codex logins (never read or copy their tokens).
- Anything that could make v2 read or write v1's home (`~/.apx`).
