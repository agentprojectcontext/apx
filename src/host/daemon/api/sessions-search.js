// Cross-agent, cross-conversation session search + global compact-by-id.
//   GET  /sessions/search?q=…&project=…&limit=20
//   POST /sessions/:id/compact     resolves which project/agent owns the file
//                                  then delegates to compactConversation.
import fs from "node:fs";
import path from "node:path";
import { readAgents } from "#core/apc/parser.js";
import { compactConversation } from "../compact.js";

export function register(app, { projects, config }) {
  app.get("/sessions/search", (req, res) => {
    const { q, project: projectRef, limit = "20" } = req.query;
    if (!q) return res.status(400).json({ error: "q required" });
    const lim = Math.min(parseInt(limit, 10) || 20, 200);
    const needle = q.toLowerCase();

    const allProjects = projects.list();
    const targetProjects = (() => {
      if (projectRef != null) {
        const ref = String(projectRef);
        const found = allProjects.find(
          (p) => String(p.id) === ref || p.path === path.resolve(ref)
        );
        return found ? [projects.get(found.id)] : [];
      }
      return allProjects.map((p) => projects.get(p.id)).filter(Boolean);
    })();

    const matches = [];

    for (const p of targetProjects) {
      if (!p) continue;

      // 1) Legacy session files in the repo (.apc/agents/<slug>/sessions/)
      const sessionAgentsDir = path.join(p.path, ".apc", "agents");
      if (fs.existsSync(sessionAgentsDir)) {
        for (const slug of fs.readdirSync(sessionAgentsDir)) {
          const sessionsDir = path.join(sessionAgentsDir, slug, "sessions");
          if (!fs.existsSync(sessionsDir)) continue;
          for (const f of fs
            .readdirSync(sessionsDir)
            .filter((x) => x.endsWith(".md"))) {
            const filePath = path.join(sessionsDir, f);
            try {
              const text = fs.readFileSync(filePath, "utf8");
              if (text.toLowerCase().includes(needle)) {
                const lines = text.split("\n");
                const matchLine = lines.findIndex((l) =>
                  l.toLowerCase().includes(needle)
                );
                const excerpt = lines
                  .slice(Math.max(0, matchLine - 1), matchLine + 3)
                  .join("\n");
                matches.push({
                  type: "session",
                  project: p.id,
                  agent: slug,
                  filename: f,
                  path: filePath,
                  excerpt: excerpt.slice(0, 300),
                });
                if (matches.length >= lim) break;
              }
            } catch {}
          }
          if (matches.length >= lim) break;
        }
      }

      if (matches.length >= lim) break;

      // 2) Conversation files in daemon storage (~/.apx/…/conversations/)
      const convAgentsDir = path.join(p.storagePath, "agents");
      if (fs.existsSync(convAgentsDir)) {
        for (const slug of fs.readdirSync(convAgentsDir)) {
          const convDir = path.join(convAgentsDir, slug, "conversations");
          if (!fs.existsSync(convDir)) continue;
          for (const f of fs
            .readdirSync(convDir)
            .filter((x) => x.endsWith(".md"))) {
            const filePath = path.join(convDir, f);
            try {
              const text = fs.readFileSync(filePath, "utf8");
              if (text.toLowerCase().includes(needle)) {
                const lines = text.split("\n");
                const matchLine = lines.findIndex((l) =>
                  l.toLowerCase().includes(needle)
                );
                const excerpt = lines
                  .slice(Math.max(0, matchLine - 1), matchLine + 3)
                  .join("\n");
                matches.push({
                  type: "conversation",
                  project: p.id,
                  agent: slug,
                  filename: f,
                  path: filePath,
                  excerpt: excerpt.slice(0, 300),
                });
                if (matches.length >= lim) break;
              }
            } catch {}
          }
          if (matches.length >= lim) break;
        }
      }

      if (matches.length >= lim) break;
    }

    res.json({ q, count: matches.length, results: matches });
  });

  app.post("/sessions/:id/compact", async (req, res) => {
    const { id } = req.params;
    const { model: modelOverride, project: projectRef } = req.body || {};

    const candidates =
      projectRef != null
        ? (() => {
            const ref = String(projectRef);
            const found = projects
              .list()
              .find(
                (p) => String(p.id) === ref || p.path === path.resolve(ref)
              );
            return found ? [projects.get(found.id)] : [];
          })()
        : projects.list().map((p) => projects.get(p.id)).filter(Boolean);

    let found = null;
    const filename = id.endsWith(".md") ? id : `${id}.md`;

    for (const p of candidates) {
      if (!p) continue;
      const agentsDir = path.join(p.storagePath, "agents");
      if (fs.existsSync(agentsDir)) {
        for (const slug of fs.readdirSync(agentsDir)) {
          const f = path.join(agentsDir, slug, "conversations", filename);
          if (fs.existsSync(f)) {
            found = { p, slug };
            break;
          }
        }
      }
      if (found) break;
    }

    if (!found) {
      return res
        .status(404)
        .json({ error: `session/conversation "${id}" not found` });
    }

    const { p, slug } = found;
    const agents = readAgents(p.path);
    const agent = agents.find((a) => a.slug === slug);
    const modelId = modelOverride || agent?.fields?.Model;
    if (!modelId)
      return res
        .status(400)
        .json({ error: "agent has no model; pass model in body" });

    try {
      const result = await compactConversation({
        storagePath: p.storagePath,
        agentSlug: slug,
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
