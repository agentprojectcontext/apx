// Discord channel endpoints.
//
//   GET    /discord/status                        — connection + the room list
//   PATCH  /discord/settings                      — enabled / token / owner_ids / names / knowledge_path / limits / context
//   PUT    /discord/channels/:id  { mode, name }  — list a room, or change its mode
//   DELETE /discord/channels/:id                  — take a room off the list
//   GET    /discord/channels/:id/history?limit=   — recent messages, from Discord
//   POST   /discord/send  { channel_id, text }    — post as the bot
//   GET    /discord/rooms                         — the servers' text rooms, to pick from
//   POST   /discord/reconnect                     — reconnect with the saved settings (a new token)
//
// The token goes IN through /settings and never comes back out: status reports
// `has_token`, nothing more.
import { asyncRoute } from "./shared.js";
import {
  readDiscordConfig,
  patchDiscordConfig,
  setDiscordChannel,
  removeDiscordChannel,
  isSnowflake,
} from "#core/channels/discord/config.js";
import { readConfig } from "#core/config/index.js";

const unavailable = (res) =>
  res.status(503).json({ error: "discord is not connected (check discord.token and the daemon log)" });

export function register(api, { plugins }) {
  const dc = () => plugins?.get?.("discord") || null;

  api.get("/discord/status", (_req, res) => {
    const p = dc();
    if (p) return res.json(p.status());
    const cfg = readDiscordConfig(readConfig());
    res.json({
      running: false,
      enabled: cfg.enabled,
      has_token: cfg.hasToken,
      owner_ids: cfg.owner_ids,
      names: cfg.names,
      knowledge_path: cfg.knowledge_path,
      channels: Object.entries(cfg.channels).map(([id, row]) => ({ id, ...row })),
      state: "off",
    });
  });

  api.patch("/discord/settings", (req, res) => {
    try {
      const out = patchDiscordConfig(req.body || {});
      const { hasToken, ...rest } = out;
      res.json({ ...rest, has_token: hasToken });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.put("/discord/channels/:id", (req, res) => {
    try {
      res.json({ id: req.params.id, ...setDiscordChannel(req.params.id, req.body || {}) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.delete("/discord/channels/:id", (req, res) => {
    if (!removeDiscordChannel(req.params.id)) return res.status(404).json({ error: "channel not listed" });
    res.json({ ok: true });
  });

  api.get("/discord/channels/:id/history", asyncRoute(async (req, res) => {
    if (!isSnowflake(req.params.id)) return res.status(400).json({ error: "not a Discord channel id" });
    const p = dc();
    if (!p?.status?.().bot) return unavailable(res);
    const limit = Number(req.query.limit) || 50;
    res.json({ messages: await p.history(req.params.id, { limit }) });
  }));

  // Empty (not an error) while disconnected or not invited anywhere: the panel
  // says why from `status`, and an empty picker is the honest picture.
  api.get("/discord/rooms", (_req, res) => {
    const p = dc();
    res.json({ rooms: p?.rooms ? p.rooms() : [] });
  });

  api.post("/discord/reconnect", (_req, res) => {
    const p = dc();
    if (!p) return res.status(503).json({ error: "discord plugin not loaded" });
    res.json(p.reconnect());
  });

  api.post("/discord/send", asyncRoute(async (req, res) => {
    const { channel_id, text } = req.body || {};
    if (!isSnowflake(channel_id)) return res.status(400).json({ error: "channel_id must be a Discord channel id" });
    if (!String(text || "").trim()) return res.status(400).json({ error: "text is required" });
    // Only to a listed room. Posting somewhere the bot does not read would
    // leave a message whose replies nobody here ever sees.
    if (!readDiscordConfig(readConfig()).channels[channel_id]) {
      return res.status(403).json({ error: "that channel is not listed — add it with apx discord channel set first" });
    }
    const p = dc();
    if (!p?.status?.().bot) return unavailable(res);
    res.json(await p.send(channel_id, String(text)));
  }));
}
