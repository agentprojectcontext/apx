// GET /projects/:pid/agents/:slug/connections
// Builds a per-peer summary of an agent's a2a traffic from the messages store.
import { readAgents } from "#core/apc/parser.js";
import { readProjectMessages } from "#core/stores/messages.js";

export function register(app, { project }) {
  app.get("/projects/:pid/agents/:slug/connections", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const agents = readAgents(p.path);
    if (!agents.find((a) => a.slug === req.params.slug))
      return res.status(404).json({ error: "agent not found" });

    const messages = readProjectMessages(p.storagePath, {
      agent_slug: req.params.slug,
    });
    const peers = new Map();
    for (const m of messages) {
      const peer = m.meta?.from || m.meta?.to || null;
      if (!peer) continue;
      const key = `${peer}|${m.channel}|${m.direction}`;
      const existing = peers.get(key);
      if (!existing) {
        peers.set(key, {
          peer,
          channel: m.channel,
          direction: m.direction,
          n: 1,
          last_ts: m.ts,
        });
      } else {
        existing.n++;
        if (m.ts > existing.last_ts) existing.last_ts = m.ts;
      }
    }
    res.json(
      Array.from(peers.values()).sort((a, b) =>
        (b.last_ts || "").localeCompare(a.last_ts || "")
      )
    );
  });
}
