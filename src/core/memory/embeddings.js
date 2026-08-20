// Text embeddings for the cross-channel memory RAG (Pieza 2).
//
// The provider is configurable (config.memory.embeddings) and resolved through
// the engine registry at ./embed-engines — exactly like TTS/STT. Ships with
// ollama (local, default), openai, gemini, and the offline tf fallback. Pick
// "auto" (chain router) or a single provider; an explicit `provider` opt wins.
//
// Fallback: a deterministic, dependency-free feature-hashing term-frequency
// vector ("tf"). It is NOT as good as a real embedding, but it keeps the
// retriever working when no provider is reachable — the whole memory system
// must degrade gracefully, never throw into the daemon's request path.
//
// Every vector is tagged with the `embedder` that produced it (e.g.
// "ollama:nomic-embed-text", "openai:text-embedding-3-small", or "tf") and its
// `dim`. Cosine similarity is only meaningful within one embedder space, so
// callers must compare like with like (the store records the tag per row and
// the broker filters on it).

// NOTE: this module is the leaf the engine adapters import (l2normalize /
// tfEmbed). It also imports the registry — ESM live bindings make this safe
// because selectEmbedEngine is only referenced at call time, never at init.
import { selectEmbedEngine, selectEmbedChain } from "./embed-engines/index.js";

const TF_DIM = 256;

// Deterministic 32-bit string hash (FNV-1a). Used to bucket tokens for the TF
// fallback embedder.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2 && t.length <= 40);
}

// Feature-hashing TF vector, L2-normalised. Deterministic and offline.
export function tfEmbed(text, dim = TF_DIM) {
  const counts = new Map();
  for (const tok of tokenize(text)) {
    const bucket = fnv1a(tok) % dim;
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  const vec = new Array(dim).fill(0);
  for (const [bucket, c] of counts) {
    // Sublinear TF scaling so a repeated word doesn't dominate.
    vec[bucket] = 1 + Math.log(c);
  }
  return l2normalize(vec);
}

export function l2normalize(vec) {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both vectors are L2-normalised, so dot == cosine
}

// Embed a single string. Never throws — falls back to the offline TF embedder
// on any provider error/timeout. Returns { vector, embedder, dim }.
//
// opts: { globalConfig, provider, forceTf, timeoutMs, signal }
//   - globalConfig: read config.memory.embeddings to pick the provider
//   - provider: explicit override ("ollama"|"openai"|"gemini"|"tf"); wins over config
//   - forceTf: skip the provider, use the offline embedder (batch fast-path)
function tfResult(text) {
  const v = tfEmbed(text);
  return { vector: v, embedder: "tf", dim: v.length };
}

// The provider id inside an embedder tag ("ollama:nomic-embed-text" → "ollama",
// "tf" → "tf"). Used to pin a batch to whatever actually answered.
export function embedderProvider(embedder) {
  return String(embedder || "tf").split(":")[0];
}

async function tryEmbed({ adapter, engineConfig }, clean, opts) {
  const timeoutMs = opts.timeoutMs || engineConfig?.timeout_ms || 4000;
  const out = await adapter.embed({
    text: clean,
    config: engineConfig || {},
    parentEnginesCfg: opts.globalConfig?.engines,
    timeoutMs,
    signal: opts.signal,
  });
  if (!out || !Array.isArray(out.vector) || out.vector.length === 0) {
    throw new Error("empty vector");
  }
  return out;
}

export async function embedOne(text, opts = {}) {
  const clean = String(text || "").slice(0, 8000);
  if (!clean.trim()) return tfResult("");
  if (opts.forceTf) return tfResult(clean);

  // Explicit provider (test UI, batch fast-path): exactly that engine, no chain
  // fallback — tf only if it errors. This keeps the tester honest about one
  // provider and lets a batch pin to the engine that already won.
  if (opts.provider && opts.provider !== "auto") {
    try {
      const picked = await selectEmbedEngine({ globalConfig: opts.globalConfig, provider: opts.provider });
      return await tryEmbed(picked, clean, opts);
    } catch {
      return tfResult(clean);
    }
  }

  // Chain: walk every enabled+available engine in order and fall through to the
  // NEXT one whenever a call fails at runtime — a rate-limited (429) or down
  // provider, not just a keyless one. This is the "falls back to the next if one
  // fails" the UI promises; before, a 429 on the first engine dropped straight
  // to the offline tf floor and skipped a working local Ollama behind it.
  let chain = [];
  try { chain = await selectEmbedChain({ globalConfig: opts.globalConfig }); } catch { /* → tf */ }
  for (const engine of chain) {
    try {
      return await tryEmbed(engine, clean, opts);
    } catch { /* try the next engine in the chain */ }
  }
  return tfResult(clean);
}

// Embed many strings. Probes the provider once with the first item; if that
// falls back to TF, the rest go straight to TF (so a down host doesn't cost
// one timeout per chunk). Returns an array of { vector, embedder, dim }.
export async function embedBatch(texts, opts = {}) {
  const list = Array.isArray(texts) ? texts : [texts];
  if (list.length === 0) return [];
  const first = await embedOne(list[0], opts);
  const out = [first];
  // Pin the rest to whatever actually answered. Without this, a chain that fell
  // past a rate-limited gemini to ollama would re-probe (and re-429) gemini for
  // every remaining item — slow and quota-burning. tf → forceTf; a real engine →
  // call it directly (no chain re-walk).
  const restOpts = first.embedder === "tf"
    ? { ...opts, forceTf: true }
    : { ...opts, provider: embedderProvider(first.embedder) };
  for (let i = 1; i < list.length; i++) {
    out.push(await embedOne(list[i], restOpts));
  }
  return out;
}
