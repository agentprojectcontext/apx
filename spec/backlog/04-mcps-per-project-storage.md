# 04 — MCPs per-project storage + CLI

**Priority**: P1
**Size**: M
**Status**: idea

## Problem

MCP server definitions live in `.apc/mcps.json` (repo-side, committed alongside the project). That's fine for shared team MCPs. But APX also needs **per-project runtime MCPs** that don't pollute the repo — local tokens, user-specific endpoints, experimental servers.

Today there is no clean place for those. Users either commit the secrets into `.apc/mcps.json` (bad) or hand-edit a global `~/.apx/mcps.json` (loses project scope).

## Desired model

Three MCP sources, in resolution order (highest wins, conflicts surfaced):

1. **Project-runtime** — `~/.apx/projects/<apxId>/mcps.json`. Per-project, machine-local, never committed. New.
2. **Project-shared** — `.apc/mcps.json` in the repo. Same as today.
3. **Global** — `~/.apx/mcps.json`. Already exists.

The registry already accepts multiple sources (`src/core/mcp/sources.js`). Add the project-runtime source and resolve conflicts by source priority, exposing them in `apx mcp check`.

## CLI surface

```bash
# Today (works against .apc/mcps.json — keep behavior):
apx mcp add <name> --command <cmd> --args …
apx mcp remove <name>
apx mcp list
apx mcp check

# New: explicit scope flag
apx mcp add <name> --scope runtime --project iacrmar --command …
apx mcp add <name> --scope global --command …
apx mcp add <name> --scope shared --command …            # default for repo-rooted commands
apx mcp list --scope all                                 # default
apx mcp list --scope runtime --project iacrmar
```

When `--scope` is omitted: `shared` if cwd is inside an APC project, else `global`.

## Daemon storage

- New helper `core/mcp/sources.js → readRuntimeMcps(apxId)` / `writeRuntimeMcps(apxId, json)`.
- `core/mcp/runner.js → McpRegistry` aggregates the three sources with priority + conflicts.
- `host/daemon/api/mcps.js` learns about scope: `POST /projects/:pid/mcps?scope=runtime` writes to the new location; existing routes default to `shared` for back-compat.

## Done criteria

- [ ] `~/.apx/projects/<apxId>/mcps.json` is the third recognized source.
- [ ] `apx mcp list --scope all` shows source per entry.
- [ ] `apx mcp add … --scope runtime --project X` writes there.
- [ ] `apx mcp check` reports conflicts (same name in two sources).
- [ ] Existing `.apc/mcps.json` behavior unchanged for projects that only use it.
- [ ] Tests cover the resolution order.

## Open question

Decide whether MCP tokens / secrets in runtime scope should be stored encrypted at rest (macOS keychain) or plain JSON. Default for v1: plain JSON with `~/.apx/projects/<id>/mcps.json` having `0600` perms. Encryption is a follow-up if requested.

## Owner

Agent C (paralelo).
