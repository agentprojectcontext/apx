# The human model — what this system actually is

> Deep dive for [`AGENTS.md`](../AGENTS.md). Every other file here is written
> for someone already inside the code. This one is written for the **owner**:
> the person who decides what gets built, reviews what an agent produced, and
> has to judge whether "done" is true — without having read all 95k lines or
> knowing every library in the tree.
>
> It answers one question: *if I change this, what else moves?*
>
> It is deliberately short. When it starts explaining how to do something, that
> belongs in a subsystem deep dive instead.

## 1. There is one long-running process, and everything else talks to it

**The daemon is the product.** `apx-daemon` (`src/host/daemon/index.js`) listens
on **:7430** and holds all the state that matters. The CLI, the web panel, the
phone, the desktop capsule, the TUI, Telegram and the MCP server are all
*clients* of it — none of them own anything.

This single fact explains most of the surprising behaviour in this repo:

- **A code change does nothing until the daemon restarts.** It is running the
  JavaScript it booted with. `apx restart`, then verify. This is rule 17, it is
  the most expensive rule in the repo to skip, and it is the reason a green test
  suite can sit next to a broken system.
- **The daemon runs from the MAIN checkout.** Work committed only on a worktree
  branch is invisible to it, no matter how many times it restarts.
- **If the daemon is confused, everything is confused at once** — the phone, the
  panel and Telegram are the same brain wearing different clothes.

## 2. What starts when the daemon starts

Read `src/host/daemon/index.js` top to bottom once; it is the honest table of
contents for the whole system. It boots, in order:

| Subsystem | What it does | If it dies |
|---|---|---|
| `ProjectManager` (`db.js`) | finds and tracks APC projects | nothing resolves by project |
| `McpRegistry` (`core/mcp/runner.js`) | spawns configured MCP servers | agents lose external tools, silently |
| `PluginManager` (`plugins/`) | **Telegram** and **desktop** | messages stop arriving; nothing else notices |
| `RoutineScheduler` | cron — the agent acting on its own | routines stop firing; no error surfaces |
| `startDeliverySweep` | retries deliveries that did not land | messages quietly never arrive |
| `startCallbackReconciler` | reconciles pending confirmations | "¿sigo?" prompts hang forever |
| `initMemory` (`core/memory/`) | notebook, RAG index, compaction, broker | the agent gets amnesia but keeps talking |
| HTTP API + 3 WS hubs | `desktop-ws`, `terminal-ws`, `events-ws` | live updates stop; polling still works |

**The pattern worth internalising: almost every failure here is silent.** A
routine that stops firing, an MCP that failed to spawn, an embedding backend
that went down — none of them throw where you can see it. `apx daemon logs`
is the first place to look, always, before theorising.

## 3. Two words that are not the same word

The glossary in `AGENTS.md` is long because this repo overloads a lot of terms,
but two of them cause most of the real confusion:

- **engine** = an LLM provider (anthropic, openai, groq, openrouter, ollama,
  gemini, mock). It answers a prompt.
- **runtime** = an external coding CLI that APX *delegates a whole task to*
  (claude-code, codex, opencode, aider, cursor-agent, gemini-cli, qwen-code,
  antigravity). It runs an agent of its own.

"The model is wrong" and "the delegated CLI is wrong" are different bugs in
different directories. And **super-agent is a mode, not a name** — the visible
name comes from `~/.apx/identity.json`.

## 4. Where your data lives — and where it must never live

| Path | What | Committed? |
|---|---|---|
| `~/.apx/` | **all runtime state**: config, tokens, conversations, sessions, message logs, per-project storage | never |
| `.apc/` (in each of your projects) | the portable context: `AGENTS.md`, agents, skills, non-secret MCP hints | yes, by you |
| this repo | code, docs, rules. **No state, no secrets, no real data** | yes |

Rule 3 exists because this repo is **public and history is permanent**. A
scrubbed secret is removed from the tip, not from the commits. The specific trap
is command output: `apx config show --effective` and `apx status` print engine
API keys and the Telegram bot token, and pasting one into an issue, a fixture or
a commit publishes it.

That is also why `spec/` and `qa/` are gitignored: planning docs are fine, but
QA logs are raw captures of a live install.

## 5. The one architectural rule

```
core  →  adapter  →  surface
```

`src/core/` owns every operation and knows nothing about HTTP, argv or React.
`src/host/daemon/` and `src/interfaces/*` only parse input, call **one** core
function, and shape the output. Arrows never point back up — ESLint fails the
build if they do.

**Why you should care as a reviewer:** when the same operation exists in a route
*and* a CLI command, they will drift, and the two will disagree in production.
"Move it into `core/`" is the correct answer to that, roughly always.

The guard is mechanical but narrow: it catches an upward *import*, not
misplaced *logic*. Passing an Express object into core as a parameter passes
lint and is still a violation.

## 6. Three projects wearing one repo

This is one git repository and **three separate pnpm projects** with three
lockfiles: the root, the web panel (`src/interfaces/web`), and the docs site
(`docs/`). They are installed separately and linted separately.

The practical consequence, and it has bitten before: **`npm run lint` at the
root reports success having never opened a single panel file.** Always
`npm run preflight`, never `npm run lint` alone. Full table:
[`enforcement.md`](enforcement.md).

## 7. What is actually guaranteed

Some rules stop a push. Others hold only because a human read the diff. Knowing
which is which is the difference between "the gate will catch it" and "nobody
will notice for three months".

Do not re-derive this — it is one table, kept current, in
[`enforcement.md`](enforcement.md). Read it before trusting any rule, including
the ones in this file.

The short version: **layering, tests, coverage, i18n parity, label casing and
types are enforced. Secrets, real data in fixtures, docs staying true, and
restarting the daemon before you believe a result are not.** Every one of those
four is a judgment call that lands on review — which means on you.

## 8. The fragile seams

Places where things have actually broken, and will again:

- **Restart discipline** (rule 17) — the single most common way work here goes
  wrong. Symptom: "my change doesn't work" for a change that was never loaded.
- **Worktrees** — several agents share this working tree; commits get swept into
  each other, and a worktree fix never reaches the running daemon.
- **Adapters that swallow options** — `onToken` is accepted by every engine and
  honored by two of seven, so streaming silently degrades per provider. Any
  family where an adapter can quietly ignore part of the contract has this shape.
- **Prose-only rules** — the survey found these are the ones being violated,
  consistently. If something matters, it needs a gate, not a paragraph.
- **Stale comments and docs.** House style is dense "why" comments, and agents
  trust them *instead of* re-reading the code. A comment claiming a migration
  finished stops the next reader from finding the surviving copies. This is not
  hypothetical: the Pages workflow described the root `index.html` as the web
  SPA for months; it was an orphaned old landing page, and the real SPA entry
  lives at `src/interfaces/web/index.html`.
- **The TUI is an island** — a vendored OpenCode fork with zero `#core/`
  imports, reaching APX over HTTP. Repo rules mostly do not apply inside it;
  don't try to wire it to core.

## 9. Ten places worth knowing by name

| Path | Why it matters |
|---|---|
| `src/host/daemon/index.js` | boot order — the honest table of contents |
| `src/host/daemon/api/` | 53 routers; every data route lives under `/api` |
| `src/core/agent/run-agent.js` + `loop/` | the tool loop — where a turn actually happens |
| `src/core/agent/prompts/` | what the agent is told, per channel and mode |
| `src/core/agent/tools/handlers/` | one file per tool; the reference registry |
| `src/core/engines/` | LLM providers |
| `src/core/runtimes/` | external coding CLIs |
| `src/core/config/paths.js` | the only legal way to build an `~/.apx` path |
| `src/core/constants/` | channels, actors, permissions — never inline these |
| `tests/web-guardrails.test.js` | the panel's real gate, run from the backend suite |

## 10. The lifecycle, end to end

```bash
pnpm install                                   # root
cd src/interfaces/web && pnpm install          # the panel is its own project
npm run preflight                              # the gate: lint · lint:web · test:ci · build:web · tsc · tui
apx restart                                    # ← the step people skip
curl -s 127.0.0.1:7430/api/health              # uptime_s near zero
apx daemon logs --tail 30                      # clean boot, no stack trace
# then exercise the path you actually changed
```

Pushes are gated (`.githooks/pre-push` + CI). **Commits are not.** Releases go
out through semantic-release on push to `main`; the docs site and the landing
publish to GitHub Pages from the same branch.

---

**If you read only one other file after this one**, make it
[`enforcement.md`](enforcement.md) — it tells you which of these rules can
actually stop a mistake, and which are only asking nicely.
