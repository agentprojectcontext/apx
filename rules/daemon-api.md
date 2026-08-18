# Daemon HTTP API & plugins

> Deep dive for [`AGENTS.md`](../AGENTS.md). The always-read constraints are
> rules **9** (adding a route) and **15** (never block/kill the daemon). This is
> the structure to follow for anything under `src/host/daemon/`.

## Anatomy of a route file

```js
// src/host/daemon/api/<x>.js
import { asyncRoute } from "./shared.js";
import { doThing } from "#core/stores/<x>.js";

export function register(api, ctx) {
  api.post("/things/:id", asyncRoute(async (req, res) => {
    const out = await doThing(req.params.id, req.body);   // ← core does the work
    if (!out) return res.status(404).json({ error: "not found" });
    res.json(out);                                        // ← shape the response
  }));
}
```

- Mount it in `buildApi()` (`host/daemon/api.js`) **before** the 404 catch-all.
- **Every data route lives under `/api`** structurally: `api/prefix.js` adds the
  prefix at mount time, so route paths are written root-relative. Never
  hand-write `/api/...` inside a route file. The SPA fallback (`api/web.js`)
  steps aside for `/api` only — when you add a client route, keep
  `isKnownSpaRoute` in sync so unknown routes 404.
- **Auth follows the same seam.** `/api` needs a bearer (except `/api/health`,
  `/api/pair/*`, `/api/admin/web-token`, which guard themselves); every GET
  *outside* `/api` is public, because out there nothing exists but the panel —
  hashed bundle assets and client-router paths, all resolving to the same
  public `index.html`. That includes routes the router does not know: they must
  reach the SPA fallback to get the shell with a 404, or a typo'd URL answers
  401 and the styled NotFound screen never renders. Do not re-gate this on
  `isKnownSpaRoute` (`api/shared.js`); non-GET methods outside `/api` still
  need a token.
- **Wrap EVERY async handler in `asyncRoute()`.** `api` is a bare Express
  router: an `await` that rejects outside a `try` in an unwrapped handler is an
  unhandled rejection and kills the daemon — taking the SPA, Telegram polling
  and voice with it. This is the single most-violated rule in the codebase
  (survey: 43 of 50 async handlers unwrapped, 6 with naked awaits). Wrapping is
  not optional and a `try/catch` inside the handler is not a substitute for the
  wrapper.
- Errors: `return res.status(<real code>).json({ error })`. Never throw a bare
  string; never 200 an error.
- New I/O on a request path uses `fs/promises`; sync I/O is boot-only.

## The thinness test

An `api/*.js` file is an adapter: parse input → call ONE core function → shape
output. If a route file contains any of the following, the logic is misfiled —
move it to `core/` and call it:

- a state machine or module-level mutable store (`new Map()` of sessions)
- a `spawn`/`spawnSync`/`execSync` of anything (git, unzip, osascript)
- a regex over file contents or model output
- a business rule (dedupe policy, config-consistency GC, permission widening)
- cross-store aggregation (stats built from tasks + routines + messages)
- a prompt string or user-facing sentence (rule 12/13 — prompts live in
  `core/agent/prompts/`, strings come from core/i18n or the model)

The one sanctioned exception: **pure process orchestration that only makes
sense next to the daemon** (e.g. `deck-exec.js`, or an OS folder-picker) stays
in `host/daemon/` as its own module — not inline in a route file.

Good examples to copy: `api/desktop.js` (117 lines, same core helpers as the
CLI), `api/deck.js`, `api/artifact-preview.js`.
Counter-examples (do not copy; queued for extraction in the survey):
`api/skills.js` (a package manager in a route file), `api/voice.js` (the whole
STT→agent→TTS pipeline), `api/runtimes.js` (100-line orchestration),
`project-config.js` (pure domain functions stranded in host).

## Checklist for a new route

1. `register(app, ctx)` exported; mounted in `buildApi()` before the 404.
2. Every async handler wrapped in `asyncRoute()`.
3. Real status codes + `{ error }` bodies.
4. Domain work is a named core function that the CLI could also call.
5. Test in `tests/`: drive it through `buildApi()` + `app.listen(0)` (see
   [`testing.md`](testing.md)). Dangerous surfaces (file writes, shell, chmod,
   messaging a human) get a direct test.
6. If the CLI or web exposes the same operation, they call the SAME core
   function — check the survey's rule-8 ledger before writing a second copy.

## Plugins

Plugins (`plugins/telegram/`, `plugins/desktop/`) are **lifecycle + I/O only**:
start/stop, polling/socket management, offset persistence, and a thin send
surface. Per-update domain logic — dispatching, reply shaping, ask-callbacks,
turn accumulation, channel formatting — lives in `core/channels/<ch>/` (telegram
is the model). If a plugin grows a dedupe buffer, a segment state machine, or a
hardcoded user-facing string, that's core code in the wrong layer.

Every surface that completes a turn logs it via `appendGlobalMessage({channel,…})`
(`core/stores/messages.js`) — a channel that doesn't log is invisible
cross-channel. Write the envelope once per plugin, not once per message type.

## WebSockets

WS hubs live next to their feature (`desktop-ws.js`). The upgrade handler MUST
authenticate the bearer token before accepting — copy `desktop-ws.js`, which is
the tested pattern (stale-token breakage after pulls is a known historical bug).
