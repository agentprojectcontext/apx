// Custom OpenAI-compatible embeddings adapter. Backs every user-added provider
// (config.memory.embeddings.custom.<slug>, surfaced as id "custom:<slug>") — a
// local or self-hosted /embeddings endpoint such as a Zen server, LiteLLM, or a
// llama.cpp server. Distinct from the built-in `openai` adapter in two ways:
//   1. the API key is OPTIONAL (local servers are often keyless), and it never
//      borrows engines.openai.api_key — a custom endpoint gets only its own key;
//   2. every vector is tagged with the provider's OWN id (`custom:<slug>:model`)
//      so two custom endpoints never collide in the index's cosine space.

import { l2normalize } from "../embeddings.js";

const DEFAULT_MODEL = "text-embedding-3-small";

export default {
  id: "custom",

  // Available once it has a base_url — the endpoint to POST to. A key is only
  // required if the server itself demands one (checked at call time by the 401).
  async isAvailable(config = {}) {
    return Boolean(config.base_url);
  },

  async embed({ text, config = {}, timeoutMs = 8000, signal }) {
    const base = String(config.base_url || "").replace(/\/$/, "");
    if (!base) throw new Error("custom embeddings: no base_url");
    const key = config.api_key || "";
    const model = config.model || DEFAULT_MODEL;
    // The provider's own id, injected by the registry — the index-space tag.
    const tag = config._embedder_id || "custom";
    const ctrl = new AbortController();
    const onParentAbort = () => ctrl.abort();
    if (signal) signal.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/embeddings`, {
        method: "POST",
        headers: {
          ...(key ? { authorization: `Bearer ${key}` } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, input: text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = await res.text().catch(() => "");
        throw new Error(`custom embeddings ${res.status}: ${err.slice(0, 200)}`);
      }
      const json = await res.json();
      const vector = json?.data?.[0]?.embedding;
      if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error("custom embeddings: empty vector");
      }
      return { vector: l2normalize(vector), embedder: `${tag}:${model}`, dim: vector.length };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onParentAbort);
    }
  },
};
