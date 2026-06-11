// Project messages (~/.apx/projects/<id>/messages/*.jsonl) and global channels
// (~/.apx/messages/<channel>/*.jsonl).
//
//   GET  /projects/:pid/messages
//   POST /projects/:pid/messages
//   GET  /projects/:pid/messages/search
//   GET  /messages/global
import {
  readGlobalMessages,
  readProjectMessages,
  searchProjectMessages,
} from "#core/stores/messages.js";

export function register(app, { project }) {
  app.get("/projects/:pid/messages", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { agent, channel, since, limit = "100" } = req.query;
    const rows = readProjectMessages(p.storagePath, {
      channel: channel || undefined,
      agent_slug: agent || undefined,
      since: since || undefined,
      limit: Math.min(parseInt(limit, 10) || 100, 1000),
    });
    res.json(rows);
  });

  app.post("/projects/:pid/messages", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const {
      channel,
      direction,
      type,
      actor_id,
      agent_slug,
      body,
      meta = {},
      author = null,
    } = req.body || {};
    if (!channel || !direction || !body)
      return res.status(400).json({ error: "channel, direction, body required" });
    if (!["in", "out"].includes(direction))
      return res.status(400).json({ error: "direction must be in|out" });
    const r = p.logMessage({
      agent_slug: agent_slug || null,
      channel,
      direction,
      type,
      actor_id,
      author,
      body,
      meta,
    });
    res.status(201).json({ ok: true, ts: r.ts });
  });

  app.get("/projects/:pid/messages/search", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { q, limit = "50" } = req.query;
    if (!q) return res.status(400).json({ error: "q required" });
    res.json(
      searchProjectMessages(
        p.storagePath,
        q,
        Math.min(parseInt(limit, 10) || 50, 500)
      )
    );
  });

  // Cross-project channels (telegram, direct, …)
  app.get("/messages/global", (req, res) => {
    const { channel, limit = "100", since } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 100, 1000);
    const rows = readGlobalMessages({
      channel: channel || undefined,
      limit: lim,
      since,
    });
    res.json(rows);
  });
}
