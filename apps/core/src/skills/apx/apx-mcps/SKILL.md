---
name: apx-mcps
description: Add, change, test or remove an MCP server for APX's agents with the `apx mcps` command, including one the owner pastes as JSON (mcpServers) and the API keys it needs. Use it whenever the owner asks to install, connect, configure, rename or fix an MCP server.
---

# MCP servers in APX

APX keeps its MCP servers in its own store. They go in only two ways: the `apx mcps` command (run it with `shell`) or
the app's [Resources › MCP](apx:resources/mcp). **Never write a JSON file for it.** A server written by hand anywhere
never reaches you:

- not `~/.apx/mcps.json`, `~/.apx/vars.json` or anything else directly in `~/.apx/`: that is the old APX (v1), which
  this APX does not read, and its files are not yours to change;
- not APX's own folder or database, not `~/.claude.json`, `~/.cursor/mcp.json` or Claude Desktop's config.

## Where it goes

| The owner wants | Command |
|---|---|
| It for all their agents (the usual case; it may use variables) | `apx mcps add <name> …` |
| It only inside one project, saved in the repo (`.apc/mcps.json`) | `apx mcps add <name> --project <project-id> …` |

A project's server is committed with the repo, so it **cannot use variables** (`secret://`): anything with a key is
one of the owner's own servers. One of the owner's servers is turned off inside a project with
`apx mcps off <name> --project <project-id>` (and back with `on`). `apx projects` lists project ids.

## Add one

```bash
# Remote server (a URL): its headers with --header, then -- and the URL
apx mcps add magic --header "x-api-key=secret://MAGIC_API_KEY" -- https://mcp.example.com/mcp

# Local command: its environment with --env, then -- and the command with its arguments
apx mcps add github --env GITHUB_TOKEN=secret://GITHUB_TOKEN -- npx -y @modelcontextprotocol/server-github
```

- Name: letters, digits, `_` and `-`, starting with a letter or digit, at most 41 characters. Lowercase reads best.
- `--header` and `--env` repeat, one `NAME=value` each. Quote them in the shell.
- A key goes in `--env` or `--header` as `secret://NAME`, never in the command's arguments (they show in the process
  list) and never as the real value.
- `secret://NAME` works as the whole value or inside text: `"Authorization=Bearer secret://NOTION_TOKEN"`.

## From JSON the owner pasted

Each entry under `mcpServers` (or `servers`) is one `apx mcps add`, with the entry's key as the name:

| In the JSON | In the command |
|---|---|
| `url` (any `type`: http, sse, streamable-http) | `-- <url>` |
| `headers` | one `--header NAME=value` each |
| `command` + `args` | `-- <command> <args…>` |
| `env` | one `--env NAME=value` each |

Values:

- A placeholder (`${VAR}`, `${env:VAR}`, `${var.VAR}`, `<YOUR_API_KEY>`, `your-key-here`) becomes `secret://VAR`, with
  the variable name the owner gave or, if none, an UPPER_SNAKE name of the service (`MAGIC_API_KEY`).
- A real key the owner pasted also becomes `secret://NAME`; the value itself is stored as a variable (apx-variables),
  never written into the server.
- APX's form is `secret://NAME`. `${var.NAME}` is v1's and means nothing here.

## The variable it needs

Check what exists with `apx secrets list`. If the variable is missing:

- The owner will type the value (the usual case, and what "I'll set the value later" means): add the server with
  `secret://NAME` anyway and send them [Resources › Variables](apx:resources/variables) to create `NAME`. Do not
  invent a placeholder value: a variable cannot be empty, and a fake one fails later in a confusing way.
- The owner gave you the value and asked you to store it: follow apx-variables.

Until the variable has a value the server answers with an authentication error: say so.

## Check it

```bash
apx mcps check <name>       # starts it and lists its tools, or prints the exact error
apx mcps show <name>        # its definition (variables show as secret://NAME, never their values)
apx mcps list               # every server and its state
apx mcps logs <name> -n 50  # what it printed while starting or failing
```

A server that signs in through the owner's browser (`mcp-remote`) shows `needs-sign-in` once it asked: APX does not
start it again, so tell the owner to run `apx mcps signin <name>` (or click Sign in in the panel) and finish there.

A change is live from the next message: nothing restarts. Its tools are reached with `mcp_search` and `mcp_call`
from then on, not in the turn that added it.

## Hand a file to a tool

Put the file in the argument the tool reads it from, as its media id (`med_…`, a drawing or an attachment of this
chat) or `apx-file:<path>` (a file in your folders). APX sends it the way that field takes it: base64 to a remote
server (an `http(s)` URL), a real path to a local one. Pick the field by the server: an image for a remote server
goes in its base64 field; a `path` field only works on a server that runs on this computer. A field that wants a
public `url` cannot take your file: APX never publishes the owner's files. For a video too big for base64, use the
service's own upload (an upload link from one of its tools, then `curl -T` from your temp folder) or ask the owner
for a link. To use a drawing with shell or a skill, copy it out first: `file_write` with `media` and a path in your
temp folder.

## Change, rename, remove

```bash
apx mcps set <name> --header "x-api-key=secret://NEW_NAME"   # changes only what you pass, keeps the rest
apx mcps set <name> --env LOG_LEVEL=debug
apx mcps rename <name> <new-name>
apx mcps copy <name> <new-name> --env ACCOUNT=secret://OTHER_KEY   # a second one with other variables
apx mcps rm <name>
```

A server that comes with an extension is changed in that extension, not here. A project's `.apc/mcps.json` written
by someone else needs the owner's approval before it runs: that approval is theirs, in
[Resources › MCP](apx:resources/mcp), never yours.

## Tell the owner

What you added, with which name, whether it is theirs (global) or one project's, what `apx mcps check` said, and what
is left for them (a variable to fill, with the link). If a command failed, quote its error.
