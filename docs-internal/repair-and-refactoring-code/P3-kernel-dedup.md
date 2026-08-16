# P3 — Shared kernel & deduplication

This phase removes the "many plausible homes" problem that makes agents guess.
Each item collapses N copies into 1 and deletes the rest.

## P3-1 — `core/util/json-file.js`

**35 sites** inline `JSON.parse(fs.readFileSync(...))`, and **six modules**
reimplement a read/write JSON helper: `core/vars/sources.js:33,43`,
`core/mcp/sources.js:66`, `core/stores/code-sessions.js:31,38`,
`core/profiles/store.js:33`, `core/stores/routines.js:14,25`,
`core/stores/project-files.js:157,191`.

Each copy handles missing files and corrupt JSON slightly differently — that is a
real source of inconsistent behavior, not just duplication.

Provide `readJson(path, fallback)`, `writeJson(path, value)` (atomic: temp + rename,
so a crash mid-write cannot corrupt config), and async variants for request paths.

## P3-2 — One scope vocabulary

`normalizeScope` exists **5 times**, three of them inside `api/` alone
(`mcps.js:48`, `vars.js:27`, `integrations.js:29`), plus `cli/commands/mcp.js:9-40`.
The scope concept (`runtime` ▶ `apc` ▶ `global`) is core domain, not adapter detail.

`core/constants/scopes.js` + `core/scopes.js` own it; adapters import.

## P3-3 — One frontmatter parser

**4 implementations**: `core/apc/parser.js:276`, `core/agent/skills/loader.js:53`,
`cli/commands/session.js:45`, `cli/commands/sessions.js:482` — plus a 5th shape at
`core/stores/sessions.js:29`. One home, one behavior.

## P3-4 — One project resolver

`core/apc/projects-helpers.js:15 resolveProject` is canonical; six others
reimplement it (`agent/tools/handlers/call-runtime.js:73`,
`api/sessions-search.js:10`, `interfaces/mcp-server/index.js:33`,
`cli/commands/project.js:76`, `interfaces/acp/session.js:125`).

## P3-5 — Enforce the path constants

`core/config/paths.js` already exports `APX_HOME`, `CONFIG_PATH`, `PID_PATH`,
`LOG_PATH`, `TOKEN_PATH`. **27 sites rebuild them from `os.homedir()`** anyway,
including `TOKEN_PATH` in `cli/http.js:14` and `desktop/main.js:31`, and
`PID_PATH`/`LOG_PATH` in `cli/commands/daemon.js:16,17`.

Replace all of them; the ESLint rule from P1 keeps them gone.

## P3-6 — Tool names are constants, not literals

`core/agent/tools/names.js` claims in its header that every mention of a tool by
name imports from it. In fact **3 files** import `TOOLS`, and raw literals live in
9 others. The costly one:

```js
// core/agent/run-agent.js:311 — inline Set of 8 literal tool names
const SIDE_EFFECT_TOOLS = new Set(["send_telegram", "write_file", "run_shell", ...]);
```

Rename a tool and the de-duplication silently stops protecting the user from
receiving the same Telegram message three times. Same class of bug in
`agent/constants.js:18,24` and `agent/security.js:20`.

Also: `core/identity/telegram.js:20` **imports `SENDER_ROLES` and never uses it** —
lines 40, 118, 122 write `"owner"`/`"guest"` as literals.
`handlers/set-permission-mode.js:3,15,23` hardcodes the three permission modes
three times instead of importing `PERMISSION_MODES`.

## P3-7 — Web-side duplication

- **`cn()` is implemented twice, verbatim**, in `lib/cn.ts` and `lib/utils.ts`; the
  panel is split 52 files / 54 files between them. Keep one.
- `slugify` has 3 web implementations with **different semantics** (accent handling
  differs), plus 2 in the backend.
- Date formatting is reimplemented 4×. One of them,
  `CodeContextTab.tsx:39`, hardcodes `toLocaleString("es")` in an app that ships
  en + es dictionaries — Spanish month names regardless of the user's language.
  That is a user-visible bug, not just duplication.

## P3-8 — Retire the hidden handshakes

Modules currently communicate by mutating each other's objects, with no interface,
no type and no test:

- `run-agent.js:235` writes `toolHandlerCtx.securityRiskActive`; `tools/registry.js:402`
  reads it. Same for `securityGateCleared`.
- `agent/security.js:81` — `popSecurityRisk(args)` **deletes a key from the caller's
  args object** as its mechanism.
- `identity/telegram.js:93` re-points a subtree of the caller's live global config.

Give each an explicit shape passed in and returned, so a rename fails loudly.
