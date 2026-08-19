// GET  /engines            — list engine adapter ids known to core/engines.
// GET  /engines/presets     — curated catalog (known models, defaults) per engine.
// POST /engines/models      — live model catalog from a provider.
// GET  /engines/models      — legacy (Ollama only, no auth).
// POST /engines/test        — one-shot "is this wired up?" message to one model.
import { ENGINE_IDS, callEngine } from "#core/engines/index.js";
import { listModels } from "#core/engines/catalog.js";
import { ENGINE_PRESETS } from "#core/engines/presets.js";
import { asyncRoute } from "./shared.js";

export function register(api, { config }) {
  api.get("/engines", (_req, res) => res.json({ engines: ENGINE_IDS }));

  // Curated fallback catalog shared with the CLI wizard. The web hydrates its
  // provider forms from here so model lists never drift between surfaces.
  api.get("/engines/presets", (_req, res) => res.json({ presets: ENGINE_PRESETS }));

  api.post("/engines/models", asyncRoute(async (req, res) => {
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
  }));

  // One message in, one reply out. Deliberately NOT the agent path: no history,
  // no tools, no skills, no memory — just enough to prove the credentials, the
  // endpoint and the model id all work together.
  //
  // Substitution is caught by `served_model` (the gateway's own `model` /
  // `modelVersion` field), not by asking the weights to name themselves.
  // Self-identification is colour: models guess, and a distilled model will
  // happily claim to be Claude. The prompt still asks, but tells it to say
  // "I don't know" rather than invent an id.
  const TEST_SYSTEM = [
    "You are answering a one-off connection test from an admin panel.",
    "Reply in at most two short sentences: which model you are, and what you are doing right now.",
    "If you do not know your exact model id, say so instead of guessing.",
    "Answer in the language of the user's message.",
  ].join(" ");

  // What the gateway says it served. OpenAI-shaped bodies use `model`; Gemini
  // uses `modelVersion`. Missing is fine — streaming adapters leave `raw` null.
  function servedModelOf(out) {
    const raw = out?.raw;
    if (!raw || typeof raw !== "object") return null;
    for (const key of ["model", "modelVersion"]) {
      const v = raw[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  }

  api.post("/engines/test", asyncRoute(async (req, res) => {
    const b = req.body || {};
    const provider = String(b.provider || "").trim();
    const model = String(b.model || "").trim();
    const message = String(b.message || "").trim();
    if (!provider) return res.status(400).json({ error: "provider requerido" });
    if (!model) return res.status(400).json({ error: "model requerido" });

    const started = Date.now();
    try {
      const out = await callEngine({
        modelId: `${provider}:${model}`,
        system: TEST_SYSTEM,
        messages: [{ role: "user", content: message || "¿Andás?" }],
        config,
        temperature: 0.3,
        maxTokens: 300,
      });
      res.json({
        provider,
        model,
        served_model: servedModelOf(out),
        text: out?.text || "",
        usage: out?.usage || null,
        ms: Date.now() - started,
      });
    } catch (e) {
      res.status(502).json({ error: e?.message || "la llamada falló", ms: Date.now() - started });
    }
  }));

  // Legacy GET (Ollama, no auth) — kept for back-compat.
  api.get("/engines/models", asyncRoute(async (req, res) => {
    const engine = String(req.query.engine || "").toLowerCase();
    const out = await listModels(engine, String(req.query.base_url || ""), "");
    if (out.error) return res.status(502).json({ engine, models: [], error: out.error });
    res.json({ engine, models: out.models });
  }));
}
