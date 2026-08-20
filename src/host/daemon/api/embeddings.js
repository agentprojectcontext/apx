// Daemon HTTP routes for the RAG embeddings provider (config.memory.embeddings).
// Mirrors /tts/* so the web admin can configure embeddings exactly like TTS/STT.
//
//   GET  /embeddings/providers  → { configured_provider, mode, order,
//                                   engines: [{id, available, configured, enabled}] }
//   POST /embeddings/test       { text?, provider? }
//                               → { ok, provider, embedder, dim, ms }  (probe a model)
//   POST /embeddings/reindex    → { ok, cleared, indexed }  (rebuild the vector
//                                   store under the current embedder — needed
//                                   after switching provider/model)
import { readConfig } from "#core/config/index.js";
import {
  listAvailableEmbedEngines,
  embeddingsConfig,
  resolveMode,
  resolveChainOrder,
} from "#core/memory/embed-engines/index.js";
import { embedOne } from "#core/memory/embeddings.js";
import { reindexMemory } from "#core/memory/index.js";
import { asyncRoute } from "./shared.js";

export function register(api) {
  api.get("/embeddings/providers", asyncRoute(async (_req, res) => {
    try {
      const cfg = readConfig();
      const embedCfg = embeddingsConfig(cfg);
      // The embedder a real call lands on RIGHT NOW — not the first engine that
      // merely has a key. This is what makes "gemini has a key but is rate-limited
      // so we're actually on ollama" visible instead of a lie. One probe per load.
      let active_embedder = "";
      try {
        active_embedder = (await embedOne("probe", { globalConfig: cfg })).embedder;
      } catch { /* leave blank on probe failure */ }
      res.json({
        configured_provider: embedCfg.provider || "auto",
        mode: resolveMode(embedCfg),
        order: resolveChainOrder(embedCfg),
        active_embedder,
        engines: await listAvailableEmbedEngines(cfg),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));

  api.post("/embeddings/test", asyncRoute(async (req, res) => {
    try {
      const { text, provider } = req.body || {};
      const sample = typeof text === "string" && text.trim()
        ? text
        : "APX cross-channel memory embedding probe.";
      const t0 = Date.now();
      const out = await embedOne(sample, { globalConfig: readConfig(), provider });
      res.json({
        ok: out.embedder !== "tf" || provider === "tf",
        provider: provider || "auto",
        embedder: out.embedder,
        dim: out.dim,
        ms: Date.now() - t0,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));

  api.post("/embeddings/reindex", asyncRoute(async (_req, res) => {
    try {
      const result = await reindexMemory({ config: readConfig() });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));
}
