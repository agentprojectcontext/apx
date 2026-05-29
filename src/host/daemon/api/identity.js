// GET   /identity            full identity.json
// PATCH /identity            { agent_name?, owner_name?, personality?, owner_context?, language?, timezone? }
import { readIdentity, writeIdentity } from "../../../core/identity.js";

const ALLOWED_KEYS = new Set([
  "agent_name",
  "owner_name",
  "personality",
  "owner_context",
  "language",
  "timezone",
]);

export function register(app) {
  app.get("/identity", (_req, res) => {
    res.json(readIdentity() || {});
  });

  app.patch("/identity", (req, res) => {
    const body = req.body || {};
    const patch = {};
    for (const [k, v] of Object.entries(body)) {
      if (!ALLOWED_KEYS.has(k)) continue;
      if (v === null || typeof v === "string") patch[k] = v ?? "";
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "no editable fields in body" });
    }
    try {
      const out = writeIdentity(patch);
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
