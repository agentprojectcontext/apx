# P6 — Cleanup

Lowest priority, done last: none of it changes behavior, all of it reduces the
surface an agent has to reason about.

## P6-1 — Dead code

**194 exports are imported by nobody** (114 in `core` + `host`). Notable:

- `core/confirmation/adapters/code.js:16` and `adapters/terminal.js:15` — two of the
  four confirmation adapters are dead while `telegram` and `web` are live. Decide in
  P5-2: finish the abstraction or delete these.
- `host/daemon/stt-venv.js` — 8 exports, only `pythonForWhisper` is consumed.
  Dead: `VENV_DIR`, `venvPython`, `venvExists`, `ensureVenv`, `venvHasModule`,
  `pipInstall`, `removeVenv`, `ENGINE_PACKAGES`.
- `core/apc/paths.js:12-22` — 11 of 12 `APC_*` name constants exported "for the rare
  caller that needs to glob/match by name". There is no such caller.
- `core/http-tools/browser.js:481,491`, `core/artifacts/tunnel.js:67`,
  `core/i18n/index.js:53`, `core/profiles/lifecycle.js:439,453`,
  `core/deck/manifest.js` (5 exports), `core/agent/security.js:13,14,36`.
- `core/channels/telegram/ask.js:307 _reset` — a test seam no test uses.

## P6-2 — Unused dependencies

Seven root runtime deps with **zero import sites**, shipped to everyone who installs
`@agentprojectcontext/apx`:

`react` (the only match is the string `"react"` as an artifact-kind tag in
`core/artifacts/preview.js:81`), `esbuild-plugin-solid` (a *build* plugin declared as
a runtime dep), `chalk`, `cli-cursor`, `iconv-lite`, `raw-body`, `safer-buffer`.

Note `chalk` is declared but imported zero times while **13 files each define their
own private ANSI palette** — either adopt chalk or drop it, not both.

## P6-3 — The orphaned landing page

Root `index.html` is 72 KB of marketing landing page, an older sibling of
`landing.html` (95 KB) with ~433 differing lines. Nothing in the build, the daemon,
or the Pages workflow reads it — the real Vite entry is
`src/interfaces/web/index.html`.

It is protected by an **incorrect comment**: `pages.yml:7` asserts "The repo's root
index.html is the web-admin SPA — Vite needs it there". That is false. Fix the
comment and remove the orphan.

## P6-4 — Stale user-facing docs

`README.md`:

- **The channel table is entirely wrong.** It lists `runtime`, `a2a`, `telegram`,
  `exec`. The real set (`core/constants/channels.js`) is `telegram, cli, routine,
  api, web, web_sidebar, web_code, deck, desktop, code`. Only `telegram` overlaps,
  and the README gives an example command using a channel that does not exist.
- Says "Requires Node.js 20+" while `package.json` says `>=18` and CI uses 22.
- Line 42 says runtime state lives in `~/.apx/`; line 80 says "The session and
  memory land in `.apc/`". Same file, two answers.
- Calls the super-agent "Roby", contradicting `AGENTS.md` rule 4 ("super-agent is a
  mode, not a persona name") and the code's `"APX"` default.
- Lists 4 runtimes; there are 8. Omits groq/openrouter from engines — which is what
  this project's own `.apc/config.json` actually uses as its fallback chain.
- No mention of profiles, tasks, inbox, deck, desktop, voice, TUI, ACP, routines,
  organization, artifacts, integrations — i.e. most of what APX now is.

`SECURITY.md` cites `src/daemon/tools/fetch.js`; `src/daemon/` does not exist (it is
`src/core/http-tools/fetch.js`).

## P6-5 — A glossary

No glossary exists anywhere (`grep -ril "glossary\|glosario"` → zero hits). The
repo has genuinely confusing term pairs and an agent has nowhere to resolve them:

- `persona` (visible agent name, `identity.json`) vs **agent profile** (installable
  package, `core/profiles/`) vs config profile
- `engine` (LLM adapter) vs `provider` (the key in `provider:model`) vs `runtime`
  — which has **four senses**: external coding CLI, `core/runtime-skills/`,
  `core/runtimes/detect.js`, and the `runtime` MCP scope
- `channel` (surface) vs `mode` (voice) — stated twice, both outside the truncated
  window
- `APC` vs `APX` — never defined in `AGENTS.md`
- Undefined but used in code: **"Pieza 2/3/4"** (Spanish, in 16 places across
  `core/memory/*` headers as if it were a known decomposition), "agent vault",
  "deck", "actor", "broker", "inspector"

## P6-6 — Consistency odds and ends

- `docs-internal/` is tracked while its siblings `spec/` and `qa/` are deliberately
  gitignored as "internal, local only". Pick one policy.
- `docs-internal/secretary/99-handoff.md` says PR #41 is not merged; it is.
- `src/skills/` is a third identical copy of `apc-context/SKILL.md` that the sync
  script does not know about and `package.json` `files` does not ship — an orphan
  from an earlier layout.
- `src/core/agent/skills/loader.js:1` — the header comment's first line is a stale
  filename (`// daemon/skills-loader.js`).
- Spanish user-facing strings in otherwise-English modules bypass `core/i18n/`:
  `tools/registry.js:383`, `handlers/discover-tools.js:58`,
  `agent/channels/voice-context.js:29-43`, `handlers/call-runtime.js:377-434`,
  `integrations/plugins/asana.js:140-142`, `channels/telegram/ask.js:164`.
- `qa/` is pinned to v1.36.0 (40 minor versions behind) and entirely in Spanish,
  unlike every other doc. Either refresh or retire it.
