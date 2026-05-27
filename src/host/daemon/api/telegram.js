// Telegram plugin endpoints. Every route 503s if the plugin isn't loaded.
//   GET    /telegram/status
//   POST   /telegram/start
//   POST   /telegram/stop
//   POST   /telegram/send         { chat_id?, text, channel? }
//   POST   /telegram/send_photo   { chat_id?, photo, caption?, parse_mode?, channel? }
//   POST   /telegram/send_voice   { chat_id?, audio, caption?, duration?, channel? }
//   POST   /telegram/send_audio   { chat_id?, audio, caption?, title?, performer?, channel? }
//   POST   /telegram/notify       (alias of /telegram/send; daemon-initiated pushes)
//
//   GET    /telegram/channels                         — list configured channels
//   POST   /telegram/channels    { name, ... }        — create or replace one channel
//   PATCH  /telegram/channels/:name { ...fields }     — patch (set/unset via null)
//   DELETE /telegram/channels/:name                   — remove channel
//
// The CRUD endpoints edit ~/.apx/config.json directly and DO NOT auto-reload
// the running plugin. Callers should POST /admin/reload afterwards.
import {
  readConfig,
  listTelegramChannels,
  findTelegramChannel,
  upsertTelegramChannel,
  removeTelegramChannel,
  unsetTelegramChannelFields,
} from "../../../core/config.js";

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

  // ── Channel CRUD (config-only; caller must POST /admin/reload to apply) ──
  // We read fresh config from disk on each call so concurrent writes from the
  // CLI and the daemon don't clobber one another via stale closures.
  app.get("/telegram/channels", (_req, res) => {
    try {
      const cfg = readConfig();
      res.json({ channels: listTelegramChannels(cfg) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/telegram/channels", (req, res) => {
    const body = req.body || {};
    if (!body.name || typeof body.name !== "string") {
      return res.status(400).json({ error: "name required" });
    }
    try {
      const cfg = readConfig();
      const result = upsertTelegramChannel(cfg, body.name, body);
      res.status(result.created ? 201 : 200).json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/telegram/channels/:name", (req, res) => {
    const { name } = req.params;
    const body = req.body || {};
    try {
      const cfg = readConfig();
      const existing = findTelegramChannel(cfg, name);
      if (!existing) return res.status(404).json({ error: `no channel: ${name}` });
      // null in the patch means "unset that field".
      const unset = Object.entries(body)
        .filter(([, v]) => v === null)
        .map(([k]) => k);
      const setPatch = Object.fromEntries(
        Object.entries(body).filter(([, v]) => v !== null)
      );
      if (Object.keys(setPatch).length > 0) {
        upsertTelegramChannel(cfg, name, setPatch);
      }
      if (unset.length > 0) {
        unsetTelegramChannelFields(cfg, name, unset);
      }
      res.json({ ok: true, channel: findTelegramChannel(cfg, name) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/telegram/channels/:name", (req, res) => {
    const { name } = req.params;
    try {
      const cfg = readConfig();
      const { removed } = removeTelegramChannel(cfg, name);
      if (!removed) return res.status(404).json({ error: `no channel: ${name}` });
      res.json({ ok: true, removed });
    } catch (e) {
      res.status(500).json({ error: e.message });
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
