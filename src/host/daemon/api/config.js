// Per-project config (.apc/config.json) — read, full replace, dotted patch.
//   GET   /projects/:pid/config        effective + project-only
//   PUT   /projects/:pid/config        full replace of project-only file
//   PATCH /projects/:pid/config        { set?: {dotted: value}, unset?: [dotted] }
import path from "node:path";
import fs from "node:fs";
import {
  readProjectConfig,
  writeProjectConfig,
  setDottedKey,
  unsetDottedKey,
} from "../project-config.js";

function projectJsonPath(root) {
  return path.join(root, ".apc", "project.json");
}

function readProjectJson(root) {
  const p = projectJsonPath(root);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeProjectJson(root, body) {
  const p = projectJsonPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(body, null, 2) + "\n");
}

export function register(app, { projects, project }) {
  app.get("/projects/:pid/config", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json({
      effective: p.config || {},
      project_only: readProjectConfig(p.path),
      project_config_path: path.join(p.path, ".apc", "config.json"),
      apc_project: readProjectJson(p.path),
      project_json_path: projectJsonPath(p.path),
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

  app.put("/projects/:pid/apc-project", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const body = req.body || {};
    if (typeof body !== "object" || Array.isArray(body))
      return res.status(400).json({ error: "body must be a JSON object" });
    try {
      writeProjectJson(p.path, body);
      projects.rebuild(p.id);
      res.json({ ok: true, apc_project: body });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/projects/:pid/apc-project", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      const { set, unset } = req.body || {};
      const cfg = readProjectJson(p.path);
      if (set && typeof set === "object") {
        for (const [k, v] of Object.entries(set)) setDottedKey(cfg, k, v);
      }
      if (Array.isArray(unset)) {
        for (const k of unset) unsetDottedKey(cfg, k);
      }
      writeProjectJson(p.path, cfg);
      projects.rebuild(p.id);
      res.json({ ok: true, apc_project: cfg });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
