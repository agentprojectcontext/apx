---
name: apx-mcp
description: Register, list, debug, scope MCP servers in APX. Load BEFORE adding any MCP — three scopes (shared/runtime/global) with different commit and secrecy semantics. Triggers: 'add MCP', 'apx mcp', 'MCP scope', 'MCP failing', 'list MCPs'.
---

# apx-mcp

APX exposes MCP servers via three scopes; resolution priority **runtime > shared > global**, conflicts via `apx mcp check`:

| Scope | File | Committed? | Secrets OK? | When |
|---|---|---|---|---|
| `shared` | `<repo>/.apc/mcps.json` | yes | **no** | Team-wide (filesystem, brave, github public) |
| `runtime` | `~/.apx/projects/<apxId>/mcps.json` (chmod 0600) | no | yes | Per-project — tokens, machine-specific endpoints |
| `global` | `~/.apx/mcps.json` | n/a | yes | Machine-wide, not tied to a project |

## Concrete CLI calls

```bash
# List (defaults to all scopes)
apx mcp list --project iacrmar
apx mcp list --scope runtime --project iacrmar
apx mcp list --scope shared  --project iacrmar
apx mcp list --scope global

# Inspect sources and conflicts
apx mcp check --project iacrmar

# Add — shared (commit to repo)
apx mcp add filesystem --command npx --project iacrmar \
  -- -y @modelcontextprotocol/server-filesystem .

# Add — runtime (per-project, local, secrets safe)
apx mcp add github --scope runtime --project iacrmar \
  --command npx --env GITHUB_TOKEN=ghp_xxx \
  -- -y @modelcontextprotocol/server-github

# Add — global (machine-wide)
apx mcp add brave --scope global \
  --command npx --env BRAVE_API_KEY=BSAxxx \
  -- -y @modelcontextprotocol/server-brave-search

# Remove (pass --scope when not in default: shared inside APC project, else global)
apx mcp remove filesystem --project iacrmar
apx mcp remove github     --scope runtime --project iacrmar

# Toggle (defaults to owning scope)
apx mcp enable  filesystem --project iacrmar
apx mcp disable filesystem --project iacrmar

# Discover tools — list catalog, then inspect one tool's schema
apx mcp tools filesystem                     # table: tool name + description
apx mcp tools filesystem read_file           # params (types, required) + run example
apx mcp tools filesystem --json              # raw JSON with full inputSchema

# Call a tool through the daemon
apx mcp run filesystem read_file '{"path":"README.md"}'
```

## Scope decision tree

1. **Has secrets/tokens?** → `runtime`. Always.
2. **Part of project's shared dev environment?** → `shared` (committed).
3. **Used across all your projects?** → `global`.

Default if unclear: `shared` inside an APC project, `global` outside.

## Command shapes by transport

```bash
# stdio MCP (most common — npx, uvx, node, python)
apx mcp add <name> --command npx -- -y <package-or-flag-list>
apx mcp add <name> --command uvx -- <python-cli-name>
apx mcp add <name> --command python -- /abs/path/to/server.py

# Env vars (one --env per var)
apx mcp add <name> --command npx \
  --env GITHUB_TOKEN=ghp_xxx \
  --env GITHUB_OWNER=manuel \
  -- -y @modelcontextprotocol/server-github
```

Everything after `--` is forwarded verbatim as args. Quote carefully.

## Anti-examples

```bash
# DON'T put tokens in shared scope — it commits.
apx mcp add github --scope shared --env GITHUB_TOKEN=ghp_xxx ...
# ↑ Token ends up in .apc/mcps.json in your repo. Use --scope runtime.

# DON'T remove from the wrong scope — daemon returns 409 with the right scope.
apx mcp remove github          # errors if github lives in runtime

# DON'T expect IDE-foreign configs (~/.cursor/mcps.json, ~/.claude/mcps.json)
# to be removable via apx mcp remove. APX reads them advisory (source=cursor/claude)
# but won't write them. Edit the IDE config directly.
```

## Debugging

```bash
apx mcp check --project iacrmar      # scopes seen + which files exist
apx mcp tools <name>                 # spawn server + list its tools (proves init works)
apx mcp logs <name>                  # spawn/init event log + stderr tail
apx mcp run <name> <tool> '{...}'    # call a tool for real
apx log -f                           # tail unified log for spawn errors
```

"Doesn't show tools" = command failed to start (missing env vars, package not found) or crashed during initialize. `apx mcp logs <name>` shows the stderr tail; the unified log has the rest.

Standard workflow to use any MCP: `apx mcp tools <name>` → `apx mcp tools <name> <tool>` (copy the run example) → `apx mcp run <name> <tool> '<json>'`.

## Don't

- Don't mix scopes for the same MCP name unless you want shadowing — highest priority wins, others stay invisible.
- Don't edit `~/.apx/projects/<id>/mcps.json` by hand; use `apx mcp add --scope runtime` (the file is chmod 0600 — CLI preserves it).
- Don't put tokens via `--env KEY=` inline if shell history is public. Set them in your shell first, then `--env KEY=$KEY`.
- Don't forget to `apx daemon reload` after hand-editing JSON. `apx mcp` does this for you.
