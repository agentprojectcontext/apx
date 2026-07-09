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
import { APX_HOME } from "../config/index.js";
import { ensureSelfMemoryFile } from "../agent/self-memory.js";
import fs from "node:fs";
import { openMemoryStore } from "./store.js";
import { indexNewMessages, CURSOR_PATH } from "./indexer.js";
import { buildMemoryBlock } from "./broker.js";
import { compactChannelIfNeeded } from "./compactor.js";
import { buildActiveThreadsBlock } from "./active-threads.js";

export { compactChannelIfNeeded, buildActiveThreadsBlock };

const DB_PATH = path.join(APX_HOME, "memory.db");
const JSON_PATH = path.join(APX_HOME, "memory-index.jsonl");

let _store = null;
let _ready = null;
let _timer = null;
let _cfg = {};
let _projects = null;
let _indexing = false;

// Run one index pass unless one is already in flight (a full re-embed can take
// longer than the timer interval — overlapping passes would race on clear()).
// `_projects` (the daemon registry) lets the indexer reach each project's
// .apc/memory.md; agent memory is walked straight off the filesystem.
function indexOnce(note) {
  if (_indexing || !_store) return Promise.resolve();
  _indexing = true;
  return indexNewMessages(_store, { embed: embedOptsFromConfig(_cfg), projects: _projects, log: note })
    .catch(() => {})
    .finally(() => {
      _indexing = false;
    });
}

export function memoryEnabled(config) {
  return config?.memory?.enabled !== false;
}

// The embeddings provider is resolved from config.memory.embeddings inside
// embedOne/embedBatch via the engine registry — so all we forward here is the
// live config. (Legacy memory.embed_* keys are still honored by the registry's
// back-compat shim in embed-engines/index.js.)
function embedOptsFromConfig(config) {
  return { globalConfig: config };
}

// Boot the subsystem (Pieza 1 file creation + Pieza 2 store/index). Safe to
// call once from the daemon. Never throws.
export async function initMemory({ config, log, projects } = {}) {
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
  _projects = projects || null;
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

// Rebuild the vector store from scratch under the CURRENTLY configured embedder.
// Switching provider/model changes the embedder space, which makes old rows
// (tagged with the previous embedder) invisible to new queries — they're not
// re-embedded incrementally because the cursor marks them as already indexed.
// This clears the store + cursor and re-embeds every message. Never throws.
export async function reindexMemory({ config } = {}) {
  if (config) _cfg = config;
  const store = await getMemoryStore();
  if (!store) return { cleared: false, indexed: 0, error: "store unavailable" };
  const before = store.count();
  try {
    store.clear();
  } catch {
    /* best-effort */
  }
  try {
    fs.rmSync(CURSOR_PATH, { force: true });
  } catch {
    /* best-effort */
  }
  await indexNewMessages(store, { embed: embedOptsFromConfig(_cfg), log: () => {} }).catch(() => {});
  return { cleared: before, indexed: store.count() };
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

// Build the [RELEVANT MEMORY] block for a turn (Pieza 4). Never throws —
// returns "" on any failure so the prompt builder can drop the block.
export async function memoryBlockFor(message, { config, channel, budgetMs } = {}) {
  try {
    if (!memoryEnabled(config)) return "";
    const store = await getMemoryStore();
    return await buildMemoryBlock(message, {
      store,
      config,
      channel,
      scope: "global", // super-agent recall — never pulls project/agent rows
      budgetMs: budgetMs || config?.memory?.broker_budget_ms || 800,
      topK: config?.memory?.rag_top_k || 5,
      embed: embedOptsFromConfig(config),
    });
  } catch {
    return "";
  }
}

// Scoped recall for a specific project or agent turn. `scope` is the row channel
// key: "project:<id>" or "agent:<projdir>:<slug>". `memoryPath` (optional) is
// that scope's own notebook, read as the always-included flat slice. Returns ""
// on any failure so the prompt builder can drop the block.
export async function scopedMemoryBlockFor(message, { scope, memoryPath, config, budgetMs } = {}) {
  try {
    if (!scope || !memoryEnabled(config)) return "";
    const store = await getMemoryStore();
    return await buildMemoryBlock(message, {
      store,
      config,
      scope,
      memoryPath,
      budgetMs: budgetMs || config?.memory?.broker_budget_ms || 800,
      topK: config?.memory?.rag_top_k || 5,
      embed: embedOptsFromConfig(config),
    });
  } catch {
    return "";
  }
}
