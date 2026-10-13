---
name: apx-extensions
description: Build and install an APX extension, one folder with an apx-extension.json that brings skills, MCP servers (including new tools you write), routine templates, keys the owner types once and an optional plugin. Use it when the owner asks for a new tool or capability APX does not have, to package skills or servers together, or for an APX extension or plugin.
---

# Extensions in APX

An extension is a folder APX can read without running anything: `apx-extension.json` plus the files it names. It
installs **off**; turning it on approves exactly those files. You build it, check it and install it with the
`apx extensions` command (through `shell`); the owner sees it in [Resources › Extensions](apx:resources/extensions).

## Pick the smallest thing first

| The owner wants | Make |
|---|---|
| An MCP server that already exists (npm, a URL) | `apx mcps add` (apx-mcps): no extension |
| Know-how for agents | A skill (apx-skills): no extension |
| A new tool that does not exist anywhere (wrap an API, a local script, a calculation) | An extension with its own MCP server |
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

## Check, install, turn on

```bash
apx extensions inspect <folder>        # what it would bring; nothing is installed
apx extensions install <folder>        # copied in, off
apx extensions                         # installed ones, on or off, and secrets missing
```

Turning it on is the owner's decision, because it approves what the folder runs: ask, or send them
[Resources › Extensions](apx:resources/extensions). With their OK: `apx extensions on <id>`. Its keys are typed by the
owner in that screen (or, if they gave you the value to store: `printf %s "$VALUE" | apx extensions secret <id>
<name>`).

Changing the folder after installing does nothing: install it again. Remove with `apx extensions rm <id>`.

## Before you hand it over

- `inspect` lists every skill, server, routine and secret you meant, and the server answers `tools/list`.
- No real token, email, phone or personal path in any file.
- Skills and descriptions in English; each skill's `description` says when to use it.
- Tell the owner what it brings, that it is installed off, and what they need to do to turn it on.
