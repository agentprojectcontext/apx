// Project lifecycle endpoints.
//   GET    /projects               list registered projects
//   POST   /projects               register a project by path
//   DELETE /projects/:id           unregister
//   POST   /projects/:id/rebuild   force a context rebuild from disk
export function register(app, { projects, registries, addProjectGlobally }) {
  app.get("/projects", (_req, res) => res.json(projects.list()));

  app.post("/projects", (req, res) => {
    const { path: p } = req.body || {};
    if (!p) return res.status(400).json({ error: "path required" });
    try {
      const entry = projects.register(p);
      addProjectGlobally(entry.path);
      registries.ensure(entry);
      res.status(201).json({ id: entry.id, path: entry.path });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/projects/:id", (req, res) => {
    const ok = projects.unregister(req.params.id);
    res.status(ok ? 204 : 404).end();
  });

  app.post("/projects/:id/rebuild", (req, res) => {
    try {
      const result = projects.rebuild(req.params.id);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
