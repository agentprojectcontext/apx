// Top-level shortcuts used by the MCP server and other thin clients that
// don't want to track project IDs. Every endpoint resolves a project via
// ?project= or falls back to the first non-default project.
//
//   GET  /memory                 read first agent's memory.md
//   POST /memory                 write it
//   GET  /files                  list project root (no ?path=) or read a file
//   POST /files                  write a file inside the project tree
//   GET  /mcp                    list MCPs of the resolved project
//   POST /mcp/run                call an MCP tool
import fs from "node:fs";
import path from "node:path";
import { resolveMemoryPath } from "./shared.js";

export function register(app, { projects, registries, resolveTopProject }) {
  // ---- /memory ----
  app.get("/memory", (req, res) => {
    const p = resolveTopProject(req.query);
    if (!p) return res.status(404).json({ error: "no project registered" });
    const memPath = resolveMemoryPath(p);
    const body = fs.existsSync(memPath) ? fs.readFileSync(memPath, "utf8") : "";
    res.json({ project_id: p.id, path: memPath, body });
  });

  app.post("/memory", (req, res) => {
    const p = resolveTopProject(req.query);
    if (!p) return res.status(404).json({ error: "no project registered" });
    const { body } = req.body || {};
    if (typeof body !== "string")
      return res.status(400).json({ error: "body must be string" });
    const memPath = resolveMemoryPath(p);
    fs.mkdirSync(path.dirname(memPath), { recursive: true });
    fs.writeFileSync(memPath, body);
    try {
      projects.rebuild(p.id);
    } catch {}
    res.json({
      ok: true,
      path: memPath,
      bytes: Buffer.byteLength(body, "utf8"),
    });
  });

  // ---- /files ----
  app.get("/files", (req, res) => {
    const p = resolveTopProject(req.query);
    if (!p) return res.status(404).json({ error: "no project registered" });
    const rel = req.query.path;
    if (!rel) {
      try {
        const entries = fs.readdirSync(p.path).map((name) => {
          const full = path.join(p.path, name);
          const stat = fs.statSync(full);
          return {
            name,
            type: stat.isDirectory() ? "dir" : "file",
            size: stat.isDirectory() ? null : stat.size,
          };
        });
        return res.json({ project_id: p.id, cwd: p.path, entries });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }
    const abs = path.resolve(p.path, rel);
    if (!abs.startsWith(path.resolve(p.path)))
      return res.status(403).json({ error: "path escapes project root" });
    if (!fs.existsSync(abs))
      return res.status(404).json({ error: "not found" });
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(abs).map((name) => {
        const s = fs.statSync(path.join(abs, name));
        return {
          name,
          type: s.isDirectory() ? "dir" : "file",
          size: s.isDirectory() ? null : s.size,
        };
      });
      return res.json({ project_id: p.id, path: rel, type: "dir", entries });
    }
    const content = fs.readFileSync(abs, "utf8");
    res.json({
      project_id: p.id,
      path: rel,
      type: "file",
      size: stat.size,
      content,
    });
  });

  app.post("/files", (req, res) => {
    const p = resolveTopProject(req.query);
    if (!p) return res.status(404).json({ error: "no project registered" });
    const { path: rel, content } = req.body || {};
    if (!rel) return res.status(400).json({ error: "path required" });
    if (typeof content !== "string")
      return res.status(400).json({ error: "content must be string" });
    const abs = path.resolve(p.path, rel);
    if (!abs.startsWith(path.resolve(p.path)))
      return res.status(403).json({ error: "path escapes project root" });
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    res.json({
      ok: true,
      path: rel,
      bytes: Buffer.byteLength(content, "utf8"),
    });
  });

  // ---- /mcp ----
  app.get("/mcp", (req, res) => {
    const p = resolveTopProject(req.query);
    if (!p) return res.status(404).json({ error: "no project registered" });
    res.json(registries.for(p).list());
  });

  app.post("/mcp/run", async (req, res) => {
    const { project: projectRef, name, tool, params } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    if (!tool) return res.status(400).json({ error: "tool required" });
    const p = resolveTopProject({ project: projectRef });
    if (!p) return res.status(404).json({ error: "no project registered" });
    try {
      const result = await registries.for(p).call(name, tool, params);
      res.json({ ok: true, result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
