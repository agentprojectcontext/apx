// POST /transcribe/chunk
// Raw audio bytes in the body. Headers:
//   X-Audio-Format  webm | ogg | wav | mp3 (defaults to webm)
//   X-Language      ISO code or "auto"
//   X-Provider      auto | local | openai | custom   (overrides config)
//
// Shared by overlay, telegram voice messages, and any external caller.
export function register(app) {
  // GET /transcribe/providers — STT engine list + availability for the web
  // admin (mirror of /tts/providers). local = embedded faster-whisper;
  // openai = cloud Whisper; custom = any OpenAI-compatible server (mlx-audio
  // on Metal, a Radeon/NVIDIA box on the LAN, a remote endpoint).
  app.get("/transcribe/providers", async (_req, res) => {
    try {
      const { readConfig } = await import("#core/config/index.js");
      const { listSttProviders } = await import("#core/voice/transcription.js");
      res.json(listSttProviders(readConfig()));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /transcribe/hardware — detected machine + the recommended local backend
  // (mlx on Apple Silicon, faster-whisper cuda on NVIDIA, else CPU). Drives the
  // "engine adapts itself" UX in the web admin.
  app.get("/transcribe/hardware", async (_req, res) => {
    try {
      const { detectHardware, recommendStt } = await import("#core/voice/stt-hardware.js");
      const hw = detectHardware();
      res.json({ hardware: hw, recommended: recommendStt(hw) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /transcribe/models?backend=faster|mlx — model catalog with on-disk
  // status (downloaded? size) for the model-manager UI.
  app.get("/transcribe/models", async (req, res) => {
    try {
      const backend = String(req.query.backend || "faster");
      const { listSttModels } = await import("#core/voice/stt-models.js");
      res.json({ backend, models: listSttModels(backend) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /transcribe/warmup — load the local whisper model (if needed) and reset
  // its idle watchdog. Callers (e.g. the desktop window) ping this while open so
  // the first real utterance doesn't pay the cold-load cost.
  app.get("/transcribe/warmup", async (_req, res) => {
    try {
      const { warmupWhisper } = await import("../whisper-server.js");
      res.json(await warmupWhisper());
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post("/transcribe/chunk", async (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const buf = Buffer.concat(chunks);
      if (!buf.length)
        return res.status(400).json({ ok: false, error: "empty body" });
      const format = req.headers["x-audio-format"] || "webm";
      const language = req.headers["x-language"] || "auto";
      const provider = req.headers["x-provider"];
      try {
        const { transcribeBuffer } = await import("#core/voice/transcription.js");
        const result = await transcribeBuffer(buf, format, {
          // Only override the language when the caller pins a real one. An
          // "auto" header must NOT clobber the configured language (e.g. the
          // desktop always sends "auto", which used to override config.user
          // .language="es" with detection — hurting accuracy on short clips).
          ...(language && language !== "auto" ? { language } : {}),
          beam_size: 3,
          ...(provider ? { provider } : {}),
        });
        res.json(result);
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
    req.on("error", (e) =>
      res.status(500).json({ ok: false, error: e.message })
    );
  });
}
