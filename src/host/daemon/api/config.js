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
import { apcProjectFile, apcProjectConfigFile } from "#core/apc/paths.js";
import { redactConfig, mergeRedactedSecrets, isSecretMarker } from "#core/config/redact.js";

const projectJsonPath = apcProjectFile;

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
    // Redact secrets (engine api_keys, telegram bot tokens) the same way the
    // global admin config does — the UI shows "…XXXXX" and echoes the marker
    // back unchanged, which the write paths below restore from disk.
    res.json({
      effective: redactConfig(p.config || {}),
      project_only: redactConfig(readProjectConfig(p.path)),
      project_config_path: apcProjectConfigFile(p.path),
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
    // A redacted secret echoed back means "keep the real value" — restore it
    // from disk so a full replace of the redacted view can't wipe secrets.
    const merged = mergeRedactedSecrets(body, readProjectConfig(p.path));
    writeProjectConfig(p.path, merged);
    projects.rebuild(p.id);
    res.json({ ok: true });
  });

  app.patch("/projects/:pid/config", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { set, unset } = req.body || {};
    const cfg = readProjectConfig(p.path);
    if (set && typeof set === "object") {
      // Skip echoed secret markers so a redacted field left untouched keeps its
      // real value instead of being overwritten with the marker string.
      for (const [k, v] of Object.entries(set)) {
        if (isSecretMarker(v)) continue;
        setDottedKey(cfg, k, v);
      }
    }
    if (Array.isArray(unset)) {
      for (const k of unset) unsetDottedKey(cfg, k);
    }
    writeProjectConfig(p.path, cfg);
    projects.rebuild(p.id);
    res.json({ ok: true, project_only: redactConfig(cfg) });
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
