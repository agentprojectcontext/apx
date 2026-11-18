---
name: apx-extensions
description: Build, pack and install an APX extension, one folder with an apx-extension.json that brings skills, MCP servers (including new tools you write or a script the owner already has), settings and keys the owner types once, ready-made agents, an app on a TV or phone, and an optional plugin. Use it when the owner asks for a new tool or capability APX does not have, to turn their script or app into an extension, to package skills or servers together, or for an APX extension or plugin.
---

# Extensions in APX

An extension is a folder APX can read without running anything: `apx-extension.json` plus the files it names. It
installs **off**; turning it on approves exactly those files. You build it, check it and install it with the
`apx extensions` command (through `shell`); the owner sees it in [the Marketplace](apx:marketplace) (one extension:
`apx:marketplace/extensions/<id>`).

## Pick the smallest thing first

| The owner wants | Make |
|---|---|
| An MCP server that already exists (npm, a URL) | `apx mcps add` (apx-mcps): no extension |
| Know-how for agents | A skill (apx-skills): no extension |
| A new tool that does not exist anywhere (wrap an API, a local script, a calculation) | An extension with its own MCP server |
| The owner's own script (`.mjs`) or app, for their agents | An extension around it (below) |
| Skills, servers and routines that travel together or are shared | An extension |
| Code that watches APX's events or adds context to the owner's turns | An extension with a `plugin` |

## The folder

Build it in your temp folder (or in a project if the owner wants it kept in a repo):

```
northwind-crm/
  apx-extension.json
  skills/crm-lookup/SKILL.md   # each skill: a folder with a SKILL.md (frontmatter name + description)
  server.mjs                   # its own MCP server, if it brings new tools
  plugin.mjs                   # only with a plugin
```

## `apx-extension.json`

Unknown keys are refused.

```json
{
  "id": "northwind_crm",
  "name": "Northwind CRM",
  "version": "1.0.0",
  "description": "Look up customers and open deals in Northwind's CRM.",
  "skills": "skills",
  "mcp": {
    "crm": { "command": "node", "args": ["./server.mjs"], "env": { "API_KEY": "secret://api_key" } },
    "docs": { "url": "https://mcp.example.com/docs", "headers": { "Authorization": "Bearer secret://api_key" } }
  },
  "routines": [
    {
      "name": "Monday pipeline",
      "schedule": { "kind": "cron", "cron": "0 9 * * 1" },
      "prompt": "Use the crm-lookup skill to list deals that did not move last week. Answer SKIP if none."
    }
  ],
  "secrets": [{ "name": "api_key", "label": "CRM API key", "url": "https://example.com/settings/keys" }]
}
```

| Field | Rules |
|---|---|
| `id` | Lowercase letters, digits, `_` and `-`, starting with a letter or digit, at most 20. |
| `name`, `version` | Required. `description` up to 500 characters. |
| `skills` | A folder of skill folders, relative to the extension. |
| `mcp` | Servers by name (letters, digits, `_`; no `-`; at most 20); once on, each shows as `<id>-<name>`. `command` + `args` + `env`, or `url` + `headers`. A server starts in the extension's folder, so `"args": ["./server.mjs"]` works. |
| `secret://name` | One of the extension's own `secrets`, never the owner's variables and never a real value. |
| `routines` | Templates the owner adds from Routines. `schedule`: `{ "kind": "cron", "cron" }`, `{ "kind": "every", "minutes" }` (5 or more) or `{ "kind": "once", "at" }`. A routine that answers `SKIP` tells nobody. |
| `secrets` | Up to 10: `name` (same rule as servers), `label`, optional `url` where to get it. |
| `plugin` | See below. |

## Manifest 2 (a whole product)

Add `"manifest": 2` when it needs more than skills, servers and secrets:

- `settings`: typed values the owner sets (`string|number|boolean|directory|file`, `options`, `default`, `required`).
  `sensitive: true` keeps one in the secret store (`secret://name`); a plain one fills `setting://name` in a server.
  `"generate": "random"` on a sensitive string creates a connection key at install; never ask the owner for one.
- `agents` (`id`, `name`, `description`, `prompt`) and `apps` (`.apxart` files): offered on its page, added by the owner.
- `pages` (`id`, `title`, `entry` HTML): its own settings screen, sandboxed with no network; it talks through
  `window.apx.settings.get()/set(values)`, `apx.secrets.has(name)/set(name, value)` and `apx.close()`.
- `hosts`, `platforms` (`darwin|linux|win32`) and `companion` (an app on a TV, phone or computer: `name`, `platform`,
  `file` or `url`, `steps`, `pairing: {with: "apx"}` or `{with: "extension", server, tool}` for its own pairing tool).
- `min_apx` (`"2.18.0"`) when it needs a newer APX: an older one says so instead of adding it. Its
  `apx-listing.json` can name its `tools` (`name`, `description`) so the owner sees them before adding it.

Set values from the terminal with `apx extensions set <id> name=value` (`name=-` reads a sensitive value from stdin).

## A new tool: its own MCP server

`node_modules` is not copied when installing, so a server inside an extension must need no packages. Start from the
template that comes with this skill: `load_skill apx-extensions file=server-template.mjs`, save it as `server.mjs`,
replace its `TOOLS` (name, description, JSON schema of the arguments, `run`). It speaks MCP over stdio by itself,
reads keys from `process.env` (given by the manifest's `env` with `secret://`) and can use `fetch`. Try it before
installing:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node server.mjs
```

A tool's description says what it does and when to use it, in one or two sentences: that is all an agent sees.

## From a script or an app the owner already has

Keep their code as it is and wrap it: their `.mjs` becomes the extension's server (`"command": "node", "args":
["./server.mjs"]`) if it already speaks MCP over stdio; otherwise start from the template and call their code from its
tools. What it needs to know goes in `settings` (an address, a folder) and reaches it through `env`
(`setting://name`, `secret://name`), never as a value written in the folder. An app on another device (a TV, a phone)
goes in `companion`: its file (an `.apk`) in the folder, the steps to install it, and how it pairs: `{"with": "apx"}`
when the app pairs with APX like the phone app, or `{"with": "extension", "server", "tool"}` when one of its own tools
gives the code (the panel shows that tool's answer; `{"code", "address"}` as JSON reads best). A connection key the app
and the server share is a sensitive setting with `"generate": "random"`. The docs page "Bring your app to an
extension" walks through the Android TV one.

## A plugin (only when files are not enough)

```json
"plugin": { "entry": "plugin.mjs", "observe": ["task.updated"], "context": false, "network": false }
```

```js
// plugin.mjs: runs in its own process; reads only its folder, writes only api.dataDir.
export default function activate(api) {
  api.on("task.updated", (event) => api.log(`task ${event.task?.id} changed`));
  api.context(async ({ thread, agent, text }) => ""); // only with "context": true; "" adds nothing
}
```

- `observe`: any of `thread.updated`, `message.created`, `run.updated`, `task.updated`, `notification.updated`.
- `api.secrets.<name>` holds its declared secrets; `api.fetch` reaches the internet only with `"network": true`, the
  local network only with `"local_network": true` as well, and never this computer. It cannot start processes or call
  APX. What `context` returns reaches agents as outside data.

## Check, pack, install, turn on

```bash
apx extensions inspect <folder|file.apxext|https-url>   # what it would bring; nothing is installed
apx extensions pack <folder> [file.apxext]              # one file to share: <id>-<version>.apxext
apx extensions install <folder|file.apxext|https-url>   # copied in, off
apx extensions                                          # installed ones, on or off, and secrets missing
apx extensions rollback <id>                            # back to the version installed before (again: forward)
apx extensions catalog                                  # what APX's catalog (and the owner's) offer, with addresses
apx extensions install catalog:<catalog>/<id>           # one from a catalog the owner added (its address above)
apx extensions catalogs add <owner/repo|url|folder>     # add a catalog for the owner (APX or Claude Code format)
```

To hand it to someone else, `apx extensions pack` it: the same folder always packs into the same file, checked first
and with what a Mac adds, `.git` and `node_modules` left out. A double-click installs it. It is refused whole if it holds links, encrypted entries, paths outside the
folder, more than 2,000 files or 50 MB unpacked (20 MB packed). It shows as **Official** only when APX's catalog lists
that id and version with exactly those files; yours is **Third party**, which is fine for your own.

Turning it on is the owner's decision, because it approves what the folder runs: ask, or send them
[its page](apx:marketplace/extensions/<id>). With their OK: `apx extensions on <id>`. Its keys are typed by the
owner in that screen (or, if they gave you the value to store: `printf %s "$VALUE" | apx extensions secret <id>
<name>`).

Changing the folder after installing does nothing: install it again. Another version keeps the one before; it turns
off until the owner turns it on, unless it is official and asks for nothing more. Remove with `apx extensions rm <id>`.

## Before you hand it over

- `inspect` lists every skill, server, routine, setting and secret you meant, and the server answers `tools/list`.
- If it has an app, its pairing works from the extension's page once it is on.
- No real token, email, phone or personal path in any file.
- Skills and descriptions in English; each skill's `description` says when to use it.
- Tell the owner what it brings, that it is installed off, and what they need to do to turn it on.
