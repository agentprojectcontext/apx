// Organization structure (areas + roles) per project.
//
//   GET    /projects/:pid/organization                 -> { areas, roles }
//   POST   /projects/:pid/organization/areas           body { name, slug?, goal? }
//   PATCH  /projects/:pid/organization/areas/:slug      body { name?, goal? }
//   DELETE /projects/:pid/organization/areas/:slug      -> { ok }
//   POST   /projects/:pid/organization/roles           body { name, slug?, area?, description? }
//   PATCH  /projects/:pid/organization/roles/:slug      body { name?, area?, description? }
//   DELETE /projects/:pid/organization/roles/:slug      -> { ok }
//
// Thin adapter: parse body, call core/stores/organization, shape the response.
import {
  readOrganization,
  createArea,
  updateArea,
  removeArea,
  createRole,
  updateRole,
  removeRole,
} from "#core/stores/organization.js";

export function register(app, { project }) {
  app.get("/projects/:pid/organization", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(readOrganization(p.path));
  });

  app.post("/projects/:pid/organization/areas", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      res.status(201).json(createArea(p.path, req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/projects/:pid/organization/areas/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      const area = updateArea(p.path, req.params.slug, req.body || {});
      if (!area) return res.status(404).json({ error: "area not found" });
      res.json(area);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/projects/:pid/organization/areas/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    if (!removeArea(p.path, req.params.slug))
      return res.status(404).json({ error: "area not found" });
    res.json({ ok: true });
  });

  app.post("/projects/:pid/organization/roles", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      res.status(201).json(createRole(p.path, req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/projects/:pid/organization/roles/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      const role = updateRole(p.path, req.params.slug, req.body || {});
      if (!role) return res.status(404).json({ error: "role not found" });
      res.json(role);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/projects/:pid/organization/roles/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    if (!removeRole(p.path, req.params.slug))
      return res.status(404).json({ error: "role not found" });
    res.json({ ok: true });
  });
}
