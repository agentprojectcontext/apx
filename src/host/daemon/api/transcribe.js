// POST /transcribe/chunk
// Raw audio bytes in the body. Headers:
//   X-Audio-Format  webm | ogg | wav | mp3 (defaults to webm)
//   X-Language      ISO code or "auto"
//   X-Provider      auto | local | openai   (overrides config)
//
// Shared by overlay, telegram voice messages, and any external caller.
export function register(app) {
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
        const { transcribeBuffer } = await import("../transcription.js");
        const result = await transcribeBuffer(buf, format, {
          language: language === "auto" ? undefined : language,
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
