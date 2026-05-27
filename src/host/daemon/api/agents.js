// Agent CRUD + per-agent memory.
//   GET  /projects/:pid/agents
//   GET  /projects/:pid/agents/:slug                — also returns memory.md
//   POST /projects/:pid/agents                      — create from slug
//   GET  /projects/:pid/agents/:slug/memory
//   PUT  /projects/:pid/agents/:slug/memory
import fs from "node:fs";
import path from "node:path";
import { readAgents } from "../../../core/parser.js";
import {
  writeAgentFile,
  ensureAgentDir,
  regenerateAgentsMd,
} from "../../../core/scaffold.js";
import { agentToResponse } from "./shared.js";

export function register(app, { projects, project }) {
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
    res.json({ ...agentToResponse(a), memory });
  });

  app.post("/projects/:pid/agents", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { slug, role, model, skills, language, description, tools } =
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
      });
      ensureAgentDir(p.path, slug);
      regenerateAgentsMd(p.path);
      projects.rebuild(p.id);
      const created = readAgents(p.path).find((a) => a.slug === slug);
      res.status(201).json(agentToResponse(created));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
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
