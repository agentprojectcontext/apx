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
