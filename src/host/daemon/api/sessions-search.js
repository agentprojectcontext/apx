// Cross-agent, cross-conversation session search + global compact-by-id.
//   GET  /sessions/search?q=…&project=…&limit=20
//   POST /sessions/:id/compact     resolves which project/agent owns the file
//                                  then delegates to compactConversation.
import path from "node:path";
import { readAgents } from "#core/apc/parser.js";
import { compactConversation } from "#core/stores/conversations-compactor.js";
import { searchSessions, findSessionFile } from "#core/stores/sessions-search.js";

function resolveProjects(projects, projectRef) {
  const all = projects.list();
  if (projectRef != null) {
    const ref = String(projectRef);
    const found = all.find((p) => String(p.id) === ref || p.path === path.resolve(ref));
    return found ? [projects.get(found.id)] : [];
  }
  return all.map((p) => projects.get(p.id)).filter(Boolean);
}

export function register(app, { projects, config }) {
  app.get("/sessions/search", (req, res) => {
    const { q, project: projectRef, limit = "20" } = req.query;
    if (!q) return res.status(400).json({ error: "q required" });
    const lim = Math.min(parseInt(limit, 10) || 20, 200);
    const targets = resolveProjects(projects, projectRef);
    const results = searchSessions(targets, q, lim);
    res.json({ q, count: results.length, results });
  });

  app.post("/sessions/:id/compact", async (req, res) => {
    const { id } = req.params;
    const { model: modelOverride, project: projectRef } = req.body || {};
    const candidates = resolveProjects(projects, projectRef);
    const found = findSessionFile(candidates, id);

    if (!found) {
      return res.status(404).json({ error: `session/conversation "${id}" not found` });
    }

    const { project: p, agentSlug, filename } = found;
    const agents = readAgents(p.path);
    const agent = agents.find((a) => a.slug === agentSlug);
    const modelId = modelOverride || agent?.fields?.Model;
    if (!modelId) {
      return res.status(400).json({ error: "agent has no model; pass model in body" });
    }

    try {
      const result = await compactConversation({
        storagePath: p.storagePath,
        agentSlug,
        filename,
        modelId,
        config: p.config || config,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
