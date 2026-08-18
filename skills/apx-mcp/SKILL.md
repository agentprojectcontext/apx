---
name: apx-mcp
description: Registers, lists, runs, debugs, and scopes MCP servers in APX — the MCP entry point for agents (shared/runtime/global scopes). In an .apc project, prefer APX-managed MCPs over a built-in client. Triggers: 'add MCP', 'apx mcp', 'list MCPs', 'run an MCP tool', 'MCP failing'.
---

# apx-mcp

APX exposes Model Context Protocol (MCP) servers to agents. This is the MCP entry point: when you're in an `.apc/` project, prefer APX-managed MCPs over any built-in MCP client, because APX owns the project's scopes, secrets, and merge order. Run `apx mcp list` first to see what's already registered. (Outside an `.apc/` project, or when APX isn't installed, use your internal MCP.)

Three scopes, each in a different file with different rules:

| Scope | File | Committed? | Secrets OK? | When |
|---|---|---|---|---|
| `shared` | `<repo>/.apc/mcps.json` | yes | **no** | Team-wide MCPs (filesystem, brave, github public) |
| `runtime` | `~/.apx/projects/<apxId>/mcps.json` (chmod 0600) | no | yes | Per-project local — tokens, machine-specific endpoints |
| `global` | `~/.apx/mcps.json` | n/a | yes | Machine-wide — not tied to any project |

Resolution priority when a name appears in more than one: **runtime > shared > global**. Conflicts surface in `apx mcp check`.

## Concrete CLI calls

```bash
# List (all scopes, this is the default)
apx mcp list --project acme
apx mcp list --scope runtime --project acme
apx mcp list --scope shared  --project acme
apx mcp list --scope global

# Inspect sources and conflicts
apx mcp check --project acme

# Add — shared (commit to repo)
apx mcp add filesystem --command npx --project acme \
  -- -y @modelcontextprotocol/server-filesystem .

# Add — runtime (per-project, local, secrets safe)
apx mcp add github --scope runtime --project acme \
  --command npx --env GITHUB_TOKEN=ghp_xxx \
  -- -y @modelcontextprotocol/server-github

# Add — global (machine-wide, not tied to a project)
apx mcp add brave --scope global \
  --command npx --env BRAVE_API_KEY=BSAxxx \
  -- -y @modelcontextprotocol/server-brave-search

# Remove (pass --scope when the MCP isn't in the default scope:
# shared inside an APC project, else global)
apx mcp remove filesystem --project acme
apx mcp remove github     --scope runtime --project acme

# Toggle (defaults to the scope that owns the MCP)
apx mcp enable  filesystem --project acme
apx mcp disable filesystem --project acme

# Call a tool through the daemon (useful for debugging)
apx mcp run filesystem read_file '{"path":"README.md"}'
```

## When the user asks for a new MCP

Decision tree:
1. **Has secrets / tokens?** → `runtime` scope. Always.
2. **Is part of the project's shared dev environment?** → `shared` (committed).
3. **Used across all your projects?** → `global`.

Default if none is obvious: `shared` when inside an APC project, `global` outside.

## Command shapes by transport

Two transports. `--command` = local process (stdio), `--url` = remote endpoint (http).
There is no third option, and no flag outside this list — if a shape isn't here,
run `apx help mcp add` instead of guessing.

```bash
# stdio MCP — a local process (npx, uvx, node, python)
apx mcp add <name> --command npx -- -y <package-or-flag-list>
apx mcp add <name> --command uvx -- <python-cli-name>
apx mcp add <name> --command python -- /abs/path/to/server.py

# stdio env vars (one --env per var)
apx mcp add <name> --command npx \
  --env GITHUB_TOKEN=ghp_xxx \
  --env GITHUB_OWNER=manuel \
  -- -y @modelcontextprotocol/server-github

# http MCP — a remote streamable-HTTP endpoint. No command, no npx, no install.
apx mcp add <name> --url https://mcp.example.com/mcp --scope runtime

# http with auth headers (repeatable; "Name: value" or Name=value both parse)
apx mcp add <name> --url https://mcp.example.com/mcp --scope runtime \
  --header "Authorization: Bearer $TOKEN" \
  --header "X-Workspace: acme"
```

Everything after `--` is forwarded verbatim as args to a stdio command. Quote carefully.
`--env` and `--` args are stdio-only; `--header` is http-only — mixing them errors.

Remote servers almost always carry a token, so they belong in `--scope runtime`
(chmod 0600, never committed). Read the token from the environment rather than
pasting it: `--header "Authorization: Bearer $TOKEN"`.

## After adding: prove it works

```bash
apx mcp tools <name>     # spawns/connects and lists tools — this is the real check
apx mcp logs <name>      # if the above is empty or errors: request/response log
```

`apx mcp add` only writes JSON — it never contacts the server. An MCP that "was
added fine" but has no tools is a failed connection, not a successful install.

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
apx mcp check --project acme             # what scopes APX sees + which files exist
apx mcp tools <name>                         # list a server's tools (proves it spawned + initialized)
apx mcp tools <name> <tool>                  # one tool's input schema + a ready-to-run example
apx mcp logs <name>                          # spawn/init log + stderr tail for this server
apx mcp run <name> <tool> '{...}'            # spawn the server and call a tool for real
apx log -f                                   # tail unified log for spawn errors
```

A server that "doesn't show tools" usually means: the command failed to start (env vars missing, package not found), or the server crashed during initialize. `apx mcp logs <name>` has the spawn/init log and stderr tail — that's the fastest way to see why.

## Don't

- Don't mix scopes for the same MCP name unless you actually want shadowing. The result is "the one with highest priority wins, others stay invisible."
- Don't edit `~/.apx/projects/<id>/mcps.json` by hand; use `apx mcp add --scope runtime`. The file is chmod 0600 — the CLI keeps it that way.
- Don't add tokens via `--env KEY=` inline if your shell history is public. Set them in your shell first, then `--env KEY=$KEY`.
- Don't forget to `apx daemon reload` after editing config — actually `apx mcp` does this for you, but if you hand-edited the JSON, it's manual.
