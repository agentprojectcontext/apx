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

export function register(app) {
  app.post("/tts/say", async (req, res) => {
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
  });

  app.get("/tts/providers", async (_req, res) => {
    try {
      const info = await listProviders(readConfig());
      res.json(info);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
