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
Keychain (checked with `codex sandbox`). So on macOS secret values live in the Keychain (service `apx2`, written
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
(`never` / `untrusted` / `ask` / `always`) and whether untrusted content is in the turn. A delegated run gets the
intersection of its callers' tools and the strictest autonomy. Confirmations, questions and (later) browser handoffs
share one durable machine (`pending_inputs` + `runs.respond`): a wait survives restarts, a timeout counts as a no,
and an approval that arrives after its turn ended allows exactly one identical call. Agents' own commands
(`shell`) are not a protocol method: a method would be a door around the policy.
