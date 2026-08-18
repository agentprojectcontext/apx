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
import {
  collectAllSessions,
  filterSessionsByQuery,
  findSessionAcrossEngines,
  findSessionInEngine,
  resumeCommandFor,
} from "#core/sessions/index.js";
import { readEngineSessionContext } from "#core/stores/engine-sessions.js";
import { pageEnvelope } from "./shared.js";

export function register(api, { projects, project }) {
  // Cross-engine sessions (apx · claude · codex · opencode), newest first. Returns a
  // { meta, data } envelope (meta = pagination info, data = rows). Paginated
  // via ?limit & ?offset; with no limit, data is the full set as one page.
  // Optional ?q= filters via the same core as `apx session find` (title match,
  // + transcript content when ?deep=1) so terminal and web search are identical.
  api.get("/sessions", (req, res) => {
    const engineId = req.query.engine ? String(req.query.engine) : null;
    const q = req.query.q ? String(req.query.q) : "";
    const deep = req.query.deep === "1" || req.query.deep === "true";
    // Optional ?cwd= scopes to sessions whose working dir is that folder (or a
    // child of it) — used by the per-project Sessions view. Omitted = all.
    const cwd = req.query.cwd ? String(req.query.cwd).replace(/\/+$/, "") : "";
    let rows = [];
    try {
      rows = collectAllSessions({}, { engineId });
    } catch (e) {
      return res.status(500).json({ error: e.message, meta: { total: 0, offset: 0, limit: null, pageSize: 0, page: 1, pageCount: 1 }, data: [] });
    }
    if (cwd) {
      rows = rows.filter((r) => {
        const c = (r.cwd || "").replace(/\/+$/, "");
        return c === cwd || c.startsWith(cwd + "/");
      });
    }
    if (q.trim()) {
      // filterSessionsByQuery already de-dupes and sorts newest-first.
      rows = filterSessionsByQuery(rows, { query: q, deep });
    } else {
      rows.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    }
    res.json(pageEnvelope(rows, req.query));
  });

  // One session, enough to decide what to do with it: what it was about, and
  // the command that re-enters it. The list can't carry this — the working
  // directory and last prompt cost a file read (or, for OpenCode, a subprocess)
  // per session, which is affordable once and not eighty times.
  //
  // ?engine= disambiguates when two engines mint the same id; without it the
  // first engine that recognises the id answers.
  api.get("/sessions/:id", (req, res) => {
    const id = String(req.params.id || "");
    const engineId = req.query.engine ? String(req.query.engine) : null;
    let meta = null;
    try {
      meta = engineId ? findSessionInEngine(engineId, id) : (findSessionAcrossEngines(id)[0] || null);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
    if (!meta) return res.status(404).json({ error: "session not found" });

    // Engines that hand us a transcript path get read for a summary; the ones
    // that answered from their own CLI already included what they know.
    let ctx = null;
    try { ctx = meta.path ? readEngineSessionContext(meta) : null; } catch { ctx = null; }

    res.json({
      engine: meta.engine,
      id: meta.id,
      title: ctx?.title || meta.title || "",
      last_prompt: ctx?.lastPrompt || meta.lastPrompt || null,
      cwd: meta.cwd || null,
      path: meta.path || null,
      mtime: meta.mtime || 0,
      resume_command: resumeCommandFor(meta.engine, meta.id),
    });
  });

  api.get("/projects/:pid/agents/:slug/sessions", (req, res) => {
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

  api.post("/projects/:pid/agents/:slug/sessions", (req, res) => {
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
  api.get("/projects/:pid/sessions/:sid", (req, res) => {
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
