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
import { selectEmbedEngine } from "./embed-engines/index.js";

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

export async function embedOne(text, opts = {}) {
  const clean = String(text || "").slice(0, 8000);
  if (!clean.trim()) return tfResult("");
  if (opts.forceTf) return tfResult(clean);

  let adapter, engineConfig;
  try {
    ({ adapter, engineConfig } = await selectEmbedEngine({
      globalConfig: opts.globalConfig,
      provider: opts.provider,
    }));
  } catch {
    return tfResult(clean);
  }

  const timeoutMs = opts.timeoutMs || engineConfig?.timeout_ms || 4000;
  try {
    const out = await adapter.embed({
      text: clean,
      config: engineConfig || {},
      parentEnginesCfg: opts.globalConfig?.engines,
      timeoutMs,
      signal: opts.signal,
    });
    if (!out || !Array.isArray(out.vector) || out.vector.length === 0) return tfResult(clean);
    return out;
  } catch {
    return tfResult(clean);
  }
}

// Embed many strings. Probes the provider once with the first item; if that
// falls back to TF, the rest go straight to TF (so a down host doesn't cost
// one timeout per chunk). Returns an array of { vector, embedder, dim }.
export async function embedBatch(texts, opts = {}) {
  const list = Array.isArray(texts) ? texts : [texts];
  if (list.length === 0) return [];
  const first = await embedOne(list[0], opts);
  const out = [first];
  const forceTf = first.embedder === "tf" ? { ...opts, forceTf: true } : opts;
  for (let i = 1; i < list.length; i++) {
    out.push(await embedOne(list[i], forceTf));
  }
  return out;
}
