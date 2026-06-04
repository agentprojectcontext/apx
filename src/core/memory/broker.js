// Memory Broker (Pieza 4) — runs before each super-agent turn and assembles the
// [MEMORIA RELEVANTE] block injected into the system prompt.
//
//   incoming message
//     → embed it + RAG retriever (Pieza 2) → top-K relevant chunks
//     → read the last N entries of memory.md
//     → merge, dedupe, format as a [MEMORIA RELEVANTE] block
//
// Silent and bounded: the whole thing races an 800 ms budget. If RAG is slow
// (Ollama lagging), the block still returns with whatever memory.md gave us —
// it NEVER blocks the reply or throws into the request path.

import fs from "node:fs";
import { embedOne } from "./embeddings.js";
import { SELF_MEMORY_PATH, parseSelfMemoryEntries } from "../agent/self-memory.js";

const DEFAULT_BUDGET_MS = 800;
const DEFAULT_TOP_K = 5;
const BULLET_CAP = 160; // chars per bullet line
const MIN_SCORE = { ollama: 0.35, tf: 0.08 }; // floor per embedder family

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(fallback);
      }
    }, ms);
    promise.then(
      (v) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(v);
        }
      },
      () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      }
    );
  });
}

function dateOf(ts) {
  return ts ? String(ts).slice(0, 10) : "";
}

function clean(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function trunc(text, n = BULLET_CAP) {
  const t = clean(text);
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

// Last N entries of memory.md, newest first, as {date, channel, text}.
function lastMemoryEntries(memoryPath, n) {
  try {
    const text = fs.readFileSync(memoryPath, "utf8");
    const entries = parseSelfMemoryEntries(text);
    return entries.slice(-n).reverse();
  } catch {
    return [];
  }
}

function bulletFor({ date, channel, text }) {
  const d = date ? `[${date}]` : "";
  const c = channel && channel !== "memory" ? `[${channel}]` : channel === "memory" ? "[memory]" : "";
  return `• ${d}${c} ${trunc(text)}`.replace(/\s+/g, " ").trim();
}

// Build the [MEMORIA RELEVANTE] block. Returns "" when there's nothing useful.
//
// opts: { store, config, memoryPath, budgetMs, topK, channel, embed }
export async function buildMemoryBlock(message, opts = {}) {
  const memoryPath = opts.memoryPath || SELF_MEMORY_PATH;
  const budgetMs = opts.budgetMs || DEFAULT_BUDGET_MS;
  const topK = opts.topK || DEFAULT_TOP_K;
  const store = opts.store || null;
  const query = clean(message);

  // memory.md entries are read synchronously and always make the deadline.
  const memEntries = lastMemoryEntries(memoryPath, 10);

  // RAG retrieval is the slow part — race it against the budget.
  let hits = [];
  if (store && query) {
    const rag = (async () => {
      const { vector, embedder, dim } = await embedOne(query, opts.embed || {});
      const family = embedder.startsWith("ollama") ? "ollama" : "tf";
      const floor = MIN_SCORE[family] ?? 0;
      const results = store.search(vector, { embedder, k: topK + 3 });
      return results.filter((r) => r.score >= floor && (r.dim ?? dim) === dim);
    })();
    hits = await withTimeout(rag, budgetMs, []);
  }

  // Merge RAG hits + recent memory entries, dedupe by normalised text.
  const seen = new Set();
  const bullets = [];
  const push = (entry) => {
    const key = clean(entry.text).toLowerCase().slice(0, 80);
    if (!key || seen.has(key)) return;
    // Don't echo the user's own incoming message back at them.
    if (key && query.toLowerCase().includes(key) && key.length > 30) return;
    seen.add(key);
    bullets.push(bulletFor(entry));
  };

  for (const h of hits.slice(0, topK)) {
    push({
      date: dateOf(h.ts),
      channel: h.tag === "memory" ? "memory" : h.channel,
      text: h.text.replace(/^\[tool result: [^\]]+\]\s*/, ""),
    });
  }
  for (const e of memEntries) {
    if (bullets.length >= topK + 5) break;
    push({ date: e.date, channel: e.channel || "memory", text: e.text });
  }

  if (bullets.length === 0) return "";

  return [
    "# Memoria relevante (cross-channel)",
    "Contexto recuperado de tu memoria y del historial de todos los canales. Tratá",
    "como hechos conocidos; si arrancás una sesión nueva y algo de acá sigue abierto,",
    "mencionalo naturalmente (\"ayer estuvimos con X, ¿seguimos?\") sin que te pregunten.",
    "",
    "[MEMORIA RELEVANTE]",
    ...bullets,
    "[/MEMORIA RELEVANTE]",
  ].join("\n");
}
