// GET  /engines            — list engine adapter ids known to core/engines.
// GET  /engines/presets     — curated catalog (known models, defaults) per engine.
// POST /engines/models      — live model catalog from a provider.
// GET  /engines/models      — legacy (Ollama only, no auth).
import { ENGINE_IDS } from "#core/engines/index.js";
import { listModels } from "#core/engines/catalog.js";
import { ENGINE_PRESETS } from "#core/engines/presets.js";

export function register(app, { config }) {
  app.get("/engines", (_req, res) => res.json({ engines: ENGINE_IDS }));

  // Curated fallback catalog shared with the CLI wizard. The web hydrates its
  // provider forms from here so model lists never drift between surfaces.
  app.get("/engines/presets", (_req, res) => res.json({ presets: ENGINE_PRESETS }));

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
