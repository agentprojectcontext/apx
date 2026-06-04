// Project-scoped managed files (storagePath/artifacts/).
//   GET    /projects/:pid/artifacts
//   POST   /projects/:pid/artifacts
//   GET    /projects/:pid/artifacts/:name
//   DELETE /projects/:pid/artifacts/:name
import {
  createArtifact,
  listArtifacts,
  readArtifact,
  removeArtifact,
} from "../../../core/artifacts-store.js";

export function register(app, { project }) {
  app.get("/projects/:pid/artifacts", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(listArtifacts(p.storagePath));
  });

  app.post("/projects/:pid/artifacts", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { name, content = "" } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    try {
      const filePath = createArtifact(p.storagePath, name, content);
      res.status(201).json({ name, path: filePath });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/projects/:pid/artifacts/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      res.json(readArtifact(p.storagePath, decodeURIComponent(req.params.name)));
    } catch (e) {
      res.status(404).json({ error: e.message });
    }
  });

  app.delete("/projects/:pid/artifacts/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const ok = removeArtifact(
      p.storagePath,
      decodeURIComponent(req.params.name)
    );
    res.status(ok ? 204 : 404).end();
  });
}
