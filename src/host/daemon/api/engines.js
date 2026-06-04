// GET  /engines            — list engine adapter ids known to core/engines.
// POST /engines/models      — live model catalog from a provider.
// GET  /engines/models      — legacy (Ollama only, no auth).
import { ENGINE_IDS } from "../../../core/engines/index.js";
import { fetchJsonWithTimeout } from "../../../core/engines/_health.js";

const DEFAULT_BASE = {
  openai:     "https://api.openai.com/v1",
  groq:       "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  gemini:     "https://generativelanguage.googleapis.com/v1beta/openai",
  anthropic:  "https://api.anthropic.com/v1",
  ollama:     "http://localhost:11434",
};

// Returns { models } or { error }. Reads the right /models endpoint per engine.
async function listModels(engine, baseUrl, apiKey) {
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

  // openai-compatible family: openai, groq, openrouter, gemini, azure, custom
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

export function register(app, { config }) {
  app.get("/engines", (_req, res) => res.json({ engines: ENGINE_IDS }));

  app.post("/engines/models", async (req, res) => {
    const b = req.body || {};
    const engine = String(b.engine || "").toLowerCase();
    if (!engine) return res.status(400).json({ models: [], error: "engine requerido" });
    // api_key: prefer the one typed by the user (unsaved provider), else the
    // stored secret for that provider slug. The key never leaves the daemon.
    const slug = b.slug || engine;
    const stored = config?.engines?.[slug]?.api_key;
    const apiKey = b.api_key || stored || "";
    const out = await listModels(engine, b.base_url, apiKey);
    if (out.error) return res.status(502).json({ engine, models: [], error: out.error });
    res.json({ engine, models: out.models.sort((x, y) => x.localeCompare(y)) });
  });

  // Legacy GET (Ollama, no auth) — kept for back-compat.
  app.get("/engines/models", async (req, res) => {
    const engine = String(req.query.engine || "").toLowerCase();
    const out = await listModels(engine, String(req.query.base_url || ""), "");
    if (out.error) return res.status(502).json({ engine, models: [], error: out.error });
    res.json({ engine, models: out.models });
  });
}
