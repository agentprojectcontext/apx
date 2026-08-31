# 003 — Web admin lives in this repo; Android (SO) does not

**Date**: 2026-05-27
**Status**: partly superseded (see the amendment at the end)

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

**Amended 2026-08-31 — the Android half of this decision was reversed in
practice, and three of the paths above were never built.**

What held: the web admin does live at `src/interfaces/web/`, as its own pnpm
workspace with its own lockfile, and the daemon serves its `dist/`.

What did not:

- **Android is in this repo after all**, at `src/interfaces/android/` — a full
  Gradle project (`build.gradle`, `gradlew`, `app/`) for the native `/mobile`
  shell and the floating mascot. The "different toolchain, ugly CI" concern was
  real but was resolved differently: the Gradle build is simply not wired into
  `preflight` or CI at all, so the two toolchains never meet. Nothing named
  `apx-so` exists. See [`android.md`](../android.md).
- **`plugins/remote.js` and `api/remote.js` were never written.** Pairing and
  the WS bridge live in `host/daemon/api/pairing.js` and the shared WS hubs.
- **`lib/apx-client.ts` was never written**, and the SDK-extraction idea it was
  a step toward is not on the table. The panel's client is `src/lib/api/*` —
  one file per resource over a single typed `http.ts` — which turned out to be
  the better shape and is now a reference implementation in
  [`architecture.md`](../architecture.md).

The decision is left standing rather than deleted because its *web* half is
still the reason `src/interfaces/web/` is laid out the way it is. Read the
Android half as history.
