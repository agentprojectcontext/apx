// Agent CRUD + per-agent memory.
//   GET  /projects/:pid/agents
//   GET  /projects/:pid/agents/:slug                — also returns memory.md
//   POST /projects/:pid/agents                      — create from slug
//   GET  /projects/:pid/agents/:slug/memory
//   PUT  /projects/:pid/agents/:slug/memory
import { readAgents, readVaultAgents, readVaultAgent } from "#core/apc/parser.js";
import {
  readProjectMemory,
  writeProjectMemory,
  projectMemoryPath,
} from "#core/apc/project-memory.js";
import {
  readProjectLocalMemory,
  writeProjectLocalMemory,
  projectLocalMemoryPath,
} from "#core/stores/project-memory.js";
import {
  writeAgentFile,
  writeVaultAgentFile,
  removeVaultAgent,
  restoreVaultAgent,
  ensureAgentDir,
} from "#core/apc/scaffold.js";
import {
  ensureAgentRuntimeDir,
  readAgentMemory,
  writeAgentMemory,
} from "#core/agent/memory.js";
import { createAgent, cloneAgent, setAgentConfig, removeAgent } from "#core/apc/agent-write.js";
import { agentToResponse } from "./shared.js";
import { normalizeVaultPatch } from "#core/apc/agents-vault.js";
import { listConversations } from "#core/stores/conversations.js";
import { listTasks } from "#core/stores/tasks.js";
import { listRoutines } from "#core/stores/routines.js";
import { readProjectMessages } from "#core/stores/messages.js";

// Attach a per-agent activity summary ({ threads, records, tasks, heartbeats })
// to a list of agent responses. Reads each store once and tallies by agent, so
// the whole list costs O(stores) rather than O(agents × stores). Gated behind
// `?stats=1` on the list endpoint since it touches the message ledger.
function attachAgentStats(p, agents) {
  const store = p.storagePath || p.path;
  const tally = (rows, key) => {
    const m = Object.create(null);
    for (const r of rows) {
      const a = typeof key === "function" ? key(r) : r?.[key];
      if (a) m[a] = (m[a] || 0) + 1;
    }
    return m;
  };
  let tasksByAgent = {}, hbByAgent = {}, recByAgent = {};
  try { tasksByAgent = tally(listTasks(store, { state: "all" }), "agent"); } catch { /* no task store */ }
  try { hbByAgent = tally(listRoutines(store), (r) => r?.spec?.agent); } catch { /* no routines */ }
  try { recByAgent = tally(readProjectMessages(store, { limit: 1000 }), "agent_slug"); } catch { /* no ledger */ }
  for (const a of agents) {
    let threads = 0;
    try { threads = listConversations(store, a.slug).length; } catch { /* none */ }
    a.stats = {
      threads,
      records: recByAgent[a.slug] || 0,
      tasks: tasksByAgent[a.slug] || 0,
      heartbeats: hbByAgent[a.slug] || 0,
    };
  }
}

export function register(api, { projects, project }) {
  // Vault = global agent templates. Two-layer: bundled defaults shipped with
  // APX (assets/agent-vault-defaults/) + user overrides/new ones in
  // ~/.apx/agents/. The user layer wins per slug; tombstones in .removed.json
  // hide bundled entries. GET merges both with `source` set per item.
  api.get("/agents/vault", (req, res) => {
    const includeRemoved = req.query?.include_removed === "1";
    res.json(readVaultAgents({ includeRemoved }).map((a) => ({
      ...agentToResponse(a),
      source: a.source, // "bundled" | "user" | "user-override"
    })));
  });

  // Create or replace a vault template (user layer / copy-on-write).
  api.post("/agents/vault", (req, res) => {
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
  api.patch("/agents/vault/:slug", (req, res) => {
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
  api.delete("/agents/vault/:slug", (req, res) => {
    const { slug } = req.params;
    const out = removeVaultAgent(slug);
    if (!out.removed) return res.status(404).json({ error: `vault agent ${slug} not found` });
    res.json({ ok: true, ...out });
  });

  api.post("/agents/vault/:slug/restore", (req, res) => {
    const { slug } = req.params;
    const out = restoreVaultAgent(slug);
    if (!out.restored) return res.status(404).json({ error: `slug ${slug} was not tombstoned` });
    const after = readVaultAgent(slug);
    res.json({ ok: true, agent: after ? agentToResponse(after) : null });
  });

  // Import a vault template into a project (copies it to .apc/agents/<slug>.md).
  api.post("/projects/:pid/agents/import", (req, res) => {
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
      ensureAgentRuntimeDir(p, slug);
      projects.rebuild(p.id);
      res.status(201).json(agentToResponse(readAgents(p.path).find((a) => a.slug === slug)));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.get("/projects/:pid/agents", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const agents = readAgents(p.path).map(agentToResponse);
    if (req.query.stats === "1") attachAgentStats(p, agents);
    res.json(agents);
  });

  api.get("/projects/:pid/agents/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const agents = readAgents(p.path);
    const a = agents.find((x) => x.slug === req.params.slug);
    if (!a) return res.status(404).json({ error: "agent not found" });
    const memory = readAgentMemory(p, a.slug);
    res.json({ ...agentToResponse(a), memory, system: a.body || "" });
  });

  api.post("/projects/:pid/agents", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    // Field normalization, avatar pick, slug/type validation and the file write
    // all live in core (agent-write.js), shared with the super-agent's
    // create_agent tool so the two surfaces can never drift. The route only
    // resolves the project, rebuilds the registry, and shapes the response.
    try {
      const slug = createAgent(p, req.body || {});
      projects.rebuild(p.id);
      const created = readAgents(p.path).find((a) => a.slug === slug);
      res.status(201).json(agentToResponse(created));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Duplicate an agent (frontmatter + prompt + memory) into a fresh "<slug>-n"
  // whose display Name gains a " (n)" suffix. Clone/naming live in core
  // (agent-write.js); the route resolves the project, rebuilds, and returns the
  // new agent so the UI can jump straight to it.
  api.post("/projects/:pid/agents/:slug/clone", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      const newSlug = cloneAgent(p, req.params.slug);
      projects.rebuild(p.id);
      const created = readAgents(p.path).find((a) => a.slug === newSlug);
      res.status(201).json(agentToResponse(created));
    } catch (e) {
      const status = /not found/.test(e.message) ? 404 : 400;
      res.status(status).json({ error: e.message });
    }
  });

  // Edit an existing agent. Merges provided fields into the AGENT.md
  // frontmatter; `system` rewrites the body (the agent's system prompt).
  api.patch("/projects/:pid/agents/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const slug = req.params.slug;
    if (!readAgents(p.path).some((a) => a.slug === slug))
      return res.status(404).json({ error: "agent not found" });
    // Field normalization + write live in core (agent-write.js), shared with the
    // super-agent's configure_agent / set_agent_prompt tools.
    try {
      setAgentConfig(p, slug, req.body || {});
      projects.rebuild(p.id);
      const updated = readAgents(p.path).find((a) => a.slug === slug);
      res.json(agentToResponse(updated));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Delete an agent: removes .apc/agents/<slug>.md and runtime data dir.
  api.delete("/projects/:pid/agents/:slug", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      removeAgent(p, req.params.slug);
      projects.rebuild(p.id);
      res.json({ ok: true });
    } catch (e) {
      const status = /not found/.test(e.message) ? 404 : 400;
      res.status(status).json({ error: e.message });
    }
  });

  // ---- Project-level memory ----
  // Two files, one boundary: `.apc/memory.md` is committed and only a person
  // writes it (core/apc/project-memory.js); `~/.apx/projects/<id>/memory.md` is
  // local, never committed, and is what the `remember` tool appends to
  // (core/stores/project-memory.js). Both are served here so the Memories screen
  // can show them side by side — a memory nothing displays is the bug this pair
  // of routes exists to prevent.
  api.get("/projects/:pid/memory", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json({ body: readProjectMemory(p.path), path: projectMemoryPath(p.path) });
  });

  api.put("/projects/:pid/memory", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { body } = req.body || {};
    if (typeof body !== "string")
      return res.status(400).json({ error: "body must be string" });
    const { bytes } = writeProjectMemory(p.path, body);
    try { projects.rebuild(p.id); } catch {}
    res.json({ ok: true, bytes });
  });

  // The local half — agent-written, never committed.
  api.get("/projects/:pid/memory/local", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json({ body: readProjectLocalMemory(p), path: projectLocalMemoryPath(p) });
  });

  api.put("/projects/:pid/memory/local", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { body } = req.body || {};
    if (typeof body !== "string")
      return res.status(400).json({ error: "body must be string" });
    const { bytes } = writeProjectLocalMemory(p, body);
    res.json({ ok: true, bytes });
  });

  // ---- Per-agent memory ----
  api.get("/projects/:pid/agents/:slug/memory", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    // Validate the agent exists — otherwise an unknown slug returned 200 with an
    // empty body, masking typos (QA BUG-API-1).
    if (!readAgents(p.path).some((a) => a.slug === req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    res.json({ body: readAgentMemory(p, req.params.slug) });
  });

  api.put("/projects/:pid/agents/:slug/memory", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    if (!readAgents(p.path).some((a) => a.slug === req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    const { body } = req.body || {};
    if (typeof body !== "string")
      return res.status(400).json({ error: "body must be string" });
    writeAgentMemory(p, req.params.slug, body);
    projects.rebuild(p.id);
    res.json({ ok: true, bytes: Buffer.byteLength(body, "utf8") });
  });
}
