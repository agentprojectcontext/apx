# 08 — Web admin panel

**Priority**: P2
**Size**: L
**Status**: specced (skeleton only)

## Goal

A local web UI to operate APX without the CLI: config, channels, projects, agents, routines, sessions, models, MCPs, tasks. Local-first — talks to the daemon over HTTP, no public exposure.

## What lands now

A skeleton folder `src/interfaces/web/` with:
- A `README.md` describing the plan and constraints (decision 005 — no Radix).
- A `coming-soon.html` static placeholder.
- Nothing else. We wait for the user to share what their existing web project does, so we know what to port vs. start fresh.

## What lands later (out of scope for the skeleton task)

- Tooling pick (Vite + React + TS, no Next).
- Component library decision (HeroUI / Park UI / hand-rolled — see decision 005).
- Routing structure.
- Auth flow: the daemon already issues a bearer token to localhost — the web panel reuses it.
- Daemon static serving: `host/daemon/api/web.js` (new) serves the built `interfaces/web/dist/` from `/`. So `apx daemon start` → open `http://127.0.0.1:7430/` → panel.

## Surface to build (eventually)

A minimal map of what the panel should cover, ordered by usefulness:

1. **Dashboard**: daemon status, engines health, active super-agent model, last messages.
2. **Projects**: list, register, edit `config.json`, see agents, sessions, conversations, tasks.
3. **Channels**: telegram channels CRUD with project/agent pinning (UI for backlog 03).
4. **Routines**: list per project, create with form, see run history, manual trigger, view logs.
5. **MCPs**: list per scope (runtime/shared/global), add/remove, debug connection.
6. **Skills**: list installed, view body, see which are active in which agent.
7. **Config**: global `~/.apx/config.json` editor with schema validation.
8. **Sessions browser**: cross-project search (backed by `/sessions/search`).

Each page = one CRUD over an existing daemon endpoint. No new daemon work, just UI.

## What we need from the user

A clear answer to: *"My existing web project has X, Y, Z — I want X and Y migrated, Z gets dropped."* Until then the skeleton stays as a placeholder.

## Done criteria (skeleton)

- [ ] `src/interfaces/web/` exists.
- [ ] `README.md` describes the plan and links back to this spec.
- [ ] `coming-soon.html` is a one-page placeholder served either standalone or via the daemon.
- [ ] `package.json` is not added yet (we will scaffold the Vite project once the user provides the migration spec).

## Owner

Self (Opus) — skeleton.
