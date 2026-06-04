// Ollama embeddings adapter (default: nomic-embed-text). Local, no API key.
// base_url falls back to config.engines.ollama.base_url, then env, then
// localhost:11434 — the same endpoint that serves local + Ollama-cloud models.

import { l2normalize } from "../embeddings.js";

const DEFAULT_MODEL = "nomic-embed-text";

function resolveBaseUrl(config = {}, parentEnginesCfg) {
  const base =
    config.base_url ||
    parentEnginesCfg?.ollama?.base_url ||
    process.env.APX_EMBED_URL ||
    process.env.OLLAMA_HOST ||
    "http://localhost:11434";
  return String(base).replace(/\/$/, "");
}

export default {
  id: "ollama",

  // Local Ollama is "available" as a configured choice without probing a
  // network round-trip here — the embed() call itself falls back to tf on any
  // connection error, so the chain selector stays fast.
  async isAvailable() {
    return true;
  },

  async embed({ text, config = {}, parentEnginesCfg, timeoutMs = 4000, signal }) {
    const model = config.model || DEFAULT_MODEL;
    const base = resolveBaseUrl(config, parentEnginesCfg);
    const ctrl = new AbortController();
    const onParentAbort = () => ctrl.abort();
    if (signal) signal.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: text }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`ollama embeddings ${res.status}`);
      const json = await res.json();
      const vector = json.embedding;
      if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error("ollama embeddings: empty vector");
      }
      return { vector: l2normalize(vector), embedder: `ollama:${model}`, dim: vector.length };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onParentAbort);
    }
  },
};
