# 10 — util/ folder cleanup

**Priority**: P0
**Size**: XS
**Status**: idea

## Problem

`/util/` at the repo root contains four files (`filesystem.js`, `lazy.js`, `process.js`, `which.js`) that nothing in `src/` actually imports. The TUI's references to `util/` resolve to `src/interfaces/tui/util/` via `tsconfig` paths — not to the root folder. The root `util/` is a leftover from the earlier refactor.

## Decision

Delete `util/` at the repo root.

If anything claims to need it after removal, the contents can be moved into `src/core/util/` and properly exported. But verify first: a `grep -rn "../util/\|/util/" src/ tests/ scripts/` shows nothing pointing there.

## Files to touch

- Delete: `util/filesystem.js`, `util/lazy.js`, `util/process.js`, `util/which.js`, and the folder.

## Done criteria

- [ ] `util/` no longer exists at the repo root.
- [ ] `npm test` and `npm run smoke` stay green.
- [ ] No import resolution warnings.

## Owner

Agent A (paralelo — combinado con item 02).
