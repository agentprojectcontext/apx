# Memory, RAG & cross-channel store

> Deep dive for [`AGENTS.md`](../AGENTS.md). Read before touching embeddings,
> the message store, compaction, or the vector index.

- **Embeddings provider is configurable** (`memory.embeddings`, registry at `core/memory/embed-engines/`: ollama/openai/gemini/tf). `embedOne/embedBatch` resolve via `selectEmbedEngine`, fall back to `tf` on error. Switching provider/model changes the embedder space → run `POST /api/embeddings/reindex` after a switch.
- **The cross-channel message store is the spine.** Every surface logs turns to `~/.apx/messages/<channel>/YYYY-MM-DD.jsonl` via `appendGlobalMessage({channel, ...})`. Feeds the RAG indexer, `search_messages`, and the `# Active threads` block — a channel that doesn't log is invisible cross-channel.
- **Progressive compaction** (`core/memory/compactor.js`): fire-and-forget once a chat passes `memory.compact_threshold`; summarizes the oldest into a `type:"compact"` record (light `compact_model`), keeps `keep_recent` verbatim.
- **Vector store is dual-backend + lazy** (`store.js`): tries sqlite-vec (`~/.apx/memory.db`), falls back to a pure-JS JSON store on any load failure. Indexer is incremental (cursor at `~/.apx/memory-cursor.json`), reconciles embedder family changes, broker hard-capped at `memory.broker_budget_ms`. Tests: `memory-rag` + `memory-compaction` (offline: force-TF/force-JSON/mock/temp HOME).
