// Per-project config (.apc/config.json) — read, full replace, dotted patch.
//   GET   /projects/:pid/config        effective + project-only
//   PUT   /projects/:pid/config        full replace of project-only file
//   PATCH /projects/:pid/config        { set?: {dotted: value}, unset?: [dotted] }
import path from "node:path";
import {
  readProjectConfig,
  writeProjectConfig,
  setDottedKey,
  unsetDottedKey,
} from "../project-config.js";

export function register(app, { projects, project }) {
  app.get("/projects/:pid/config", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json({
      effective: p.config || {},
      project_only: readProjectConfig(p.path),
      project_config_path: path.join(p.path, ".apc", "config.json"),
    });
  });

  app.put("/projects/:pid/config", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const body = req.body || {};
    if (typeof body !== "object" || Array.isArray(body))
      return res.status(400).json({ error: "body must be a JSON object" });
    writeProjectConfig(p.path, body);
    projects.rebuild(p.id);
    res.json({ ok: true });
  });

  app.patch("/projects/:pid/config", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { set, unset } = req.body || {};
    const cfg = readProjectConfig(p.path);
    if (set && typeof set === "object") {
      for (const [k, v] of Object.entries(set)) setDottedKey(cfg, k, v);
    }
    if (Array.isArray(unset)) {
      for (const k of unset) unsetDottedKey(cfg, k);
    }
    writeProjectConfig(p.path, cfg);
    projects.rebuild(p.id);
    res.json({ ok: true, project_only: cfg });
  });
}
