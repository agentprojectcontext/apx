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
import { readConfig } from "../../../core/config.js";
import {
  listAvailableEmbedEngines,
  embeddingsConfig,
  resolveMode,
  resolveChainOrder,
} from "../../../core/memory/embed-engines/index.js";
import { embedOne } from "../../../core/memory/embeddings.js";
import { reindexMemory } from "../../../core/memory/index.js";

export function register(app) {
  app.get("/embeddings/providers", async (_req, res) => {
    try {
      const cfg = readConfig();
      const embedCfg = embeddingsConfig(cfg);
      res.json({
        configured_provider: embedCfg.provider || "auto",
        mode: resolveMode(embedCfg),
        order: resolveChainOrder(embedCfg),
        engines: await listAvailableEmbedEngines(cfg),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/embeddings/test", async (req, res) => {
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
  });

  app.post("/embeddings/reindex", async (_req, res) => {
    try {
      const result = await reindexMemory({ config: readConfig() });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
