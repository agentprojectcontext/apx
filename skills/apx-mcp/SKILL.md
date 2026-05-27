---
name: apx-mcp
description: How to register, list, debug, and scope MCP servers in APX. Use BEFORE adding any MCP — three scopes (shared/runtime/global) with different commit and secrecy semantics.
---

# apx-mcp

APX exposes Model Context Protocol (MCP) servers to agents. Three scopes, each in a different file with different rules:

| Scope | File | Committed? | Secrets OK? | When |
|---|---|---|---|---|
| `shared` | `<repo>/.apc/mcps.json` | yes | **no** | Team-wide MCPs (filesystem, brave, github public) |
| `runtime` | `~/.apx/projects/<apxId>/mcps.json` (chmod 0600) | no | yes | Per-project local — tokens, machine-specific endpoints |
| `global` | `~/.apx/mcps.json` | n/a | yes | Machine-wide — not tied to any project |

Resolution priority when a name appears in more than one: **runtime > shared > global**. Conflicts surface in `apx mcp check`.

## Concrete CLI calls

```bash
# List (all scopes, this is the default)
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

# Add — global (machine-wide, not tied to a project)
apx mcp add brave --scope global \
  --command npx --env BRAVE_API_KEY=BSAxxx \
  -- -y @modelcontextprotocol/server-brave-search

# Remove (--scope optional; defaults to where the MCP lives)
apx mcp remove filesystem --project iacrmar
apx mcp remove github     --scope runtime --project iacrmar

# Toggle (modifies whichever scope owns it)
apx mcp enable  filesystem --project iacrmar
apx mcp disable filesystem --project iacrmar

# Call a tool through the daemon (useful for debugging)
apx mcp tools <name>                            # list tools the server exposes
apx mcp run filesystem read_file '{"path":"README.md"}'
```

## When the user asks for a new MCP

Decision tree:
1. **Has secrets / tokens?** → `runtime` scope. Always.
2. **Is part of the project's shared dev environment?** → `shared` (committed).
3. **Used across all your projects?** → `global`.

Default if none is obvious: `shared` when inside an APC project, `global` outside.

## Common command shapes by transport

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

Anything after `--` is forwarded verbatim as args to the command. Quote carefully.

## Anti-examples

```bash
# DON'T put tokens in shared scope. It commits.
apx mcp add github --scope shared --env GITHUB_TOKEN=ghp_xxx ...
# ↑ Token ends up in .apc/mcps.json in your repo. Use --scope runtime.

# DON'T remove an MCP from the wrong scope.
apx mcp remove github          # if github lives in runtime, this errors with a hint
# ↑ Daemon returns 409 with the right scope to use.

# DON'T expect IDE-foreign configs (~/.cursor/mcps.json, ~/.claude/mcps.json) to be
# removable via apx mcp remove. APX reads them as advisory (source=cursor/claude/etc)
# but won't write them. Edit the IDE config directly.
```

## Debugging connection issues

```bash
apx mcp check --project iacrmar             # what scopes APX sees + which files exist
apx mcp tools <name>                         # forces the daemon to actually spawn the server
apx log -f                                   # tail unified log for spawn errors
```

A server that "doesn't show tools" usually means: the command failed to start (env vars missing, package not found), or the server crashed during initialize. The unified log has the stderr buffer.

## Don't

- Don't mix scopes for the same MCP name unless you actually want shadowing. The result is "the one with highest priority wins, others stay invisible."
- Don't edit `~/.apx/projects/<id>/mcps.json` by hand; use `apx mcp add --scope runtime`. The file is chmod 0600 — the CLI keeps it that way.
- Don't add tokens via `--env KEY=` inline if your shell history is public. Set them in your shell first, then `--env KEY=$KEY`.
- Don't forget to `apx daemon reload` after editing config — actually `apx mcp` does this for you, but if you hand-edited the JSON, it's manual.
