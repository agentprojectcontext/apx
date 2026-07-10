// Memory Broker (Pieza 4) — runs before each super-agent turn and assembles the
// [RELEVANT MEMORY] block injected into the system prompt.
//
//   incoming message
//     → embed it + RAG retriever (Pieza 2) → top-K relevant chunks
//     → read the last N entries of memory.md
//     → merge, dedupe, format as a [RELEVANT MEMORY] block
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

// Build the [RELEVANT MEMORY] block. Returns "" when there's nothing useful.
//
// opts: { store, config, memoryPath, budgetMs, topK, channel, embed }
export async function buildMemoryBlock(message, opts = {}) {
  const memoryPath = opts.memoryPath || SELF_MEMORY_PATH;
  const budgetMs = opts.budgetMs || DEFAULT_BUDGET_MS;
  const topK = opts.topK || DEFAULT_TOP_K;
  const store = opts.store || null;
  // Scope isolation: the super-agent recalls only global rows ("global"), a
  // project/agent turn recalls only its own — a single channel or an array of
  // channels (["agent:…","project:…"]).
  const scope = opts.scope || "global";
  // The flat notebook slice is always included for the super-agent, but a
  // project-agent turn already gets its own memory.md injected elsewhere, so it
  // opts out (includeFlat:false) to keep this block RAG-only.
  const includeFlat = opts.includeFlat !== false;
  const query = clean(message);

  // memory.md entries are read synchronously and always make the deadline.
  const memEntries = includeFlat ? lastMemoryEntries(memoryPath, 10) : [];

  // RAG retrieval is the slow part — race it against the budget.
  let hits = [];
  if (store && query) {
    const rag = (async () => {
      const { vector, embedder, dim } = await embedOne(query, opts.embed || {});
      const family = embedder.startsWith("ollama") ? "ollama" : "tf";
      const floor = MIN_SCORE[family] ?? 0;
      const results = store.search(vector, { embedder, k: topK + 3, scope });
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
    `# ${opts.heading || "Relevant memory (cross-channel)"}`,
    "Context recovered from your notebook and from the message log across channels.",
    "Treat these as known facts. If a fresh session opens and something here is still",
    "open, bring it up naturally in the user's language (e.g. \"yesterday we were on X — shall we continue?\") without being asked.",
    "",
    "[RELEVANT MEMORY]",
    ...bullets,
    "[/RELEVANT MEMORY]",
  ].join("\n");
}
