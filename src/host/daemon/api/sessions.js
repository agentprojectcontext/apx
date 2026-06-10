// Per-agent session files (.apc-style markdown, lives under storagePath).
//   GET  /projects/:pid/agents/:slug/sessions
//   POST /projects/:pid/agents/:slug/sessions      { title, body? }
//   GET  /projects/:pid/sessions/:sid              by filename (cross-agent lookup)
import fs from "node:fs";
import path from "node:path";
import { parseSessionFrontmatter, readAgents } from "../../../core/apc/parser.js";
import { collectAllSessions } from "../../../interfaces/cli/commands/sessions.js";
import { nowIso } from "./shared.js";

export function register(app, { projects, project }) {
  // Cross-engine sessions (apx · claude · codex), newest first.
  app.get("/sessions", (req, res) => {
    const engineId = req.query.engine ? String(req.query.engine) : null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    let rows = [];
    try {
      rows = collectAllSessions({}, { engineId });
    } catch (e) {
      return res.status(500).json({ error: e.message, sessions: [] });
    }
    rows.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    res.json({ sessions: rows.slice(0, limit) });
  });

  app.get("/projects/:pid/agents/:slug/sessions", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const agents = readAgents(p.path);
    if (!agents.find((a) => a.slug === req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    const sessionsDir = path.join(
      p.storagePath,
      "agents",
      req.params.slug,
      "sessions"
    );
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
    const sessionsDir = path.join(
      p.storagePath,
      "agents",
      req.params.slug,
      "sessions"
    );
    fs.mkdirSync(sessionsDir, { recursive: true });
    const titleSlug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "session";
    const today = new Date().toISOString().slice(0, 10);
    let candidate = path.join(sessionsDir, `${today}-${titleSlug}.md`);
    let n = 2;
    while (fs.existsSync(candidate)) {
      candidate = path.join(sessionsDir, `${today}-${titleSlug}-${n}.md`);
      n++;
    }
    const started = nowIso();
    const content = `---\ntitle: ${title}\nstarted: ${started}\n---\n\n# ${title}\n\n${body}\n`;
    fs.writeFileSync(candidate, content);
    projects.rebuild(p.id);
    res
      .status(201)
      .json({ filename: path.basename(candidate), path: candidate });
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
