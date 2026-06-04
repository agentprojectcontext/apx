// Daemon plugin status surface.
//   GET /plugins              status of every loaded plugin
//   GET /plugins/:id/status   single plugin
export function register(app, { plugins }) {
  app.get("/plugins", (_req, res) => {
    if (!plugins) return res.json({});
    res.json(plugins.status());
  });

  app.get("/plugins/:id/status", (req, res) => {
    if (!plugins) return res.status(404).end();
    const inst = plugins.get(req.params.id);
    if (!inst)
      return res
        .status(404)
        .json({ error: `plugin ${req.params.id} not loaded` });
    res.json(inst.status?.() || {});
  });
}
