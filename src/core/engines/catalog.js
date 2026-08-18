// Live model catalogs per engine. Wraps each provider's "list models" endpoint
// behind one signature: listModels(engine, baseUrl?, apiKey?) → { models } or
// { error }. Pure transport — no daemon dependencies. Both the daemon HTTP
// adapter and CLI commands can reuse this.
import { fetchJsonWithTimeout } from "./_health.js";
import { ZEN_HEADERS } from "./zen.js";

export const DEFAULT_BASE = {
  openai:     "https://api.openai.com/v1",
  groq:       "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  gemini:     "https://generativelanguage.googleapis.com/v1beta/openai",
  anthropic:  "https://api.anthropic.com/v1",
  ollama:     "http://localhost:11434",
  zen:        "https://opencode.ai/zen/v1",
};

// Gemini's native models endpoint returns a much richer catalog than the
// OpenAI-compat shim (which only echoes back a handful). We always query the
// native URL regardless of the user's configured base_url.
const GEMINI_NATIVE_BASE = "https://generativelanguage.googleapis.com/v1beta";

export async function listModels(engine, baseUrl, apiKey) {
  const base = String(baseUrl || DEFAULT_BASE[engine] || "").replace(/\/$/, "");

  if (engine === "ollama") {
    const b = base || process.env.OLLAMA_HOST || "http://localhost:11434";
    const r = await fetchJsonWithTimeout(`${b}/api/tags`, { timeoutMs: 2500 });
    if (!r.ok) return { error: r.reason || "no se pudo contactar Ollama" };
    const list = Array.isArray(r.json?.models) ? r.json.models : [];
    return { models: list.map((m) => m?.name).filter((n) => typeof n === "string" && n) };
  }

  if (engine === "anthropic") {
    if (!apiKey) return { error: "falta api_key" };
    const b = base || DEFAULT_BASE.anthropic;
    const r = await fetchJsonWithTimeout(`${b}/models?limit=100`, {
      timeoutMs: 5000,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!r.ok) return { error: r.reason || `HTTP ${r.status}` };
    const data = Array.isArray(r.json?.data) ? r.json.data : [];
    return { models: data.map((m) => m?.id).filter(Boolean) };
  }

  if (engine === "gemini") {
    if (!apiKey) return { error: "falta api_key" };
    // Native Gemini API returns rich metadata, including supportedGenerationMethods
    // so we can drop embeddings/vision-only entries. Names come back as
    // "models/<id>"; strip the prefix.
    const r = await fetchJsonWithTimeout(
      `${GEMINI_NATIVE_BASE}/models?key=${encodeURIComponent(apiKey)}&pageSize=200`,
      { timeoutMs: 5000 },
    );
    if (!r.ok) return { error: r.reason || `HTTP ${r.status}` };
    const data = Array.isArray(r.json?.models) ? r.json.models : [];
    const models = data
      .filter((m) => {
        const methods = m?.supportedGenerationMethods;
        if (!Array.isArray(methods)) return true;
        return methods.includes("generateContent");
      })
      .map((m) => {
        const name = typeof m?.name === "string" ? m.name : "";
        return name.startsWith("models/") ? name.slice("models/".length) : name;
      })
      .filter(Boolean);
    return { models };
  }

  // Zen publishes its catalog without a key, so the model picker can be filled
  // before the user has one — useful, since choosing a model is how you decide
  // whether the provider is worth signing up for.
  if (engine === "zen") {
    const r = await fetchJsonWithTimeout(`${base || DEFAULT_BASE.zen}/models`, {
      timeoutMs: 5000,
      headers: { ...ZEN_HEADERS, ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    });
    if (!r.ok) return { error: r.reason || `HTTP ${r.status}` };
    const list = Array.isArray(r.json?.data) ? r.json.data : [];
    const ids = list.map((m) => m?.id).filter(Boolean);
    // Free-tier ids first. The catalog mixes models that bill at zero with
    // Claude/GPT/Gemini ones that very much do not, under names that don't say
    // which is which — so the cheap ones are the ones you scroll to first.
    const free = (id) => /-free$/.test(id) || id === "big-pickle";
    return { models: [...ids.filter(free).sort(), ...ids.filter((id) => !free(id)).sort()] };
  }

  // openai-compatible family: openai, groq, openrouter, azure, custom
  if (!apiKey) return { error: "falta api_key" };
  if (!base) return { error: "falta base_url" };
  const r = await fetchJsonWithTimeout(`${base}/models`, {
    timeoutMs: 5000,
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!r.ok) return { error: r.reason || `HTTP ${r.status}` };
  const data = Array.isArray(r.json?.data)
    ? r.json.data
    : Array.isArray(r.json?.models)
      ? r.json.models
      : [];
  return { models: data.map((m) => m?.id || m?.name).filter(Boolean) };
}
