// Telegram plugin endpoints. Every route 503s if the plugin isn't loaded.
//   GET  /telegram/status
//   POST /telegram/start
//   POST /telegram/stop
//   POST /telegram/send         { chat_id?, text, channel? }
//   POST /telegram/send_photo   { chat_id?, photo, caption?, parse_mode?, channel? }
//   POST /telegram/send_voice   { chat_id?, audio, caption?, duration?, channel? }
//   POST /telegram/send_audio   { chat_id?, audio, caption?, title?, performer?, channel? }
//   POST /telegram/notify       (alias of /telegram/send; semantic marker for daemon-initiated pushes)
export function register(app, { telegram }) {
  app.get("/telegram/status", (_req, res) => {
    if (!telegram) return res.json({ enabled: false, channels: [] });
    res.json(telegram.status());
  });

  app.post("/telegram/start", (_req, res) => {
    if (!telegram)
      return res.status(503).json({ error: "telegram plugin not loaded" });
    try {
      telegram.start();
      res.json({ ok: true, status: telegram.status() });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  app.post("/telegram/stop", (_req, res) => {
    if (!telegram)
      return res.status(503).json({ error: "telegram plugin not loaded" });
    try {
      telegram.stop();
      res.json({ ok: true, status: telegram.status() });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  app.post("/telegram/send", async (req, res) => {
    const { chat_id, text, channel } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    if (!telegram)
      return res.status(503).json({ error: "telegram plugin not loaded" });
    try {
      const r = await telegram.send({ chat_id, text, channel });
      res.status(202).json({ ok: true, message_id: r.message_id });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  app.post("/telegram/send_photo", async (req, res) => {
    const { chat_id, photo, caption, parse_mode, channel } = req.body || {};
    if (!photo)
      return res.status(400).json({ error: "photo required (path or url)" });
    if (!telegram)
      return res.status(503).json({ error: "telegram plugin not loaded" });
    try {
      const r = await telegram.sendPhoto({
        chat_id,
        photo,
        caption,
        parse_mode,
        channel,
      });
      res.status(202).json({ ok: true, message_id: r?.message_id });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  app.post("/telegram/send_voice", async (req, res) => {
    const { chat_id, audio, caption, duration, channel } = req.body || {};
    if (!audio) return res.status(400).json({ error: "audio required (path)" });
    if (!telegram)
      return res.status(503).json({ error: "telegram plugin not loaded" });
    try {
      const r = await telegram.sendVoice({
        chat_id,
        audio,
        caption,
        duration,
        channel,
      });
      res.status(202).json({ ok: true, message_id: r?.message_id });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  app.post("/telegram/send_audio", async (req, res) => {
    const { chat_id, audio, caption, title, performer, channel } =
      req.body || {};
    if (!audio) return res.status(400).json({ error: "audio required (path)" });
    if (!telegram)
      return res.status(503).json({ error: "telegram plugin not loaded" });
    try {
      const r = await telegram.sendAudio({
        chat_id,
        audio,
        caption,
        title,
        performer,
        channel,
      });
      res.status(202).json({ ok: true, message_id: r?.message_id });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // Alias for proactive daemon-initiated pushes (routines, error handlers, …).
  app.post("/telegram/notify", async (req, res) => {
    const { chat_id, text, channel } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    if (!telegram)
      return res.status(503).json({ error: "telegram plugin not loaded" });
    try {
      const r = await telegram.send({ chat_id, text, channel });
      res.status(202).json({ ok: true, message_id: r.message_id, via: "notify" });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });
}
