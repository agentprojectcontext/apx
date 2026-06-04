// OpenAI embeddings adapter (default: text-embedding-3-small, 1536 dims).
// Reuses engines.openai.api_key + base_url; per-section overrides live under
// memory.embeddings.openai. Works with any OpenAI-compatible /embeddings
// endpoint (OpenAI, OpenRouter, local LiteLLM) by overriding base_url.

import { l2normalize } from "../embeddings.js";

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_BASE = "https://api.openai.com/v1";

function getKey(config = {}, parentEnginesCfg) {
  return (
    config.api_key ||
    parentEnginesCfg?.openai?.api_key ||
    process.env.OPENAI_API_KEY ||
    ""
  );
}

function getBase(config = {}, parentEnginesCfg) {
  return String(
    config.base_url || parentEnginesCfg?.openai?.base_url || DEFAULT_BASE
  ).replace(/\/$/, "");
}

export default {
  id: "openai",

  async isAvailable(config = {}, parentEnginesCfg) {
    return Boolean(getKey(config, parentEnginesCfg));
  },

  async embed({ text, config = {}, parentEnginesCfg, timeoutMs = 8000, signal }) {
    const key = getKey(config, parentEnginesCfg);
    if (!key) throw new Error("openai embeddings: no api_key");
    const model = config.model || DEFAULT_MODEL;
    const base = getBase(config, parentEnginesCfg);
    const ctrl = new AbortController();
    const onParentAbort = () => ctrl.abort();
    if (signal) signal.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/embeddings`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input: text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        throw new Error(`openai embeddings ${res.status}: ${err.slice(0, 200)}`);
      }
      const json = await res.json();
      const vector = json?.data?.[0]?.embedding;
      if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error("openai embeddings: empty vector");
      }
      return { vector: l2normalize(vector), embedder: `openai:${model}`, dim: vector.length };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onParentAbort);
    }
  },
};
