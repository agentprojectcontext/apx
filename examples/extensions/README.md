# Extension examples

An extension is a folder with an `apx-extension.json`: skills, MCP servers and routine templates in one piece,
readable without running anything. Install one with `apx2 extensions install <folder>` (or Settings › Extensions);
it arrives off, and turning it on approves exactly its files.

| Field | What |
|---|---|
| `id`, `name`, `version`, `description` | Who it is. `id`: lowercase letters, digits, `-` and `_`, up to 20. |
| `skills` | A folder of skill folders, each with a `SKILL.md`. |
| `mcp` | MCP servers by name (`command` + `args` + `env`, or `url` + `headers`). `secret://name` means the extension's own secret `name`; `env:` is not allowed. A command starting with `./` runs from the extension's folder. |
| `routines` | Templates the owner can add to Routines (`name`, `schedule`, `prompt`). |
| `secrets` | What it needs the owner to type once (`name`, `label`, optional `url`). |

- `daily-brief/`: a skill and a routine template, no code.
