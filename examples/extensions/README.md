# Extension examples

An extension is a folder with an `apx-extension.json`: skills, MCP servers and routine templates in one piece,
readable without running anything. Install one with `apx extensions install <folder>` (or Settings › Extensions);
it arrives off, and turning it on approves exactly its files.

| Field | What |
|---|---|
| `id`, `name`, `version`, `description` | Who it is. `id`: lowercase letters, digits, `-` and `_`, up to 20. |
| `skills` | A folder of skill folders, each with a `SKILL.md`. |
| `mcp` | MCP servers by name (`command` + `args` + `env`, or `url` + `headers`). `secret://name` means the extension's own secret `name`; `env:` is not allowed. A command starting with `./` runs from the extension's folder. |
| `routines` | Templates the owner can add to Routines (`name`, `schedule`, `prompt`). |
| `secrets` | What it needs the owner to type once (`name`, `label`, optional `url`). |
| `plugin` | Code that runs beside APX in its own process: `entry` (a `.mjs` in the folder), `observe` (events it watches: `thread.updated`, `message.created`, `run.updated`, `task.updated`, `notification.updated`), `context` (whether it adds context to the owner's turns; one extension at a time), `network` (whether it may reach the internet). |

A plugin's `entry` exports `activate(api)`: `api.on(event, fn)`, `api.context(async ({ thread, agent, text }) => string)`,
`api.log(text)`, `api.secrets` (its declared secrets) and `api.dataDir` (the only folder it can write). It reads only
its own folder, starts no processes, and never reaches this machine (where APX listens): it cannot call APX. What it
adds to a turn reaches the agent as outside data.

- `daily-brief/`: a skill and a routine template, no code.
