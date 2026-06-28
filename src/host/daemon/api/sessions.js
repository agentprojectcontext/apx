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
import { collectAllSessions, filterSessionsByQuery } from "#interfaces/cli/commands/sessions.js";
import { pageEnvelope } from "./shared.js";

export function register(app, { projects, project }) {
  // Cross-engine sessions (apx · claude · codex), newest first. Returns a
  // { meta, data } envelope (meta = pagination info, data = rows). Paginated
  // via ?limit & ?offset; with no limit, data is the full set as one page.
  // Optional ?q= filters via the same core as `apx session find` (title match,
  // + transcript content when ?deep=1) so terminal and web search are identical.
  app.get("/sessions", (req, res) => {
    const engineId = req.query.engine ? String(req.query.engine) : null;
    const q = req.query.q ? String(req.query.q) : "";
    const deep = req.query.deep === "1" || req.query.deep === "true";
    let rows = [];
    try {
      rows = collectAllSessions({}, { engineId });
    } catch (e) {
      return res.status(500).json({ error: e.message, meta: { total: 0, offset: 0, limit: null, pageSize: 0, page: 1, pageCount: 1 }, data: [] });
    }
    if (q.trim()) {
      // filterSessionsByQuery already de-dupes and sorts newest-first.
      rows = filterSessionsByQuery(rows, { query: q, deep });
    } else {
      rows.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    }
    res.json(pageEnvelope(rows, req.query));
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
