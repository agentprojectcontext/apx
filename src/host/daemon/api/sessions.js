// Per-agent session files (.apc-style markdown, lives under storagePath).
//   GET  /projects/:pid/agents/:slug/sessions
//   POST /projects/:pid/agents/:slug/sessions      { title, body? }
//   GET  /projects/:pid/sessions/:sid              by filename (cross-agent lookup)
import fs from "node:fs";
import path from "node:path";
import { readAgents } from "#core/apc/parser.js";
import {
  parseSessionFrontmatter,
} from "#core/apc/parser.js";
import {
  agentSessionsDir,
  createAgentSessionFile,
} from "#core/stores/sessions.js";
import { collectAllSessions } from "#interfaces/cli/commands/sessions.js";

export function register(app, { projects, project }) {
  // Cross-engine sessions (apx · claude · codex), newest first.
  // Paginated via ?limit & ?offset; the full count is returned in the
  // X-Total-Count header so the UI can compute page counts. The body shape
  // ({ sessions }) is unchanged for backward compatibility.
  app.get("/sessions", (req, res) => {
    const engineId = req.query.engine ? String(req.query.engine) : null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    let rows = [];
    try {
      rows = collectAllSessions({}, { engineId });
    } catch (e) {
      return res.status(500).json({ error: e.message, sessions: [] });
    }
    rows.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    res.set("X-Total-Count", String(rows.length));
    res.set("Access-Control-Expose-Headers", "X-Total-Count");
    res.json({ sessions: rows.slice(offset, offset + limit) });
  });

  app.get("/projects/:pid/agents/:slug/sessions", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const agents = readAgents(p.path);
    if (!agents.find((a) => a.slug === req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    const sessionsDir = agentSessionsDir(p.storagePath, req.params.slug);
    if (!fs.existsSync(sessionsDir)) return res.json([]);
    const sessions = fs
      .readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .map((f) => {
        const text = fs.readFileSync(path.join(sessionsDir, f), "utf8");
        const fm = parseSessionFrontmatter(text);
        const titleFromFile = f
          .replace(/^\d{4}-\d{2}-\d{2}-/, "")
          .replace(/\.md$/, "");
        return {
          filename: f,
          title: fm.title || titleFromFile,
          started_at: fm.started || null,
          ended_at: fm.ended || null,
        };
      });
    res.json(sessions);
  });

  app.post("/projects/:pid/agents/:slug/sessions", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { title, body = "" } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    const { filename, path: filePath } = createAgentSessionFile(
      p.storagePath,
      req.params.slug,
      { title, body }
    );
    projects.rebuild(p.id);
    res.status(201).json({ filename, path: filePath });
  });

  // GET session by filename (sid may include or omit the .md extension)
  app.get("/projects/:pid/sessions/:sid", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const sid = req.params.sid;
    const filename = sid.endsWith(".md") ? sid : `${sid}.md`;
    const agentsDir = path.join(p.storagePath, "agents");
    let found = null;
    if (fs.existsSync(agentsDir)) {
      for (const slug of fs.readdirSync(agentsDir)) {
        const f = path.join(agentsDir, slug, "sessions", filename);
        if (fs.existsSync(f)) {
          const text = fs.readFileSync(f, "utf8");
          const fm = parseSessionFrontmatter(text);
          found = { filename, agent: slug, ...fm, body_md: text };
          break;
        }
      }
    }
    if (!found) return res.status(404).json({ error: "session not found" });
    res.json(found);
  });
}
