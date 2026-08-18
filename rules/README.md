# AGENTS.md deep dives

Subsystem reference split out of the root [`AGENTS.md`](../AGENTS.md) so the
hub stays scannable. The hub carries the **always-read** contract (glossary, the
dev loop, project rules 1–17); each file here is **read-on-demand** — open it
only when you're working in that subsystem.

| File | Read it when you're touching… |
|---|---|
| [`architecture.md`](architecture.md) | any structural decision — layering, SOLID, registries, where logic lives |
| [`repo-layout.md`](repo-layout.md) | finding where a thing lives / where a new thing goes |
| [`daemon-api.md`](daemon-api.md) | HTTP routes, `asyncRoute`, plugins, WebSocket hubs |
| [`cli.md`](cli.md) | CLI commands, routes, help, aliases |
| [`testing.md`](testing.md) | writing/harnessing tests, coverage floor, preflight |
| [`recipes.md`](recipes.md) | engines, external runtimes, MCP scopes, Telegram identity |
| [`web-ui.md`](web-ui.md) | the React + Vite admin panel |
| [`prompts-and-channels.md`](prompts-and-channels.md) | prompt assembly, channels, lazy tools, skill surfacing |
| [`memory.md`](memory.md) | embeddings, message store, compaction, vector index |
| [`desktop.md`](desktop.md) | the Electron floating voice window |
| [`docs-site.md`](docs-site.md) | the public Astro + Starlight docs in `docs/` |

Current code-vs-contract state (validated findings, live bugs, prioritized
backlog): [`SURVEY-2026-08-17`](../spec/repair-and-refactoring-code/SURVEY-2026-08-17.md).

Each file's project rules still live (in short form) in the hub — these expand
the how-to. When you change behavior documented here, update both the hub rule
and the deep-dive in the same change.
