---
name: apx-extensions
description: Builds an APX extension — one folder with an `apx-extension.json` that brings skills, MCP servers, routine templates, settings and secrets the owner types once, ready-made agents, an app on a TV or phone and, optionally, a sandboxed plugin — then checks, packs and installs it with `apx extensions inspect|pack|install|on`. Also turns an existing script or app into one, and says when an extension is the wrong tool (a project skill, an agent template, a plain MCP server). Triggers: 'APX extension', 'make an extension for APX', 'apx-extension.json', '.apxext', 'APX plugin', 'package skills for APX', 'add an MCP to APX as an extension', 'bring my app to APX'.
homepage: https://github.com/agentprojectcontext/apx
---

# Building an APX extension

An extension is a folder APX can read **without running anything**: a manifest (`apx-extension.json`) plus the files
it names. It installs **off**; turning it on approves exactly those files.

## Pick the smallest thing first

| The owner wants | Make |
|---|---|
| Know-how for this one project's agents | A skill in the project: `.apc/skills/<name>/SKILL.md` — no extension |
| One more MCP server for their own agents | `apx mcps add <name> <command…|url>` — no extension |
| An agent (or a team) with its own routines | An agent template: `<slug>.md` + `<slug>.routines.json` |
| Skills, servers and routines that travel together, shared or reused | **An extension** |
| Their own script (`.mjs`) or app, usable by their agents | **An extension around it** (below) |
| Code that watches events or adds context to the owner's turns | An extension with a `plugin` |

## The folder

```
northwind-crm/
  apx-extension.json
  skills/
    crm-lookup/SKILL.md        # each skill: a folder with a SKILL.md (frontmatter name + description)
  server.mjs                   # only if an MCP server runs from the folder ("./server.mjs")
  plugin.mjs                   # only if there is a plugin
```

## `apx-extension.json`

Unknown keys are refused (the schema is strict).

```json
{
  "id": "northwind_crm",
  "name": "Northwind CRM",
  "version": "1.0.0",
  "description": "Look up customers and open deals in Northwind's CRM.",
  "skills": "skills",
  "mcp": {
    "crm": {
      "command": "node",
      "args": ["./server.mjs"],
      "env": { "CRM_TOKEN": "secret://token" }
    },
    "docs": { "url": "https://mcp.example.com/docs", "headers": { "Authorization": "Bearer secret://token" } }
  },
  "routines": [
    {
      "name": "Monday pipeline",
      "schedule": { "kind": "cron", "cron": "0 9 * * 1" },
      "prompt": "Use the crm-lookup skill to list deals that did not move last week. Answer SKIP if none."
    }
  ],
  "secrets": [{ "name": "token", "label": "CRM API token", "url": "https://example.com/settings/tokens" }]
}
```

| Field | Rules |
|---|---|
| `id` | Lowercase letters, digits, `_` and `-`, starting with a letter or digit, at most 20. |
| `name`, `version`, `description` | Required name and version; description up to 500 characters. |
| `skills` | A folder of skill folders, relative to the extension. |
| `mcp` | Servers by name (letters, digits, `_`; **no `-`**, at most 20). Either `command` + `args` + `env`, or `url` + `headers`. A command starting with `./` runs from the extension's folder. |
| `secret://name` | The extension's own secret `name`, declared under `secrets`. `env:` references are not allowed. Never put a real value in the manifest. |
| `routines` | Templates the owner adds from Routines (they pick the agent). `schedule`: `{ "kind": "cron", "cron" }`, `{ "kind": "every", "minutes" }` (5 or more) or `{ "kind": "once", "at" }`. A routine that answers `SKIP` tells nobody. |
| `secrets` | Up to 10: `name` (same rule as servers), `label`, optional `url` where to get it. The owner types the value once. |
| `plugin` | See below. |

## Manifest 2 (a whole product)

Add `"manifest": 2` for more than skills, servers and secrets:

- `settings`: typed values the owner sets (`string|number|boolean|directory|file`, `options`, `default`, `required`).
  `sensitive: true` keeps one in the secret store (`secret://name`); a plain one fills `setting://name` in a server.
  `"generate": "random"` on a sensitive string creates a connection key at install.
- `agents` (`id`, `name`, `description`, `prompt`) and `apps` (`.apxart` files), offered on its page.
- `pages` (`id`, `title`, `entry` HTML): its own settings screen, sandboxed, talking through `window.apx`.
- `hosts`, `platforms` (`darwin|linux|win32`) and `companion`: an app on a TV, phone or computer (`name`, `platform`,
  `file` or `url`, `steps`, `pairing: {"with": "apx"}` or `{"with": "extension", "server", "tool"}`).

## From a script or an app they already have

Keep their code as it is: an `.mjs` that speaks MCP over stdio is the server (`"command": "node", "args":
["./server.mjs"]`); otherwise a small MCP server in the folder calls it. Servers inside an extension get no
`node_modules`, so bundle or avoid dependencies. What it needs (an address, a folder, a key) is a setting reaching it
through `env`, never a value written in the folder. An app on another device goes in `companion`, its `.apk` in the
folder; a key the app and the server share is a sensitive setting with `"generate": "random"`, and a pairing tool of the
server answers `{"code", "address"}` as JSON. The docs page "Bring your app to an extension" walks through the Android
TV one.

## A plugin (only when files are not enough)

```json
"plugin": { "entry": "plugin.mjs", "observe": ["task.updated"], "context": false, "network": false }
```

```js
// plugin.mjs — runs in its own process; reads only its folder, writes only api.dataDir.
export default function activate(api) {
  api.on("task.updated", (event) => api.log(`task ${event.task?.id} changed`));
  api.context(async ({ thread, agent, text }) => "");   // only with "context": true; return "" to add nothing
}
```

- `observe`: any of `thread.updated`, `message.created`, `run.updated`, `task.updated`, `notification.updated`.
- `api.secrets.<name>` holds its declared secrets; `api.fetch` reaches the internet only with `"network": true`, the
  local network and the tailnet only with `"local_network": true` as well, and never this machine (APX's own port
  included). It cannot start processes or call APX.
- What `context` returns reaches the agent as **outside data**, not instructions. One extension at a time may add
  context.

## Check, pack, install, turn on

```bash
apx extensions inspect ./northwind-crm        # what it would bring; nothing is installed
apx extensions pack ./northwind-crm           # northwind_crm-1.0.0.apxext, the same bytes for the same folder
apx extensions install ./northwind-crm        # copied in, off (a folder, an .apxext or an https address)
apx extensions set northwind_crm region=eu    # its settings (name=- reads a sensitive one from stdin)
apx extensions secret northwind_crm token     # the value on stdin, never as an argument
apx extensions on northwind_crm
apx extensions                                # installed ones and whether they are on
```

Changing the folder after installing does nothing: install it again (another version keeps the one before:
`apx extensions rollback <id>`). The app's Marketplace shows the same, and installs an `.apxext` dropped on its window.

## Before you hand it over

- `inspect` passes and lists every skill, server, routine, setting and secret you meant.
- No real token, email, phone or machine path in any file: secrets go through `secret://`, examples use
  `user@example.com` and `~/work/…`.
- Skills, prompts and descriptions are in English; APX translates its own UI.
- Each skill's `description` says when to use it, so agents load it only then.
