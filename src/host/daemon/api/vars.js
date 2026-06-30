// Variable management per project. Reads/writes the two APX-owned scopes
// (project = <storagePath>/vars.json, global = ~/.apx/vars.json) and
// surfaces a merged effective view with sources annotated.
//
//   GET    /projects/:pid/vars              -> { project, global, effective, sources }
//                                              values masked unless ?reveal=1
//   GET    /projects/:pid/vars/:name        -> { name, scope, value, masked }
//                                              ?reveal=1 unmasks
//   POST   /projects/:pid/vars              -> { ok, name, scope }
//                                              body { name, value, scope }
//                                              scope defaults to "project" (or
//                                              "global" if pid=0).
//   DELETE /projects/:pid/vars/:name?scope=… 204
//
// pid=0 (base project) is the conventional bucket for editing global vars
// from the web UI; project scope is rejected there because there is no
// storagePath that belongs to a real project.
import {
  loadAllVars,
  readGlobalVars,
  readProjectVars,
  setVar,
  deleteVar,
  maskValue,
} from "#core/vars/index.js";

function normalizeScope(raw, { isBase }) {
  if (!raw) return isBase ? "global" : "project";
  const s = String(raw).toLowerCase();
  if (s === "project" || s === "global") return s;
  return null;
}

function maskAll(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = maskValue(v);
  return out;
}

export function register(app, { project, registries }) {
  app.get("/projects/:pid/vars", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const reveal = req.query?.reveal === "1" || req.query?.reveal === "true";
    const { project: proj, global, effective, sources } = loadAllVars({
      storagePath: p.storagePath,
    });
    res.json({
      scope_hint: String(p.id) === "0" ? "global" : "project",
      project: reveal ? proj : maskAll(proj),
      global: reveal ? global : maskAll(global),
      effective: reveal ? effective : maskAll(effective),
      sources,
    });
  });

  app.get("/projects/:pid/vars/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const name = req.params.name;
    const proj = p.storagePath ? readProjectVars(p.storagePath) : {};
    const global = readGlobalVars();
    let scope = null;
    let value = null;
    if (Object.prototype.hasOwnProperty.call(proj, name)) {
      scope = "project";
      value = proj[name];
    } else if (Object.prototype.hasOwnProperty.call(global, name)) {
      scope = "global";
      value = global[name];
    } else {
      return res.status(404).json({ error: `variable "${name}" not found` });
    }
    const reveal = req.query?.reveal === "1" || req.query?.reveal === "true";
    res.json({
      name,
      scope,
      value: reveal ? value : maskValue(value),
      masked: !reveal,
    });
  });

  app.post("/projects/:pid/vars", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { name, value } = req.body || {};
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name required" });
    }
    if (value === undefined || value === null) {
      return res.status(400).json({ error: "value required" });
    }
    const isBase = String(p.id) === "0";
    const scope = normalizeScope(req.body?.scope, { isBase });
    if (scope === null) {
      return res
        .status(400)
        .json({ error: `unknown scope "${req.body?.scope}" (use project|global)` });
    }
    if (scope === "project" && (!p.storagePath || isBase)) {
      return res.status(400).json({
        error: "project scope is not available for the base workspace — use scope=global",
      });
    }
    try {
      setVar({ storagePath: p.storagePath, scope, name, value });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (registries) registries.shutdown();
    res.status(201).json({ ok: true, name, scope });
  });

  app.delete("/projects/:pid/vars/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const isBase = String(p.id) === "0";
    const scope = normalizeScope(req.query?.scope, { isBase });
    if (scope === null) {
      return res
        .status(400)
        .json({ error: `unknown scope "${req.query?.scope}" (use project|global)` });
    }
    if (scope === "project" && (!p.storagePath || isBase)) {
      return res.status(400).json({
        error: "project scope is not available for the base workspace",
      });
    }
    let removed;
    try {
      removed = deleteVar({ storagePath: p.storagePath, scope, name: req.params.name });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (!removed) return res.status(404).end();
    if (registries) registries.shutdown();
    res.status(204).end();
  });
}
