// Text embeddings for the cross-channel memory RAG (Pieza 2).
//
// Primary backend: Ollama `nomic-embed-text` (local, no API key). The base_url
// is resolved from config.engines.ollama.base_url (default http://localhost:11434,
// where both local and Ollama-cloud models are served). Never a paid/external
// embeddings service — local Ollama or the offline TF fallback, nothing else.
//
// Fallback: a deterministic, dependency-free feature-hashing term-frequency
// vector ("tf"). It is NOT as good as a real embedding, but it keeps the
// retriever working when Ollama is unreachable — the whole memory system must
// degrade gracefully, never throw into the daemon's request path.
//
// Every vector is tagged with the `embedder` that produced it (e.g.
// "ollama:nomic-embed-text" or "tf") and its `dim`. Cosine similarity is only
// meaningful within one embedder space, so callers must compare like with like
// (the store records the tag per row and the broker filters on it).

const TF_DIM = 256;

function resolveOllama(opts = {}) {
  const base =
    opts.baseUrl ||
    process.env.APX_EMBED_URL ||
    process.env.OLLAMA_HOST ||
    "http://localhost:11434";
  return base.replace(/\/$/, "");
}

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
// on any Ollama error/timeout. Returns { vector, embedder, dim }.
export async function embedOne(text, opts = {}) {
  const model = opts.model || "nomic-embed-text";
  const timeoutMs = opts.timeoutMs || 4000;
  const clean = String(text || "").slice(0, 8000);
  if (!clean.trim()) {
    const v = tfEmbed("", TF_DIM);
    return { vector: v, embedder: "tf", dim: v.length };
  }
  if (opts.forceTf) {
    const v = tfEmbed(clean);
    return { vector: v, embedder: "tf", dim: v.length };
  }
  const base = resolveOllama(opts);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: clean }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`ollama embeddings ${res.status}`);
    const json = await res.json();
    const vector = json.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error("ollama embeddings: empty vector");
    }
    return { vector: l2normalize(vector), embedder: `ollama:${model}`, dim: vector.length };
  } catch {
    const v = tfEmbed(clean);
    return { vector: v, embedder: "tf", dim: v.length };
  } finally {
    clearTimeout(timer);
  }
}

// Embed many strings. Probes Ollama once with the first item; if that falls
// back to TF, the rest go straight to TF (so a down Ollama host doesn't cost
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
