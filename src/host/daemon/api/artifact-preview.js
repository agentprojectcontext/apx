// Artifact preview + sharing routes.
//   POST   /projects/:pid/artifacts/:name/preview   body: { watch? }
//   GET    /projects/:pid/previews
//   GET    /previews
//   DELETE /previews/:id
//   POST   /previews/:id/tunnel                      body: { provider? }
//   DELETE /previews/:id/tunnel
//
// Preview servers and tunnels live in process-wide singletons (see
// #core/artifacts/preview.js and tunnel.js) so they survive across requests
// for the daemon's lifetime.
import { previews } from "#core/artifacts/preview.js";
import { tunnels, detectProviders } from "#core/artifacts/tunnel.js";

export function register(app, { project }) {
  // Start (or reuse) an ephemeral preview server for an artifact.
  app.post("/projects/:pid/artifacts/:name/preview", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const name = decodeURIComponent(req.params.name);
    const watch = req.body?.watch !== false;
    try {
      const view = await previews.start({
        storagePath: p.storagePath,
        name,
        projectId: p.id,
        watch,
      });
      res.status(201).json(view);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // List preview servers scoped to a project.
  app.get("/projects/:pid/previews", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(previews.list(p.id));
  });

  // List every live preview (all projects).
  app.get("/previews", (_req, res) => {
    res.json(previews.list());
  });

  // Which tunnel providers this host can use, best first.
  app.get("/previews/tunnel-providers", (_req, res) => {
    res.json({ providers: detectProviders() });
  });

  // Stop a preview server (also closes its tunnel).
  app.delete("/previews/:id", async (req, res) => {
    const rec = previews.get(req.params.id);
    if (rec?.tunnel) tunnels.close(rec.tunnel.id);
    const ok = await previews.stop(req.params.id);
    res.status(ok ? 204 : 404).end();
  });

  // Open a public tunnel to a preview's local port.
  app.post("/previews/:id/tunnel", async (req, res) => {
    const rec = previews.get(req.params.id);
    if (!rec) return res.status(404).json({ error: "preview not found" });
    if (rec.tunnel) return res.json(rec.tunnel); // already shared
    try {
      const tunnel = await tunnels.open(rec.port, { provider: req.body?.provider });
      previews.attachTunnel(rec.id, tunnel);
      res.status(201).json(tunnel);
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // Close a preview's tunnel but keep the local server running.
  app.delete("/previews/:id/tunnel", (req, res) => {
    const rec = previews.get(req.params.id);
    if (!rec || !rec.tunnel) return res.status(404).end();
    tunnels.close(rec.tunnel.id);
    previews.attachTunnel(rec.id, null);
    res.status(204).end();
  });
}
