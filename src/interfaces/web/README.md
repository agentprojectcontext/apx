# APX Web Admin Panel

> **Status**: skeleton — not yet implemented. See [spec/backlog/08-web-admin-panel.md](../../../spec/backlog/08-web-admin-panel.md).

This is the future home of the APX web admin panel: a local-first React app that lets a user operate every part of APX — config, channels, projects, agents, routines, sessions, models, MCPs, tasks — without the CLI.

## What's here today

- `coming-soon.html` — a static placeholder. The daemon can serve it (or it can be opened directly) so users hitting `http://127.0.0.1:7430/` get a friendly explanation instead of a 404.

## What lives here later

- `package.json` — Vite + React + TypeScript + Tailwind. Added when the migration plan from the user's existing web project is on the table.
- `src/` — React app. Entry under `src/main.tsx`.
- `lib/apx-client.ts` — typed HTTP client wrapping the daemon API. Eventually extractable as a separate SDK.
- `dist/` — build output. Served by the daemon from `host/daemon/api/web.js` (not yet wired).

## Constraints

- **No Next.js.** This is a local admin tool, not a public web app. Vite is enough.
- **No Radix-based libraries.** See [decision 005](../../../spec/decisions/005-no-radix-on-web-panel.md). Component library will be HeroUI, Park UI, or hand-rolled.
- **Same-origin or token-auth only.** The daemon issues a bearer token for localhost; the panel reuses it via the existing auth flow.
- **Talks to the daemon over HTTP.** No reaching into `src/core/` from the browser — that's `host/` territory and would require a build pipeline crossing layer boundaries.

## Why this is just a skeleton

The user has an existing web project that we'll migrate selectively. Until we know which parts to port and which to drop, scaffolding a Vite app would just add code that needs to be undone.

When the migration plan arrives, this README is the first thing to update.
