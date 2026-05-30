// Cross-channel memory subsystem — public surface + lifecycle.
//
// Pieces:
//   1. Auto-write   → ~/.apx/memory.md (self-memory.js + the `remember` tool)
//   2. RAG          → embeddings.js + store.js + indexer.js (this module owns
//                     the store singleton and the incremental index timer)
//   3. Compaction   → compactor.js (+ messages-store reader changes)
//   4. Broker       → broker.js (memoryBlockFor below)
//
// Everything is best-effort and degrades gracefully: if the store can't open,
// if Ollama is down, or if anything throws, the daemon keeps serving — the
// affected piece simply contributes nothing.

import path from "node:path";
import { APX_HOME } from "../config.js";
import { ensureSelfMemoryFile } from "../agent/self-memory.js";
import { openMemoryStore } from "./store.js";
import { indexNewMessages } from "./indexer.js";
import { buildMemoryBlock } from "./broker.js";
import { compactChannelIfNeeded } from "./compactor.js";

export { compactChannelIfNeeded };

const DB_PATH = path.join(APX_HOME, "memory.db");
const JSON_PATH = path.join(APX_HOME, "memory-index.jsonl");

let _store = null;
let _ready = null;
let _timer = null;
let _cfg = {};
let _indexing = false;

// Run one index pass unless one is already in flight (a full re-embed can take
// longer than the timer interval — overlapping passes would race on clear()).
function indexOnce(note) {
  if (_indexing || !_store) return Promise.resolve();
  _indexing = true;
  return indexNewMessages(_store, { embed: embedOptsFromConfig(_cfg), log: note })
    .catch(() => {})
    .finally(() => {
      _indexing = false;
    });
}

export function memoryEnabled(config) {
  return config?.memory?.enabled !== false;
}

function embedOptsFromConfig(config) {
  const mem = config?.memory || {};
  const base = mem.embed_base_url || config?.engines?.ollama?.base_url || "";
  return {
    baseUrl: base,
    model: mem.embed_model || "nomic-embed-text",
    timeoutMs: mem.embed_timeout_ms || 4000,
  };
}

// Boot the subsystem (Pieza 1 file creation + Pieza 2 store/index). Safe to
// call once from the daemon. Never throws.
export async function initMemory({ config, log } = {}) {
  const note = typeof log === "function" ? log : () => {};
  try {
    const created = ensureSelfMemoryFile();
    if (created) note("memory: created ~/.apx/memory.md");
  } catch {
    /* best-effort */
  }
  if (!memoryEnabled(config)) {
    note("memory: RAG disabled by config (memory.enabled=false)");
    return null;
  }
  _cfg = config || {};
  _ready = (async () => {
    try {
      _store = await openMemoryStore({ dbPath: DB_PATH, jsonPath: JSON_PATH, log: note });
      // Initial index in the background — never blocks boot.
      indexOnce(note);
      return _store;
    } catch (e) {
      note(`memory: store init failed (${e?.message || e})`);
      return null;
    }
  })();

  const everyMs = (config?.memory?.index_interval_s || 60) * 1000;
  _timer = setInterval(() => indexOnce(note), everyMs);
  if (_timer.unref) _timer.unref();

  return _ready;
}

export async function getMemoryStore() {
  if (_ready) {
    try {
      return await _ready;
    } catch {
      return _store;
    }
  }
  return _store;
}

export function stopMemory() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  if (_store) {
    try {
      _store.close();
    } catch {
      /* ignore */
    }
    _store = null;
  }
  _ready = null;
}

// Build the [MEMORIA RELEVANTE] block for a turn (Pieza 4). Never throws —
// returns "" on any failure so the prompt builder can drop the block.
export async function memoryBlockFor(message, { config, channel, budgetMs } = {}) {
  try {
    if (!memoryEnabled(config)) return "";
    const store = await getMemoryStore();
    return await buildMemoryBlock(message, {
      store,
      config,
      channel,
      budgetMs: budgetMs || config?.memory?.broker_budget_ms || 800,
      topK: config?.memory?.rag_top_k || 5,
      embed: embedOptsFromConfig(config),
    });
  } catch {
    return "";
  }
}
