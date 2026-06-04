// Google Gemini embeddings adapter (default: text-embedding-004, 768 dims).
// Free tier available with a Gemini API key. Reuses engines.gemini.api_key.

import { l2normalize } from "../embeddings.js";

const DEFAULT_MODEL = "text-embedding-004";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

function getKey(config = {}, parentEnginesCfg) {
  return (
    config.api_key ||
    parentEnginesCfg?.gemini?.api_key ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  );
}

export default {
  id: "gemini",

  async isAvailable(config = {}, parentEnginesCfg) {
    return Boolean(getKey(config, parentEnginesCfg));
  },

  async embed({ text, config = {}, parentEnginesCfg, timeoutMs = 8000, signal }) {
    const key = getKey(config, parentEnginesCfg);
    if (!key) throw new Error("gemini embeddings: no api_key");
    const model = config.model || DEFAULT_MODEL;
    const ctrl = new AbortController();
    const onParentAbort = () => ctrl.abort();
    if (signal) signal.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(
        `${BASE}/models/${model}:embedContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: `models/${model}`,
            content: { parts: [{ text }] },
          }),
          signal: ctrl.signal,
        }
      );
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        throw new Error(`gemini embeddings ${res.status}: ${err.slice(0, 200)}`);
      }
      const json = await res.json();
      const vector = json?.embedding?.values;
      if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error("gemini embeddings: empty vector");
      }
      return { vector: l2normalize(vector), embedder: `gemini:${model}`, dim: vector.length };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onParentAbort);
    }
  },
};
