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

// The active embedder, cached.
//
// This route fills the whole Embeddings panel, and it used to `await` a real
// embedding call before answering any of it. That was tolerable while a failed
// call gave up after 4s; once the timeout grew to cover a cold model load
// (~6s — see DEFAULT_EMBED_TIMEOUT_MS), opening Settings meant staring at an
// empty provider list for six seconds. The engine list is config, and config
// should never wait on the network.
//
// So the probe is cached and refreshed in the background: the response is
// immediate and carries the last known answer, which for a value that changes
// only when someone edits the chain is exactly right. On a cold daemon the
// first response has no badge yet and the panel polls until it does.
const ACTIVE_TTL_MS = 60_000;
// …except when the answer is the offline floor. `tf` is not an engine anyone
// chose, it is what is left when every real one failed — and at boot that is
// routinely a transient: the daemon is indexing memory against the same Ollama
// server that is still loading the model, so one call loses the race. Caching
// that for a minute turns a blip into a panel that confidently reports the
// wrong embedder. A degraded answer gets retried almost immediately instead.
const ACTIVE_TTL_DEGRADED_MS = 5_000;
let activeCache = { embedder: "", at: 0 };

function activeIsStale() {
  const ttl = !activeCache.embedder || activeCache.embedder === "tf"
    ? ACTIVE_TTL_DEGRADED_MS
    : ACTIVE_TTL_MS;
  return Date.now() - activeCache.at > ttl;
}
let activeInFlight = null;

function refreshActiveEmbedder(cfg) {
  if (activeInFlight) return activeInFlight;
  activeInFlight = embedOne("probe", { globalConfig: cfg })
    .then((out) => { activeCache = { embedder: out.embedder, at: Date.now() }; })
    .catch(() => { /* leave the last known answer in place */ })
    .finally(() => { activeInFlight = null; });
  return activeInFlight;
}

export function register(api) {
  // Primed at boot. Two birds: the panel is never the one paying for a cold
  // model load, and the load happens before the first real turn needs it.
  try { refreshActiveEmbedder(readConfig()); } catch { /* best-effort */ }

  api.get("/embeddings/providers", asyncRoute(async (_req, res) => {
    try {
      const cfg = readConfig();
      const embedCfg = embeddingsConfig(cfg);
      // The embedder a real call lands on RIGHT NOW — not the first engine that
      // merely has a key. This is what makes "gemini has a key but is rate-limited
      // so we're actually on ollama" visible instead of a lie. One probe per load.
      // Stale-while-revalidate: answer now, refresh behind the response.
      if (activeIsStale()) refreshActiveEmbedder(cfg);
      const active_embedder = activeCache.embedder;
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
