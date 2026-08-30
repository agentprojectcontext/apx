// Daemon HTTP routes for text-to-speech.
//
//   POST /tts/say        { text, voice?, language?, provider?, format?, style? }
//                        → { audio_path, duration_s, mime, provider }
//
//   GET  /tts/providers  → { configured_provider, mode, order,
//                            engines: [{id, available, configured, enabled}] }
//
// Audio files land under ~/.apx/tmp/tts/<uuid>.<ext>. The caller (CLI,
// Telegram plugin, overlay) is responsible for picking them up.
import { synthesize, listProviders } from "#core/voice/tts.js";
import { readConfig } from "#core/config/index.js";
import { asyncRoute } from "./shared.js";

export function register(api) {
  api.post("/tts/say", asyncRoute(async (req, res) => {
    try {
      const { text, voice, language, provider, format, style } = req.body || {};
      if (typeof text !== "string" || !text.trim()) {
        return res.status(400).json({ error: "text required" });
      }
      const result = await synthesize({
        text,
        voice,
        language,
        provider,
        format,
        style,
        globalConfig: readConfig(),
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));

  // GET /tts/warmup — tell the engine that would speak next to get ready.
  // The desktop calls this the moment the mic opens, so the model is resident
  // by the time there is a reply to say.
  api.get("/tts/warmup", asyncRoute(async (_req, res) => {
    const { warmupTts } = await import("#core/voice/tts.js");
    res.json(await warmupTts());
  }));

  // GET /tts/reachable — does the local voice server actually answer right now?
  //
  // Deliberately not folded into /tts/providers. The `available` flag there is
  // a CONFIG probe by design: a custom endpoint reports itself available on the
  // strength of having a base_url, which is the right answer for a settings
  // list that must show an engine you are still setting up. It is the wrong
  // answer for "is it running" — stop the server and that flag never moves.
  //
  // Only ever probes a self-hosted endpoint, and only /models, the
  // OpenAI-compatible catalogue every such server already serves. A short
  // timeout because the point is to distinguish answering from not, and a
  // server that needs three seconds to list its models is not answering.
  api.get("/tts/reachable", asyncRoute(async (_req, res) => {
    try {
      const { resolveTtsCandidates } = await import("#core/voice/engines/index.js");
      const { isSelfHosted } = await import("../tts-keepwarm.js");
      const cfg = readConfig();
      const candidates = await resolveTtsCandidates({ globalConfig: cfg });
      const local = candidates.find((c) => isSelfHosted(c.engineConfig?.base_url));
      if (!local) return res.json({ configured: false });

      const url = String(local.engineConfig.base_url).replace(/\/+$/, "") + "/models";
      const t0 = Date.now();
      let reachable = false;
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
        reachable = r.ok;
      } catch { reachable = false; }
      res.json({
        configured: true,
        provider: local.provider,
        base_url: local.engineConfig.base_url,
        reachable,
        ms: Date.now() - t0,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));

  api.get("/tts/providers", asyncRoute(async (_req, res) => {
    try {
      const info = await listProviders(readConfig());
      res.json(info);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));
}
