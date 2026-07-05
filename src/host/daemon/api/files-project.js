// Project file browser + docs editor API.
//
// A sandboxed view of one project's own files. `scope` selects the sandbox:
//   project — the whole repo (the /files browser)
//   docs     — the docs subfolder (config docs.root, default "docs"); powers
//              the /docs spec editor
//
//   GET    /projects/:pid/fs/tree?scope=project|docs
//   GET    /projects/:pid/fs/file?scope=…&path=<rel>
//   PUT    /projects/:pid/fs/file        body { scope?, path, content }
//   POST   /projects/:pid/fs/dir         body { scope?, path }
//   DELETE /projects/:pid/fs/entry?scope=…&path=<rel>
//
// Thin adapter over core/stores/project-files.
import {
  listTree,
  readFile,
  writeFile,
  makeDir,
  removeEntry,
  docsSubdir,
} from "#core/stores/project-files.js";

// Resolve the sandbox subdir for a scope. Unknown scope → project root.
function scopeOpts(p, scope) {
  if (scope === "docs") return { subdir: docsSubdir(p.config), scope: "docs" };
  return { subdir: "", scope: "project" };
}

export function register(app, { project }) {
  app.get("/projects/:pid/fs/tree", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { subdir, scope } = scopeOpts(p, req.query?.scope);
    try {
      res.json({ scope, ...listTree(p.path, { subdir }) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/projects/:pid/fs/file", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const rel = req.query?.path;
    if (!rel) return res.status(400).json({ error: "path required" });
    const { subdir } = scopeOpts(p, req.query?.scope);
    try {
      const file = readFile(p.path, String(rel), { subdir });
      if (!file) return res.status(404).json({ error: "file not found" });
      res.json(file);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put("/projects/:pid/fs/file", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { path: rel, content, scope } = req.body || {};
    if (!rel) return res.status(400).json({ error: "path required" });
    if (typeof content !== "string")
      return res.status(400).json({ error: "content must be a string" });
    const { subdir } = scopeOpts(p, scope);
    try {
      res.json(writeFile(p.path, String(rel), content, { subdir }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/projects/:pid/fs/dir", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { path: rel, scope } = req.body || {};
    if (!rel) return res.status(400).json({ error: "path required" });
    const { subdir } = scopeOpts(p, scope);
    try {
      res.status(201).json(makeDir(p.path, String(rel), { subdir }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/projects/:pid/fs/entry", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const rel = req.query?.path;
    if (!rel) return res.status(400).json({ error: "path required" });
    const { subdir } = scopeOpts(p, req.query?.scope);
    try {
      if (!removeEntry(p.path, String(rel), { subdir }))
        return res.status(404).json({ error: "entry not found" });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
