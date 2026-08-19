# Memory, RAG & cross-channel store

> Deep dive for [`AGENTS.md`](../AGENTS.md). Read before touching embeddings,
> the message store, compaction, or the vector index.

- **Three files are dated note logs, and they share ONE format** (`core/memory/dated-log.js`): the super-agent's notebook (`~/.apx/memory.md`), a project's memory (`<repo>/.apc/memory.md`, `core/apc/project-memory.js`) and a routine's memory. One `## YYYY-MM-DD` heading per day, one `- [HH:MM][channel] note` bullet per note, and today's bullet goes at the end of TODAY'S block — not at the end of the file.
- **Project memory has one writer: `remember` with a `project`.** It had readers (the Memories screen, the indexer's `project:<id>` scope) and no writer, so the model improvised a `MEMORY.md` at the repo root — invisible to both. The daemon route (`api/agents.js`) goes through the same core store, so screen and agent cannot drift onto two paths again.
- **Embeddings provider is configurable** (`memory.embeddings`, registry at `core/memory/embed-engines/`: ollama/openai/gemini/tf). `embedOne/embedBatch` resolve via `selectEmbedEngine`, fall back to `tf` on error. Switching provider/model changes the embedder space → run `POST /api/embeddings/reindex` after a switch.
- **The cross-channel message store is the spine.** Every surface logs turns to `~/.apx/messages/<channel>/YYYY-MM-DD.jsonl` via `appendGlobalMessage({channel, ...})`. Feeds the RAG indexer, `search_messages`, and the `# Active threads` block — a channel that doesn't log is invisible cross-channel.
- **Progressive compaction** (`core/memory/compactor.js`): fire-and-forget once a chat passes `memory.compact_threshold`; summarizes the oldest into a `type:"compact"` record (light `compact_model`), keeps `keep_recent` verbatim.
- **Vector store is dual-backend + lazy** (`store.js`): tries sqlite-vec (`~/.apx/memory.db`), falls back to a pure-JS JSON store on any load failure. Indexer is incremental (cursor at `~/.apx/memory-cursor.json`), reconciles embedder family changes, broker hard-capped at `memory.broker_budget_ms`. Tests: `memory-rag` + `memory-compaction` (offline: force-TF/force-JSON/mock/temp HOME).
