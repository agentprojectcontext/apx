// Agent CRUD + per-agent memory.
//   GET  /projects/:pid/agents
//   GET  /projects/:pid/agents/:slug                — also returns memory.md
//   POST /projects/:pid/agents                      — create from slug
//   GET  /projects/:pid/agents/:slug/memory
//   PUT  /projects/:pid/agents/:slug/memory
import fs from "node:fs";
import path from "node:path";
import { readAgents, readVaultAgents, readVaultAgent } from "../../../core/parser.js";
import {
  writeAgentFile,
  writeVaultAgentFile,
  removeVaultAgent,
  restoreVaultAgent,
  ensureAgentDir,
} from "../../../core/scaffold.js";
import { agentToResponse } from "./shared.js";

// Lowercase the patch keys we accept on the vault and turn skills/tools into
// arrays. The writer takes either case but normalizes; passing this through
// it keeps the on-disk format consistent.
const VAULT_PATCH_FIELDS = ["role", "model", "language", "description", "skills", "tools", "is_master"];
function normalizeVaultPatch(input = {}) {
  const out = {};
  for (const k of VAULT_PATCH_FIELDS) {
    const lower = k;
    const title = k.charAt(0).toUpperCase() + k.slice(1);
    const v = input[lower] ?? input[title];
    if (v === undefined || v === null) continue;
    if (k === "skills" || k === "tools") {
      out[title] = Array.isArray(v)
        ? v.map(String).map((s) => s.trim()).filter(Boolean)
        : String(v).split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      out[title] = v;
    }
  }
  return out;
}

export function register(app, { projects, project }) {
  // Vault = global agent templates. Two-layer: bundled defaults shipped with
  // APX (assets/agent-vault-defaults/) + user overrides/new ones in
  // ~/.apx/agents/. The user layer wins per slug; tombstones in .removed.json
  // hide bundled entries. GET merges both with `source` set per item.
  app.get("/agents/vault", (req, res) => {
    const includeRemoved = req.query?.include_removed === "1";
    res.json(readVaultAgents({ includeRemoved }).map((a) => ({
      ...agentToResponse(a),
      source: a.source, // "bundled" | "user" | "user-override"
    })));
  });

  // Create or replace a vault template (user layer / copy-on-write).
  app.post("/agents/vault", (req, res) => {
    const { slug, fields, body = "" } = req.body || {};
    if (!slug || !/^[a-z][a-z0-9_-]*$/.test(slug)) {
      return res.status(400).json({ error: "valid slug required" });
    }
    try {
      writeVaultAgentFile(slug, normalizeVaultPatch(fields || {}), body);
      const created = readVaultAgent(slug);
      res.status(201).json(created ? agentToResponse(created) : { slug });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Patch a vault template. If the slug is bundled-only, copy it to the user
  // layer first (the writer already does this), then apply the merged fields.
  app.patch("/agents/vault/:slug", (req, res) => {
    const { slug } = req.params;
    const current = readVaultAgent(slug);
    if (!current) return res.status(404).json({ error: `vault agent ${slug} not found` });
    const patch = normalizeVaultPatch(req.body?.fields || req.body || {});
    const mergedFields = { ...(current.fields || {}), ...patch };
    const body = req.body?.body !== undefined ? String(req.body.body) : (current.body || "");
    try {
      writeVaultAgentFile(slug, mergedFields, body);
      const after = readVaultAgent(slug);
      res.json(after ? agentToResponse(after) : { slug });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Delete a vault template. Tombstones bundled slugs so they stay hidden;
  // deletes the user-layer file otherwise. POST .../restore lifts a tombstone.
  app.delete("/agents/vault/:slug", (req, res) => {
    const { slug } = req.params;
    const out = removeVaultAgent(slug);
    if (!out.removed) return res.status(404).json({ error: `vault agent ${slug} not found` });
    res.json({ ok: true, ...out });
  });

  app.post("/agents/vault/:slug/restore", (req, res) => {
    const { slug } = req.params;
    const out = restoreVaultAgent(slug);
    if (!out.restored) return res.status(404).json({ error: `slug ${slug} was not tombstoned` });
    const after = readVaultAgent(slug);
    res.json({ ok: true, agent: after ? agentToResponse(after) : null });
  });

  // Import a vault template into a project (copies it to .apc/agents/<slug>.md).
  app.post("/projects/:pid/agents/import", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { slug } = req.body || {};
    if (!slug) return res.status(400).json({ error: "slug required" });
    const vault = readVaultAgents().find((a) => a.slug === slug);
    if (!vault) return res.status(404).json({ error: `vault agent ${slug} not found` });
    if (readAgents(p.path).find((a) => a.slug === slug))
      return res.status(400).json({ error: `agent ${slug} already exists in project` });
    try {
      writeAgentFile(p.path, slug, vault.fields || {}, vault.body || "");
      ensureAgentDir(p.path, slug);
      projects.rebuild(p.id);
      res.status(201).json(agentToResponse(readAgents(p.path).find((a) => a.slug === slug)));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/projects/:pid/agents", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(readAgents(p.path).map(agentToResponse));
  });

  app.get("/projects/:pid/agents/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const agents = readAgents(p.path);
    const a = agents.find((x) => x.slug === req.params.slug);
    if (!a) return res.status(404).json({ error: "agent not found" });
    const memPath = path.join(p.path, ".apc", "agents", a.slug, "memory.md");
    const memory = fs.existsSync(memPath)
      ? fs.readFileSync(memPath, "utf8")
      : "";
    res.json({ ...agentToResponse(a), memory, system: a.body || "" });
  });

  app.post("/projects/:pid/agents", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { slug, role, model, skills, language, description, tools, is_master, parent } =
      req.body || {};
    if (!slug) return res.status(400).json({ error: "slug required" });
    if (!/^[a-z][a-z0-9_-]*$/.test(slug))
      return res.status(400).json({ error: "invalid slug" });
    const existing = readAgents(p.path).find((a) => a.slug === slug);
    if (existing)
      return res.status(400).json({ error: `agent ${slug} already exists` });
    try {
      writeAgentFile(p.path, slug, {
        Role: role || null,
        Model: model || null,
        Language: language || null,
        Description: description || null,
        Skills: skills || [],
        Tools: tools || [],
        Master: is_master ? true : null,
        Parent: parent || null,
      });
      ensureAgentDir(p.path, slug);
      projects.rebuild(p.id);
      const created = readAgents(p.path).find((a) => a.slug === slug);
      res.status(201).json(agentToResponse(created));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Edit an existing agent. Merges provided fields into the AGENT.md
  // frontmatter; `system` rewrites the body (the agent's system prompt).
  app.patch("/projects/:pid/agents/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const slug = req.params.slug;
    const existing = readAgents(p.path).find((a) => a.slug === slug);
    if (!existing) return res.status(404).json({ error: "agent not found" });
    const b = req.body || {};
    const fields = { ...(existing.fields || {}) };
    const setStr = (key, val) => {
      if (val === undefined) return;
      if (val === null || val === "") delete fields[key];
      else fields[key] = val;
    };
    setStr("Role", b.role);
    setStr("Model", b.model);
    setStr("Language", b.language);
    setStr("Description", b.description);
    setStr("Parent", b.parent);
    setStr("Type", b.type);
    setStr("Area", b.area);
    if (b.skills !== undefined) fields.Skills = Array.isArray(b.skills) ? b.skills : [];
    if (b.tools !== undefined) fields.Tools = Array.isArray(b.tools) ? b.tools : [];
    if (b.is_master !== undefined) {
      if (b.is_master) fields.Master = true;
      else { delete fields.Master; delete fields.Primary; }
    }
    const body = b.system !== undefined ? b.system : (existing.body || "");
    try {
      writeAgentFile(p.path, slug, fields, body);
      ensureAgentDir(p.path, slug);
      projects.rebuild(p.id);
      const updated = readAgents(p.path).find((a) => a.slug === slug);
      res.json(agentToResponse(updated));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Delete an agent: removes .apc/agents/<slug>.md and its data dir.
  app.delete("/projects/:pid/agents/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const slug = req.params.slug;
    const file = path.join(p.path, ".apc", "agents", `${slug}.md`);
    const dir = path.join(p.path, ".apc", "agents", slug);
    if (!fs.existsSync(file) && !fs.existsSync(dir))
      return res.status(404).json({ error: "agent not found" });
    try {
      if (fs.existsSync(file)) fs.rmSync(file);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      projects.rebuild(p.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ---- Project-level memory (.apc/memory.md) ----
  app.get("/projects/:pid/memory", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const memPath = path.join(p.path, ".apc", "memory.md");
    const body = fs.existsSync(memPath) ? fs.readFileSync(memPath, "utf8") : "";
    res.json({ body, path: memPath });
  });

  app.put("/projects/:pid/memory", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { body } = req.body || {};
    if (typeof body !== "string")
      return res.status(400).json({ error: "body must be string" });
    const apcDir = path.join(p.path, ".apc");
    fs.mkdirSync(apcDir, { recursive: true });
    const memPath = path.join(apcDir, "memory.md");
    fs.writeFileSync(memPath, body);
    try { projects.rebuild(p.id); } catch {}
    res.json({ ok: true, bytes: Buffer.byteLength(body, "utf8") });
  });

  // ---- Per-agent memory ----
  app.get("/projects/:pid/agents/:slug/memory", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const memPath = path.join(
      p.path,
      ".apc",
      "agents",
      req.params.slug,
      "memory.md"
    );
    if (!fs.existsSync(memPath)) return res.json({ body: "" });
    res.json({ body: fs.readFileSync(memPath, "utf8") });
  });

  app.put("/projects/:pid/agents/:slug/memory", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { body } = req.body || {};
    if (typeof body !== "string")
      return res.status(400).json({ error: "body must be string" });
    const dir = path.join(p.path, ".apc", "agents", req.params.slug);
    fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
    const memPath = path.join(dir, "memory.md");
    fs.writeFileSync(memPath, body);
    projects.rebuild(p.id);
    res.json({ ok: true, bytes: Buffer.byteLength(body, "utf8") });
  });
}
