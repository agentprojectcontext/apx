# Architecture & methodology

> Deep dive for [`AGENTS.md`](../AGENTS.md). The always-read constraint is rule
> **8** (core → adapter → surface). This file explains the methodology behind the
> rules, names the reference implementations to copy, and pins the seams that are
> known-fragile. The running code-vs-contract survey is local-only under `spec/`
> and is deliberately not linked from here — see
> [`README.md`](README.md#what-is-not-here).

## The three layers

```
src/core/          the domain. Knows nothing about HTTP, argv, or React.
src/host/daemon/   adapter: HTTP API + plugins. body → core → response.
src/interfaces/    surfaces: cli, web, tui, desktop, mcp-server, acp.
```

- **Enforcement is mechanical, not prose**: `eslint.config.js` forbids
  `#host`/`#interfaces` imports in core and `#interfaces` in host with AST
  selectors (`no-restricted-syntax`, because `no-restricted-imports` globs treat
  a leading `#` as a comment and silently match nothing). It also bans rebuilding
  `~/.apx` from `os.homedir()` (`NO_HOMEDIR`).
- **The guard catches upward imports, not misplaced logic.** Passing ESLint does
  not mean the code is in the right layer. Two known dodges to never repeat:
  passing a framework in as a parameter (`build*Router(express)` factories put
  HTTP transport in core invisibly), and wrapping `os.homedir()` in a local
  helper before rebuilding an `~/.apx` path. If you need a framework object in
  core, the code is misfiled.

## How SOLID maps onto this repo

- **SRP** — a module is one concern; a *function* is one orchestration level.
  The historical failure mode is not messy files but single giant functions
  (`runAgent()` is the standing example). When a function needs a table of
  comments to navigate, split it into collaborators (see `core/agent/loop/`).
- **OCP — the registry pattern is the house style.** Every extensible family is
  a directory of uniform adapters plus one registry that maps id → adapter:
  `engines/ADAPTERS`, `runtimes/REGISTRY`, `memory/embed-engines/`,
  `agent/tools/handlers/` + `tools/registry.js`, the CLI lazy route map.
  Adding a member never edits siblings — only the new file + one registry line.
  If you build a new family, build the registry on day one:
  `confirmation/adapters/` skipped it and consumers now import concrete
  adapters directly, which is why half that family went dead without anyone
  noticing.
- **LSP — every adapter in a family must honor the whole contract.** Silently
  ignoring an option you were passed is a Liskov violation even if nothing
  crashes: the standing example is `onToken`, accepted by `callEngine` but
  honored by only 2 of 7 engines, so streaming silently degrades per provider.
  If an adapter can't support a feature, declare a capability field the caller
  can read — never swallow.
- **ISP — the contract is what the code calls, not what the doc says.** Keep
  the adapter-contract comment in each family's `index.js` in sync with every
  method the registry/consumers actually invoke (`model-router` calls
  `health()`; the engines doc must say so). Optional metadata fields get a
  declared shape or they drift.
- **DIP** — core defines the operations; adapters depend on core, never the
  reverse. When a route and a CLI command need the same operation, the
  operation moves *down* into core — the adapters never call each other.

## Reference implementations — copy these

| Pattern | Copy from | Why it's the reference |
|---|---|---|
| Tool/handler family | `core/agent/tools/handlers/` | 47 files, one default export each, `_`-prefixed shared helpers carry no `name:` so they can't be mistaken for tools. |
| Engine adapter factory | `core/engines/{openai,groq,openrouter}.js` | 8 lines each delegating to `createOpenAiCompatibleEngine` — sharing without inheritance. |
| Thin API route | `host/daemon/api/desktop.js` | 117 lines; imports the SAME `core/desktop/*` helpers the CLI uses, and its header says so. Also good: `api/deck.js`, `api/artifact-preview.js`. |
| Plugin that stays I/O-only | `host/daemon/plugins/telegram/index.js` | Lifecycle + offset persistence + thin send surface; per-update domain logic lives in `core/channels/telegram/`. |
| Resource API client (web) | `src/interfaces/web/src/lib/api/*` | One file per resource, uniform `export const X = {list,get,add,remove}`, one typed HTTP client. |
| Declarative data file | `core/http-tools/catalog.js`, `cli/help/index.js` | Data extracted from logic; the consumer only indexes/serves it. |
| Scoped shared primitive | `core/engines/_health.js`, `engines/_streaming.js` | Family-local helpers with a `_` prefix. (Caveat: verify `_streaming` consumers before assuming they all use it.) |

## One home per operation — the grep-first discipline

Before writing any helper, grep for it. Singles that already exist:
`~/.apx` paths (`core/config/paths.js`), JSON I/O (`core/util/json-file.js` —
including atomic temp+rename writes; the documented inline-`JSON.parse`
exemptions are for reads where corrupt config must throw), frontmatter
(`core/apc/frontmatter.js parseFrontmatterFields` — the narrow
`/^([a-zA-Z_]+):/` regex is a known bug, never reintroduce it), project
resolution (`core/apc/projects-helpers.js resolveProject`), scope normalization
(three per-subsystem functions, deliberately NOT merged), spawn-capture
(`core/runtimes/_spawn.js`), constants (`core/constants/*`,
`agent/tools/names.js`).

If the single you need doesn't exist yet (fetch-with-timeout, stdin read,
turn-logging envelope), check the local survey's rule-8 ledger under `spec/`
first — it may already name the intended home. Create the single there and
migrate callers; never add copy #2.

## Comments are decision records — keep them true

House style is high-density "why" comments with failure anecdotes. They are
load-bearing: agents trust them instead of re-checking. That makes a stale one
worse than none — a header claiming a consolidation happened stops the next
reader from finding the surviving copies. When you finish (or abandon) a
migration a comment describes, update the comment in the same change, and never
cite a file path you haven't verified exists (convention 17).
