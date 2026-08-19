# AGENTS.md — dev guide for the apx codebase

> Hand-maintained guide for working **on** apx itself (read by Codex, Claude Code,
> and any AGENTS.md-aware tool). APX never regenerates this file — it's created at
> `apx init` and owned by the project. End-user app usage lives in `docs/`.

This file is the **hub**: the always-read contract (glossary, the dev loop, the
numbered rules) lives here in full. Per-subsystem how-to is split into
**read-on-demand** deep dives under [`rules/`](rules/) —
open one only when you're working in that subsystem. See [Deep dives](#deep-dives--read-on-demand) below.
The current code-vs-contract audit (live bugs, god-file verdicts, dedup backlog):
[`spec/repair-and-refactoring-code/SURVEY-2026-08-17.md`](spec/repair-and-refactoring-code/SURVEY-2026-08-17.md) (local-only, under `spec/`).

## Contents

- [Glossary](#glossary--read-this-before-guessing) — the terms this repo overloads; read before guessing
- [The dev loop](#the-dev-loop--skip-a-step-and-your-test-is-a-lie) — restart + verify, or your test is a lie
- [Repo map](#repo-map) — top-level orientation (full breakdown in the deep dive)
- [Project rules](#project-rules) — the numbered 1–17 contract
- [Deep dives](#deep-dives--read-on-demand) — subsystem how-to, read only when needed
- [Agents (dogfood)](#agents-dogfood)

## Glossary — read this before guessing

Several words in this repo mean more than one thing. Picking the wrong sense is
the single most common way work here goes sideways, so they are pinned here.

| Term | In this repo it means | Not to be confused with |
|---|---|---|
| **APC** | Agent Project Context — the open standard: `AGENTS.md` + `.apc/`. | **APX**, this program, which implements it. |
| **engine** | An LLM provider adapter in `core/engines/` (anthropic, openai, groq, openrouter, ollama, gemini, mock). | `runtime`, below. |
| **provider** | The left half of a model id `provider:model`. Same set as the engines. | — |
| **runtime** | An **external coding CLI** APX delegates to (`core/runtimes/`: claude-code, codex, opencode, aider, cursor-agent, gemini-cli, qwen-code, antigravity). | `core/runtime-skills/` (skills loaded at run time — unrelated), and the `runtime` **MCP scope** (`~/.apx/projects/<id>/mcps.json`). Three different senses; check which one the code means. |
| **channel** | A **surface** a turn arrives on: `telegram, cli, routine, api, web, web_sidebar, web_code, deck, desktop, code`. Canonical list in `core/constants/channels.js`. | `mode`, below. There is no `voice` channel. |
| **mode** | *How* a turn is handled, orthogonal to the channel. `voice` is a mode (`channelMeta.voice`); desktop is always voice. `plan`/`build` are code modes. | `channel`. |
| **persona** | The agent's **visible name** (`~/.apx/identity.json` → `agent_name`, default "APX"). | **agent profile**, below. |
| **agent profile** | An installable package that gives the super-agent a line of work (`core/profiles/`, `config.profile`, `apx profile`). | `persona`, and a *config* profile. Always write "agent profile" when the bare word could be misread. |
| **super-agent** | A **mode of operation**, not a name. The agent that runs across channels with the global tool set. | A persona name. Older docs called it Roby, and an older fallback spelled it in Spanish; both are stale — the display name comes from `resolveAgentName()`. |
| **agent vault** | Reusable agent definitions at `~/.apx/agents/`, not tied to one project. | A project's `.apc/agents/`. |
| **broker** | The memory component that assembles the `[RELEVANT MEMORY]` block per turn (`core/memory/broker.js`). | The RAG indexer or the compactor. |
| **inspector** | Opt-in per-turn skill RAG (`core/agent/skills/inspector.js`). | The skills *catalog* or *loader*. |
| **deck** | The tablet/phone dashboard surface. | The desktop capsule. |
| **actor** | Who produced a message (`core/constants/actors.js`). | A channel or a role. |
| **scope** | Where a setting is stored — **and the vocabulary differs per subsystem.** MCPs: `shared\|runtime\|global`. Vars and integrations: `project\|global`. Never merge these; see `normalizeMcpScope` / `normalizeVarScope` / `normalizeIntegrationScope`. | — |

Two more, in code comments rather than names: **"Pieza 2/3/4"** in `core/memory/*`
headers refers to the four parts of the cross-channel memory design (notebook,
RAG, compaction, broker). And `skills/` (3 bundled for npm) is not
`src/core/runtime-skills/` (the ~19 the super-agent actually loads).

## The dev loop — skip a step and your test is a lie

Every step below has the same failure mode when skipped: you test the **old**
code, conclude your change did not work, and go debug something that was never
broken. This is the most expensive way work here goes wrong, and it has cost
whole sessions. It is not optional.

**1. Know which checkout the daemon runs from — it is the MAIN checkout.**
Never a worktree: worktrees have no `node_modules` and cannot run the daemon.

```bash
ps -o command= -p "$(pgrep -f 'src/host/daemon/index.js' | head -1)"
```

A change committed only on a worktree branch is **invisible to the running
daemon**, no matter how many times you restart it. Either land it where the
daemon reads from, or say plainly that the fix is not live yet — do not let a
green test suite in a worktree stand in for a working system.

Check too that your branch has not been overtaken: `git log <branch>..main`. Main
may already carry a competing fix for the same bug, and pasting yours over it
silently drops someone else's work.

**2. Restart after EVERY code change, and BEFORE testing by hand.**

```bash
apx restart
```

The daemon holds the JS it booted with — adapters, routes, tool handlers, prompt
builders. `apx restart` restarts the daemon and, when it is running, the desktop
window. Run it from the main checkout so the process cwd is not a worktree.
Restart *before* you test, not after you have already drawn a wrong conclusion.

**3. Verify it took — three checks, not one.**

```bash
curl -s 127.0.0.1:7430/api/health     # uptime_s back near zero
apx daemon logs --tail 30             # clean boot, plugins initialized, no stack trace
```

Then **exercise the path you actually changed**, end to end: `apx exec "…"` for
anything in the agent/tool loop, the route itself for an API change, the screen
for a web change. "The daemon booted" is not evidence that your change works —
a fresh uptime only proves a process restarted.

**4. Do not report "done" until step 3 passed.** Say which command you ran and
what it returned. If you could not verify — no quota, no credentials, an external
service down — say that explicitly instead of implying it works.

**The exceptions are data, not code:** files a running daemon reads on demand (a
bundled profile package, a skill) and `~/.apx/config.json`, which
`POST /api/admin/reload` re-reads. When in doubt, restart — two seconds, and it
removes a whole class of wasted debugging.

**Skills refresh two different ways, and this is the part people get wrong.**
RUNTIME skills (`src/core/runtime-skills/`) are the super-agent's own: the loader
reads them from the package path on demand, so adding or editing one is live
immediately — no install, no restart. ENGINE skills (`skills/`, the bundled set) get
copied into the host CLIs' own directories (`~/.claude/skills/`, …) by
`apx skills sync` and by `postinstall`. So a PUBLISHED install refreshes them on
`apx update`; a DEV checkout never runs postinstall, and must not run
`apx update` at all — it replaces the global symlink pointing at this repo with
the npm tarball, and you silently stop testing your own code. In dev the command
is `apx skills sync`.

## Repo map

Top-level orientation; the full per-folder breakdown is in
[`rules/repo-layout.md`](rules/repo-layout.md).

- `src/core/` — engine-agnostic core (agent loop, prompts, skills, tools, engines, runtimes, memory, stores, constants…). **Never imports upward.**
- `src/host/daemon/` — thin adapter over `core/`: HTTP API (`api/*.js`), plugins (`telegram/`, `desktop/`), WS hubs. No domain logic here.
- `src/interfaces/` — `cli/`, `web/` (React+Vite panel), `tui/` (vendored OpenCode island, HTTP-only), `desktop/` (Electron), `mcp-server/`, `acp/`.
- `tests/` — backend suite (`npm run test:ci`); `src/interfaces/web/e2e/` — Playwright.
- `skills/` — bundled `SKILL.md`s · `scripts/` — build/sync/hooks · `docs/` — public docs site.

## Architecture & methodology — the shape every change follows

Full version with reference implementations: [`rules/architecture.md`](rules/architecture.md).

- **core → adapter → surface** (rule 8) is the whole design: `core/` owns every
  operation; `host/daemon` and `interfaces/*` only parse input, call ONE core
  function, and shape output. ESLint enforces the import direction — but it
  cannot see *misplaced logic*, and passing a framework object into core as a
  parameter is still a violation.
- **Extension = registry pattern.** Every family (engines, runtimes, tool
  handlers, embed engines, CLI routes) is a directory of uniform adapters plus
  one id→adapter registry. Adding a member touches the new file + one registry
  line, nothing else. New family → build the registry on day one. An adapter
  must honor (or explicitly declare it lacks) every option the family contract
  passes — silently swallowing one degrades behavior per provider.
- **One operation, one home; grep before writing any helper.** The shared
  kernel already covers paths, JSON I/O (atomic writes included), frontmatter,
  project resolution, constants, spawn-capture. Copy #2 is a bug.
- **Comments are decision records.** When you finish or abandon a migration a
  comment describes, update the comment in the same change; never cite an
  unverified file path.

## Project rules

1. **Tests ship with behavior.** Every new route/command/plugin/config key and every bug fix lands with a test in `tests/`. Drive HTTP through `buildApi()` + `app.listen(0)`; build trees with `makeTempProject()`. Anything writing under `~/.apx` must set `process.env.HOME` to a temp dir **before** importing the module. Tests run offline: no network, no keys, no live daemon.
   - **No skipped tests. Ever.** `test.skip`/`it.skip`/`describe.skip`/`test.todo` are forbidden — `npm test` must report `skipped 0` and `todo 0`, and CI enforces it. A test that can't run is fixed or deleted with a reason in the commit body.
   - **A bug fix lands with a regression test that fails before the fix.** Say in the commit body which test would have caught it.
   - **Dangerous surfaces are covered.** Any handler that writes files, runs a shell, changes a permission mode, or messages a human needs a direct test.
   - **Coverage only goes up.** `test:ci` enforces a floor (`COVERAGE_FLOOR` in `scripts/test-ci.js`). When you push it higher, raise the floor in the same commit; never lower it to make a build pass.
2. **Gate every push with `npm run preflight`** (lint + `test:ci` + web build + web `tsc --noEmit` + the TUI ratchet). The pre-push hook and the `pull_request` CI workflow both enforce it — don't bypass.
3. **No secrets in the repo.** Tokens live in runtime scope only (`apx mcp add --scope runtime`); `.apc/mcps.json` holds non-secret hints. Runtime state (conversations, sessions, message logs, config, tokens) stays under `~/.apx/`. **Never commit command output/logs** — `apx config show --effective`, `apx status`, etc. can dump engine `api_key`s and the Telegram bot token. Scrub or gitignore any captured output.
   - **No real data in examples, fixtures, or docs — invent it.** Every project name, company, person, domain, chat/user id, IP, hostname, and absolute path that appears in a test, a `SKILL.md`, CLI help, a code comment, a screenshot, or `docs/` must be made up. Use obvious placeholders: `acme` / `northwind` for projects, `example.com`, `1234567890` for ids, `/path/to/project` for paths. Never paste a real turn — a Telegram reply, a memory note, a routine output — into a fixture; retype it with synthetic content, because a transcript carries whatever the live install happened to know. This is a **public** repo and history is permanent: a scrub after the fact removes it from the tip, not from the commits, so the check belongs in review, not in a cleanup pass later. Do not record the offending values here or in any commit message — naming them publishes them again.
4. **"super-agent" is a mode, not a persona name.** User-facing copy uses `~/.apx/identity.json` (default "APX"); config keys/routine kinds may still say `super_agent`.
   - **`persona` ≠ `profile`.** `persona` is the agent's *visible name* (`identity.json.agent_name`) — that meaning is load-bearing here and in `core/identity/self.js`. An **agent profile** (`core/profiles/`, `config.profile`, `apx profile`) is an installable package that gives the super-agent a line of work. Never use one word for the other; write "agent profile" where the bare word could be read as a config profile.
5. **Respect backward-compat shims.** The `overlay`→`desktop` rename keeps `config.overlay`, `/overlay/ws`, and `apx overlay` working — don't reintroduce old names or break the shims (they're tested).
6. **Skills stay in sync.** When you change CLI commands, routes, config keys, or behavior documented in a skill, update the matching `SKILL.md` in the same change. **Look in `src/core/runtime-skills/<slug>/` first** — that's where the ~19 skills the super-agent actually loads live. The 3 under `skills/` are only the bundled ones shipped to npm, and `skills/apc-context/` is synced from upstream (don't hand-edit it). Verify flags with `apx <command> --help` — don't invent subcommands.
   - **Docs stay in sync too.** Any change that alters user-facing behavior — CLI commands/flags, config keys, providers/engines, surfaces (web/desktop/voice/deck), MCP, integrations/connectors, memory, or a new capability — must review `docs/` and update the affected page in the **same** change (both EN `src/content/docs/<section>/<slug>` and ES `…/es/<section>/<slug>`). If a whole feature has no page yet, add one (follow `docs/AUTHORING.md`). Pure internal refactors with no observable change need no docs edit. Build with `cd docs && pnpm build` when you touch it (docs are not in preflight). Deep dive: [`rules/docs-site.md`](rules/docs-site.md).
7. **Imports use `#aliases`, not `../../../`.** `#core/*`→`src/core/*`, `#host/*`, `#interfaces/*` (package.json `imports`; mirrored in `jsconfig.json`). Same-folder neighbors stay relative.
8. **One domain function — one home.** When an operation exists in both an `api/<x>.js` route and a CLI `commands/<x>.js`, the logic belongs in `core/` (usually `core/stores/<x>.js`). API and CLI are adapters: parse input, call core, shape output. Model: **core → adapter → surface**.
   - **This is machine-enforced.** ESLint fails the build if `core/` imports `#host/*` or `#interfaces/*`, or if `host/` imports `#interfaces/*`. It is a `no-restricted-syntax` AST selector, not `no-restricted-imports` — those patterns go through minimatch, which treats a leading `#` as a comment, so `#host/**` silently matches nothing and the rule looks like it passes while enforcing nothing. If core needs something that lives in an adapter, the thing is misfiled — move it into core rather than importing upward.
   - **Before writing a helper, grep for it.** Scope normalization (per subsystem — `normalizeMcpScope` / `normalizeVarScope` / `normalizeIntegrationScope`, deliberately NOT merged: the vocabularies differ) and `~/.apx` paths (`core/config/paths.js`) have exactly one home; frontmatter parsing and project resolution still have several and are being consolidated. Adding a second copy is a bug, not a convenience.
9. **Adding a daemon route.** Export `register(app, ctx)` from `api/<x>.js`, mount it in `buildApi()` before the 404 catch-all, return `{ error }` + a real status code. **Every data route lives under `/api`** (`api/prefix.js` — `API_PREFIX`, `isApiPath`, `apiPath`), so route paths are written root-relative and the mount adds the prefix. That is structural, not a list: the old hand-maintained `API_PREFIXES` is gone, and with it the footgun where an authenticated GET got mistaken for an SPA asset. The SPA fallback in `api/web.js` steps aside for `/api` only — keep `isKnownSpaRoute` in sync with the `<Routes>` registry so unknown client routes 404 instead of silently returning 200. Wrap async handlers in `asyncRoute()` (`api/shared.js`) so a rejection becomes a 500 instead of killing the daemon.
10. **Adding a CLI command.** Write `cmd<Name>(args)` in `cli/commands/<x>.js`, add its routing in `cli/routes/<x>.js` (export `default async function route(rest, ctx)`, plus `export const aliases = [...]` if it takes any), register it in `cli/routes/index.js`, and add a `topic({…})` in `cli/help/index.js`. There is no dispatch switch — `cli/index.js` looks the command up and lazily imports its route module, so a command loads only what it uses. Aliases are declared per command on purpose: `rm` means remove under `agent`, unset under `project config` and revoke under `pair`. `parseArgs` yields `{ _: [positionals], flags }`. Every command prints an `apx vX` mark (header/banner via `branding.js`; `--version`/`update`/`init` get the big banner). Reach the daemon via the `http` helper (auto-starts it).
11. **Web panel = Base UI, hand-built.** Curated Base-UI primitives in `components/ui/*` behind the `components/ui.tsx` barrel — no Radix, no shadcn installer runs; `components.json` stays deleted. All requests go through `src/lib/api/*` (bearer auto-fetched from `/api/admin/web-token`). Every string in **both** `i18n/en.ts` and `i18n/es.ts` under the same key. New screens/modules get a Playwright spec in `e2e/`. How-to: [`rules/web-ui.md`](rules/web-ui.md).

11a. **Every user-visible label starts with a Capital.** A label is anything that
    NAMES something on screen: nav items, list rows and their sub-labels, chips,
    column headers, buttons, tabs, empty states, toasts, dialog titles. Sentence
    case, capital initial — `"Memoria interna"`, `"En el repo"`, `"Project
    memory"` — never Title Case, never `"en el repo"`. Group headings are written
    the same way even when CSS renders them uppercase: the shouting is the
    stylesheet's job, not the string's. **The exception is a fragment**, a string
    the interface composes into a running sentence or drops mid-text (`in:
    "en {amount}"`, `every_n_hours: "cada {n} horas…"`) — those follow the
    sentence they land in. Data is not a label either: a slug, a path, a file
    name or a command keeps its real spelling (`rocky-pm`, `.apc/memory.md`,
    `apx restart`), and storage enum values reach the screen through
    `<FilterChips>`, which Capitalises them. Both `i18n/en.ts` and `i18n/es.ts`
    follow this per key. It is not cosmetic: lowercase labels read as unfinished
    notes-to-self, and a panel that mixes the two looks like two products.

11b. **One page layout for every list screen.** Wrap it in `<Section>` and use
    the slots: `title` + `description`, the ONE primary action in `action`
    (top-right, with the title), and every filter/segment/tab in `filters` — its
    own row underneath. Never put filters in `action`: it turns the primary
    button into just another chip in a strip, and the pages drift apart until
    moving between them shifts the whole layout (Routines drew its header
    outside a card while Tasks and Commitments sat inside one). Filter labels go
    through `<FilterChips>`, which Capitalises them — the chips used to print
    the raw storage value (`open`, `in review`), putting database vocabulary in
    the interface.


12. **Channel rules live in ONE place; watch the prompt budget.** Per-channel formatting goes in `prompts/channels/<ch>.md` (+ `modes/voice.md`) — never inline in callers. `prompts/core/super-agent.md` ships every turn on every channel — keep it lean (~2.5k tok). Measure with `node scripts/inspect-channel-prompts.js`. Don't recite a tool catalog (the runtime sends real schemas); operational syntax belongs in on-demand `apx-*` skills. Deep dive: [`rules/prompts-and-channels.md`](rules/prompts-and-channels.md).
13. **No hardcoded paths or identity/channel/permission strings.** Paths from `core/config/` (`APX_HOME`, `CONFIG_PATH`, `projectStorageRoot()`); channels from `constants/channels.js`, permission modes from `constants/permissions.js`, actor ids from `constants/actors.js`. Read/write global config only via `readConfig()`/`writeConfig()` — `writeConfig` refuses to silently clear credentials (`CREDENTIAL_PATHS`); pass `_allowClear:true` for an intentional reset. Per-project overrides in `.apc/config.json`, deep-merged via `effectiveConfig()` (arrays replace, don't merge).
14. **ESM + pnpm.** `"type":"module"`, Node ≥22 (what CI runs and the docs site requires): explicit `.js` imports, no `__dirname` (use `fileURLToPath(import.meta.url)`). **pnpm only**. Only `src/`, `skills/`, `README.md` ship to npm.
15. **The daemon never blocks the event loop on a request path.** New I/O inside a route handler uses `fs/promises`; sync I/O is for boot only. Every async handler goes through `asyncRoute()` so a rejection becomes a 500 instead of killing the process.
16. **Never inline a tool name.** Import from `core/agent/tools/names.js`. A renamed tool must not silently disable a safety check — the side-effect de-duplication that stops a Telegram message being sent three times keys off these names.

17. **A code change is not applied until the daemon restarts** — `apx restart`,
    before you test by hand, then verify it took. The daemon runs from the MAIN
    checkout, so a change committed only on a worktree branch never reaches it.
    Full procedure and the verification commands: **["The dev loop"](#the-dev-loop--skip-a-step-and-your-test-is-a-lie)**
    above. It is the single most common way work here goes sideways.

## Deep dives — read on demand

Subsystem how-to lives in [`rules/`](rules/) so this
hub stays scannable. Open a file only when you're working in that subsystem;
when you change behavior it documents, update both the deep dive and the matching
rule above in the same change.

| Deep dive | Read it when you're touching… |
|---|---|
| [`architecture.md`](rules/architecture.md) | any structural decision — layering, SOLID, registries, where logic lives |
| [`repo-layout.md`](rules/repo-layout.md) | finding where a thing lives / where a new thing goes |
| [`daemon-api.md`](rules/daemon-api.md) | HTTP routes, `asyncRoute`, plugins, WS hubs (rules 9 / 15) |
| [`cli.md`](rules/cli.md) | CLI commands, routes, help, aliases (rule 10) |
| [`testing.md`](rules/testing.md) | writing/harnessing tests, coverage floor, preflight (rule 1) |
| [`recipes.md`](rules/recipes.md) | engines, external runtimes, MCP scopes, Telegram identity |
| [`web-ui.md`](rules/web-ui.md) | the React + Vite admin panel (rules 11 / 11a / 11b) |
| [`prompts-and-channels.md`](rules/prompts-and-channels.md) | prompt assembly, channels, lazy tools, skills (rules 12 / 16) |
| [`memory.md`](rules/memory.md) | embeddings, message store, compaction, vector index |
| [`desktop.md`](rules/desktop.md) | the Electron floating voice window (rule 5) |
| [`docs-site.md`](rules/docs-site.md) | the public Astro + Starlight docs in `docs/` (rule 6) |

## Agents (dogfood)

apx registers itself as an APC project to exercise multi-engine routing. Any project agents live in `.apc/agents/<slug>.md` (that dir is the source of truth); this root `AGENTS.md` is never regenerated from them.
