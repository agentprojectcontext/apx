# 003 — Web admin lives in this repo; Android (SO) does not

**Date**: 2026-05-27
**Status**: accepted

## Context

Two new surfaces are planned:
- A web admin panel for APX (settings, channels, projects, routines, sessions, models, MCPs).
- An Android client (`apx-so`) to control the daemon from a phone.

Question: same monorepo, or separate repos?

## Decision

- **Web admin → same monorepo**, under `src/interfaces/web/`. Reasons:
  - Same toolchain (Node + pnpm + TypeScript).
  - Imports `src/core/` types directly with relative paths — no SDK indirection until we have a reason.
  - Daemon can serve it from a static directory, or it runs standalone on Vite dev for development.
  - Follows decision 001 (every surface lives under `interfaces/`).
- **Android (`apx-so`) → separate repo**. Reasons:
  - Different toolchain (Kotlin/Gradle vs Node/pnpm). Mixing makes both CIs ugly.
  - Build artifacts and dependencies are huge and unrelated.
  - The Android client communicates with the daemon over HTTP/WS — it doesn't need source-level access to `core/`.
- **The server-side of the SO bridge (auth, pairing, WS multiplexing) lives in this repo** as `src/host/daemon/plugins/remote.js` + `src/host/daemon/api/remote.js`. Android consumes it. That keeps the protocol single-sourced.

## Implementation note

Once the web admin SDK exists (`src/interfaces/web/lib/apx-client.ts`), we can extract it as a separate npm package if a third surface ever needs typed access. Not before.

## Consequences

- New folder `src/interfaces/web/` reserved for the web admin (initially a README with the plan).
- `apx-so` keeps its current repo. We will pin the bridge protocol via integration tests once it's wired.
- A future "extract SDK" task is bounded — pull only what crosses the network boundary.

## Supersedes / superseded by

None.
