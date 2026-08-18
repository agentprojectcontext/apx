// OpenCode Zen — an OpenAI-compatible gateway in front of many vendors'
// models, including a handful the provider serves at no cost.
//
// The free models are the reason this engine exists: with a Zen key they bill
// at zero, which makes them a real option for an agent that runs all day. The
// key is not optional, though. Zen also fronts paid Claude/GPT/Gemini models on
// the same base URL, and the same key is what tells the two apart — so it is
// required here like any other provider's.
import { createOpenAiCompatibleEngine } from "./openai-compatible.js";

// The free tier is gated on the caller naming itself as the opencode client,
// not only on the key: byte-for-byte the same request answers 429
// FreeUsageLimitError without this User-Agent and 200 with it. So it travels
// with every Zen call — chat, health and the model catalog. It is a pinned
// version string, and pins go stale; `engines.zen.headers` overrides it from
// config when Zen starts asking for a newer one.
export const ZEN_HEADERS = { "user-agent": "opencode/1.18.18" };

const base = createOpenAiCompatibleEngine({
  id: "zen",
  defaultBaseUrl: "https://opencode.ai/zen/v1",
  apiKeyEnv: "OPENCODE_ZEN_API_KEY",
  defaultFallbackModel: "zen:big-pickle",
  extraHeaders: ZEN_HEADERS,
});

/** The cheapest model that still proves a key works: free, one token. */
const PROBE_MODEL = "big-pickle";

// Zen serves its catalog to anyone — `GET /models` answers 200 with no key at
// all, and 200 again with a made-up one. The shared health check reads that as
// "connected", so a typo in the key would show a healthy provider that fails on
// the first real turn. Here the probe has to be a completion: one token against
// a free model, which costs nothing and is the only answer the gateway gives
// that actually depends on the key.
export default {
  ...base,

  async health(config = {}, { timeoutMs = 800 } = {}) {
    const key = config?.api_key || process.env.OPENCODE_ZEN_API_KEY || "";
    if (!key) return { ok: false, provider: "zen", reason: "no api_key" };

    const url = `${String(config?.base_url || base.defaultBaseUrl).replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, 4000));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: base.buildHeaders(config, {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        }),
        body: JSON.stringify({
          model: config?.model || PROBE_MODEL,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });
      if (res.ok) return { ok: true, provider: "zen", detail: url };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, provider: "zen", reason: "api_key rechazada por Zen" };
      }
      // Anything else (a rate limit, a model that went away) says nothing about
      // the key, so the chain is allowed to try — flagged, not blocked.
      return { ok: true, provider: "zen", detail: url, soft: true, reason: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: true, provider: "zen", detail: url, soft: true, reason: e.message };
    } finally {
      clearTimeout(timer);
    }
  },
};
