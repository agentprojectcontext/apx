// Express REST API for APX. See APC docs reference/apx-daemon.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import express from "express";
import { buildBrowserRouter } from "./tools/browser.js";
import { buildSearchRouter } from "./tools/search.js";
import { buildRegistryRouter } from "./tools/registry.js";
import { buildGlobRouter } from "./tools/glob.js";
import { buildGrepRouter } from "./tools/grep.js";
import { readApfMcps, writeApfMcps, SOURCES } from "./mcp-sources.js";
import { callEngine, ENGINE_IDS } from "./engines/index.js";
import { getRuntime, RUNTIME_IDS } from "./runtimes/index.js";
import { detectAll } from "./env-detect.js";
import {
  startConversation,
  appendTurn,
  readConversation,
  listConversations,
  conversationPath,
  setStatus,
} from "./conversations.js";
import { compactConversation } from "./compact.js";
import {
  readProjectConfig,
  writeProjectConfig,
  setDottedKey,
  unsetDottedKey,
} from "./project-config.js";
import {
  listRoutines,
  getRoutine,
  upsertRoutine,
  deleteRoutine,
  setEnabled as setRoutineEnabled,
  runRoutineNow,
} from "./routines.js";
import {
  buildApfHint,
  createRuntimeSession,
  closeRuntimeSession,
  extractApfResult,
} from "./apc-runtime-context.js";
import { readSessionFrontmatter } from "../core/session-store.js";
import { runSuperAgent, isSuperAgentEnabled } from "./super-agent.js";
import { readGlobalMessages, readProjectMessages, searchProjectMessages } from "../core/messages-store.js";
import { readAgents } from "../core/parser.js";
import { parseSessionFrontmatter } from "../core/parser.js";
import { writeAgentFile, ensureAgentDir, regenerateAgentsMd } from "../core/scaffold.js";
import { buildAgentSystem } from "../core/agent-system.js";
import {
  createArtifact,
  listArtifacts,
  readArtifact,
  removeArtifact,
} from "../core/artifacts-store.js";

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export function buildApi({ projects, registries, plugins, scheduler, version, startedAt, addProjectGlobally, config }) {
  const telegram = plugins?.get("telegram");

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // ---- Tool routers (browser / search / glob / grep / registry) ----
  app.use("/tools/browser", buildBrowserRouter(express));
  app.use("/tools/search",  buildSearchRouter(express));
  app.use("/tools/glob",    buildGlobRouter(express));
  app.use("/tools/grep",    buildGrepRouter(express));
  // Registry MUST be mounted after specific routers so /:name wildcard
  // doesn't shadow /tools/browser, /tools/search, etc.
  app.use("/tools", buildRegistryRouter(express, { projects, registries }));

  // ---- Health -------------------------------------------------------
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  // ---- Projects -----------------------------------------------------
  app.get("/projects", (_req, res) => res.json(projects.list()));

  app.post("/projects", (req, res) => {
    const { path: p } = req.body || {};
    if (!p) return res.status(400).json({ error: "path required" });
    try {
      const entry = projects.register(p);
      addProjectGlobally(entry.path);
      registries.ensure(entry);
      res.status(201).json({ id: entry.id, path: entry.path });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/projects/:id", (req, res) => {
    const ok = projects.unregister(req.params.id);
    res.status(ok ? 204 : 404).end();
  });

  app.post("/projects/:id/rebuild", (req, res) => {
    try {
      const result = projects.rebuild(req.params.id);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ---- Helper -------------------------------------------------------
  function project(req, res) {
    const p = projects.get(req.params.pid);
    if (!p) {
      res.status(404).json({ error: "project not found" });
      return null;
    }
    return p;
  }

  // ---- Agents -------------------------------------------------------
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
    const memory = fs.existsSync(memPath) ? fs.readFileSync(memPath, "utf8") : "";
    res.json({ ...agentToResponse(a), memory });
  });

  app.post("/projects/:pid/agents", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { slug, role, model, skills, language, description, tools } = req.body || {};
    if (!slug) return res.status(400).json({ error: "slug required" });
    if (!/^[a-z][a-z0-9_-]*$/.test(slug))
      return res.status(400).json({ error: "invalid slug" });
    const existing = readAgents(p.path).find((a) => a.slug === slug);
    if (existing) return res.status(400).json({ error: `agent ${slug} already exists` });
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

  // ---- Memory -------------------------------------------------------
  app.get("/projects/:pid/agents/:slug/memory", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const memPath = path.join(p.path, ".apc", "agents", req.params.slug, "memory.md");
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

  // ---- Sessions -----------------------------------------------------
  app.get("/projects/:pid/agents/:slug/sessions", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const agents = readAgents(p.path);
    if (!agents.find((a) => a.slug === req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    const sessionsDir = path.join(p.storagePath, "agents", req.params.slug, "sessions");
    if (!fs.existsSync(sessionsDir)) return res.json([]);
    const sessions = fs
      .readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .map((f) => {
        const text = fs.readFileSync(path.join(sessionsDir, f), "utf8");
        const fm = parseSessionFrontmatter(text);
        const titleFromFile = f.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, "");
        return {
          filename: f,
          title: fm.title || titleFromFile,
          started_at: fm.started || null,
          ended_at: fm.ended || null,
        };
      });
    res.json(sessions);
  });

  app.post("/projects/:pid/agents/:slug/sessions", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { title, body = "" } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    const sessionsDir = path.join(p.storagePath, "agents", req.params.slug, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const titleSlug =
      title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "session";
    const today = new Date().toISOString().slice(0, 10);
    let candidate = path.join(sessionsDir, `${today}-${titleSlug}.md`);
    let n = 2;
    while (fs.existsSync(candidate)) {
      candidate = path.join(sessionsDir, `${today}-${titleSlug}-${n}.md`);
      n++;
    }
    const started = nowIso();
    const content = `---\ntitle: ${title}\nstarted: ${started}\n---\n\n# ${title}\n\n${body}\n`;
    fs.writeFileSync(candidate, content);
    projects.rebuild(p.id);
    res.status(201).json({ filename: path.basename(candidate), path: candidate });
  });

  // GET session by filename (sid may include or omit the .md extension)
  app.get("/projects/:pid/sessions/:sid", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const sid = req.params.sid;
    const filename = sid.endsWith(".md") ? sid : `${sid}.md`;
    const agentsDir = path.join(p.storagePath, "agents");
    let found = null;
    if (fs.existsSync(agentsDir)) {
      for (const slug of fs.readdirSync(agentsDir)) {
        const f = path.join(agentsDir, slug, "sessions", filename);
        if (fs.existsSync(f)) {
          const text = fs.readFileSync(f, "utf8");
          const fm = parseSessionFrontmatter(text);
          found = { filename, agent: slug, ...fm, body_md: text };
          break;
        }
      }
    }
    if (!found) return res.status(404).json({ error: "session not found" });
    res.json(found);
  });

  // ---- MCPs ---------------------------------------------------------
  app.get("/projects/:pid/mcps", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(registries.for(p).list());
  });

  app.post("/projects/:pid/mcps", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { name, command, args, env, url, headers, enabled } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    if (!command && !url)
      return res.status(400).json({ error: "either command or url required" });

    const json = readApfMcps(p.path);
    json.mcpServers = json.mcpServers || {};
    const existing = json.mcpServers[name] || {};
    json.mcpServers[name] = {
      ...existing,
      ...(command !== undefined ? { command } : {}),
      ...(args !== undefined ? { args } : {}),
      ...(env !== undefined ? { env } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(headers !== undefined ? { headers } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    };
    writeApfMcps(p.path, json);
    registries.for(p).evict(name);
    projects.rebuild(p.id);
    const entry = registries.for(p).getByName(name);
    res.status(201).json(entry);
  });

  app.delete("/projects/:pid/mcps/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const json = readApfMcps(p.path);
    if (!json.mcpServers || !(req.params.name in (json.mcpServers || {}))) {
      const all = registries.for(p).list();
      const m = all.find((x) => x.name === req.params.name);
      if (m && m.source !== "apc") {
        return res.status(409).json({
          error: `MCP "${req.params.name}" comes from "${m.source}" config — not APC-owned, cannot be removed by apx. Edit ${SOURCES.find((s) => s.id === m.source)?.file} directly.`,
        });
      }
      return res.status(404).end();
    }
    delete json.mcpServers[req.params.name];
    writeApfMcps(p.path, json);
    registries.for(p).evict(req.params.name);
    projects.rebuild(p.id);
    res.status(204).end();
  });

  app.get("/projects/:pid/mcps/check", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const reg = registries.for(p);
    res.json({
      sources: SOURCES.map((s) => ({
        id: s.id,
        file: s.file,
        present: fs.existsSync(path.join(p.path, s.file)),
      })),
      entries: reg.list().map((m) => ({
        name: m.name,
        source: m.source,
        transport: m.transport,
        enabled: m.enabled,
      })),
      conflicts: reg.conflicts(),
    });
  });

  app.post("/projects/:pid/mcps/:name/call", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { tool, params } = req.body || {};
    if (!tool) return res.status(400).json({ error: "tool required" });
    try {
      const result = await registries.for(p).call(req.params.name, tool, params);
      res.json({ result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Messages -----------------------------------------------------
  app.get("/projects/:pid/messages", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { agent, channel, since, limit = "100" } = req.query;
    const rows = readProjectMessages(p.storagePath, {
      channel: channel || undefined,
      agent_slug: agent || undefined,
      since: since || undefined,
      limit: Math.min(parseInt(limit, 10) || 100, 1000),
    });
    res.json(rows);
  });

  app.post("/projects/:pid/messages", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { channel, direction, type, actor_id, agent_slug, body, meta = {}, author = null } =
      req.body || {};
    if (!channel || !direction || !body)
      return res.status(400).json({ error: "channel, direction, body required" });
    if (!["in", "out"].includes(direction))
      return res.status(400).json({ error: "direction must be in|out" });
    const r = p.logMessage({ agent_slug: agent_slug || null, channel, direction, type, actor_id, author, body, meta });
    res.status(201).json({ ok: true, ts: r.ts });
  });

  app.get("/projects/:pid/messages/search", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { q, limit = "50" } = req.query;
    if (!q) return res.status(400).json({ error: "q required" });
    res.json(searchProjectMessages(p.storagePath, q, Math.min(parseInt(limit, 10) || 50, 500)));
  });

  // ---- Global messages (cross-project channels: telegram, direct, …) ----
  app.get("/messages/global", (req, res) => {
    const { channel, limit = "100", since } = req.query;
    const lim = Math.min(parseInt(limit, 10) || 100, 1000);
    const rows = readGlobalMessages({ channel: channel || undefined, limit: lim, since });
    res.json(rows);
  });

  // ---- Telegram -----------------------------------------------------
  app.get("/telegram/status", (_req, res) => {
    if (!telegram) return res.json({ enabled: false, channels: [] });
    res.json(telegram.status());
  });

  app.post("/telegram/send", async (req, res) => {
    const { chat_id, text, channel } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    if (!telegram) return res.status(503).json({ error: "telegram plugin not loaded" });
    try {
      const r = await telegram.send({ chat_id, text, channel });
      res.status(202).json({ ok: true, message_id: r.message_id });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // POST /telegram/send_photo  { chat_id?, photo (path|url), caption?, channel? }
  app.post("/telegram/send_photo", async (req, res) => {
    const { chat_id, photo, caption, parse_mode, channel } = req.body || {};
    if (!photo) return res.status(400).json({ error: "photo required (path or url)" });
    if (!telegram) return res.status(503).json({ error: "telegram plugin not loaded" });
    try {
      const r = await telegram.sendPhoto({ chat_id, photo, caption, parse_mode, channel });
      res.status(202).json({ ok: true, message_id: r?.message_id });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // POST /telegram/send_voice  { chat_id?, audio (path), caption?, duration?, channel? }
  app.post("/telegram/send_voice", async (req, res) => {
    const { chat_id, audio, caption, duration, channel } = req.body || {};
    if (!audio) return res.status(400).json({ error: "audio required (path)" });
    if (!telegram) return res.status(503).json({ error: "telegram plugin not loaded" });
    try {
      const r = await telegram.sendVoice({ chat_id, audio, caption, duration, channel });
      res.status(202).json({ ok: true, message_id: r?.message_id });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // POST /telegram/send_audio  { chat_id?, audio (path), caption?, title?, performer?, channel? }
  app.post("/telegram/send_audio", async (req, res) => {
    const { chat_id, audio, caption, title, performer, channel } = req.body || {};
    if (!audio) return res.status(400).json({ error: "audio required (path)" });
    if (!telegram) return res.status(503).json({ error: "telegram plugin not loaded" });
    try {
      const r = await telegram.sendAudio({ chat_id, audio, caption, title, performer, channel });
      res.status(202).json({ ok: true, message_id: r?.message_id });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // POST /telegram/notify  — alias for /telegram/send for proactive daemon notifications
  // Any internal daemon code (routines, error handlers, MCP failure hooks) can POST here
  // to push a message to the user without waiting for a user-initiated request.
  app.post("/telegram/notify", async (req, res) => {
    const { chat_id, text, channel } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    if (!telegram) return res.status(503).json({ error: "telegram plugin not loaded" });
    try {
      const r = await telegram.send({ chat_id, text, channel });
      res.status(202).json({ ok: true, message_id: r.message_id, via: "notify" });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // ---- Plugins -----------------------------------------------------
  app.get("/plugins", (_req, res) => {
    if (!plugins) return res.json({});
    res.json(plugins.status());
  });

  app.get("/plugins/:id/status", (req, res) => {
    if (!plugins) return res.status(404).end();
    const inst = plugins.get(req.params.id);
    if (!inst) return res.status(404).json({ error: `plugin ${req.params.id} not loaded` });
    res.json(inst.status?.() || {});
  });

  // ---- Engines & Conversations -------------------------------------
  app.get("/engines", (_req, res) => res.json({ engines: ENGINE_IDS }));

  // POST /projects/:pid/agents/:slug/exec
  app.post("/projects/:pid/agents/:slug/exec", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { prompt, model: modelOverride, temperature, maxTokens } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const agents = readAgents(p.path);
    const agent = agents.find((a) => a.slug === req.params.slug);
    if (!agent) return res.status(404).json({ error: "agent not found" });
    const modelId = modelOverride || agent.fields.Model;
    if (!modelId) return res.status(400).json({ error: "agent has no model and none provided" });

    try {
      const system = buildAgentSystem(p, agent, { invocation: "engine" });
      const conv = startConversation({ storagePath: p.storagePath, agentSlug: agent.slug, engine: modelId, system });
      appendTurn({ filePath: conv.path, role: "user", content: prompt });

      const result = await callEngine({
        modelId,
        system,
        messages: [{ role: "user", content: prompt }],
        config: p.config || config,
        temperature,
        maxTokens,
      });

      appendTurn({ filePath: conv.path, role: "assistant", content: result.text });
      setStatus(conv.path, "closed");

      p.logMessage({ agent_slug: agent.slug, channel: "engine", direction: "in", author: "user", body: prompt, meta: { conversation: conv.id } });
      p.logMessage({ agent_slug: agent.slug, channel: "engine", direction: "out", author: agent.slug, body: result.text, meta: { conversation: conv.id, usage: result.usage } });

      projects.rebuild(p.id);
      res.json({
        conversation: { id: conv.id, filename: conv.filename, path: conv.path },
        text: result.text,
        usage: result.usage,
        engine: modelId,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /projects/:pid/agents/:slug/chat
  app.post("/projects/:pid/agents/:slug/chat", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { prompt, conversation_id, model: modelOverride, temperature, maxTokens } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const agents = readAgents(p.path);
    const agent = agents.find((a) => a.slug === req.params.slug);
    if (!agent) return res.status(404).json({ error: "agent not found" });
    const modelId = modelOverride || agent.fields.Model;
    if (!modelId) return res.status(400).json({ error: "agent has no model and none provided" });

    try {
      let convPath;
      let convId;
      let history = [];
      let compactSummary = null;

      if (conversation_id) {
        const existing = readConversation(p.storagePath, agent.slug, conversation_id);
        if (!existing) return res.status(404).json({ error: `conversation ${conversation_id} not found` });
        convPath = existing.path;
        convId = conversation_id;
        // Extract compact summary if present — inject into system instead of messages.
        const compactTurn = existing.turns.find((t) => t.role === "compact");
        if (compactTurn) {
          // Strip the "[Compacted N turns on ...]" header line from the summary body
          compactSummary = compactTurn.content.replace(/^\[Compacted \d+ turns.*?\]\n\n?/, "").trim();
        }
        history = existing.turns
          .filter((t) => t.role === "user" || t.role === "assistant")
          .map((t) => ({ role: t.role, content: t.content }));
      }

      // Build system prompt — inject compact summary if this conversation was compacted.
      const extraParts = compactSummary
        ? [`## Previous Conversation Context (Compacted)\n${compactSummary}`]
        : [];
      const system = buildAgentSystem(p, agent, { invocation: "engine", extraParts });

      if (!conversation_id) {
        const conv = startConversation({ storagePath: p.storagePath, agentSlug: agent.slug, engine: modelId, system });
        convPath = conv.path;
        convId = conv.id;
      }

      appendTurn({ filePath: convPath, role: "user", content: prompt });
      history.push({ role: "user", content: prompt });

      const result = await callEngine({ modelId, system, messages: history, config: p.config || config, temperature, maxTokens });
      appendTurn({ filePath: convPath, role: "assistant", content: result.text });
      projects.rebuild(p.id);

      res.json({
        conversation_id: convId,
        text: result.text,
        usage: result.usage,
        engine: modelId,
        compacted: !!compactSummary,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /projects/:pid/super-agent/chat
  app.post("/projects/:pid/super-agent/chat/stream", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { prompt, contextNote, previousMessages, model } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();

    const send = (event) => {
      res.write(JSON.stringify(event) + "\n");
    };

    try {
      const saResult = await runSuperAgent({
        globalConfig: config,
        projects,
        plugins,
        registries,
        prompt,
        contextNote: contextNote || `Context: Project ${p.id} (${p.name}) at ${p.path}`,
        previousMessages: previousMessages || [],
        overrideModel: model,
        onEvent: send,
      });
      projects.rebuild(p.id);
      send({
        type: "final",
        result: {
          text: saResult.text,
          usage: saResult.usage,
          name: saResult.name,
          trace: saResult.trace,
        },
      });
      res.end();
    } catch (e) {
      send({ type: "error", error: e.message });
      res.end();
    }
  });

  app.post("/projects/:pid/super-agent/chat", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { prompt, contextNote, previousMessages, model } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    try {
      const saResult = await runSuperAgent({
        globalConfig: config,
        projects,
        plugins,
        registries,
        prompt,
        contextNote: contextNote || `Context: Project ${p.id} (${p.name}) at ${p.path}`,
        previousMessages: previousMessages || [],
        overrideModel: model,
      });
      projects.rebuild(p.id);
      res.json({
        text: saResult.text,
        usage: saResult.usage,
        name: saResult.name,
        trace: saResult.trace,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /projects/:pid/agents/:slug/conversations
  app.get("/projects/:pid/agents/:slug/conversations", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const agents = readAgents(p.path);
    if (!agents.find((a) => a.slug === req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    res.json(listConversations(p.storagePath, req.params.slug));
  });

  // GET /projects/:pid/agents/:slug/conversations/:id
  app.get("/projects/:pid/agents/:slug/conversations/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const conv = readConversation(p.storagePath, req.params.slug, req.params.id);
    if (!conv) return res.status(404).json({ error: "conversation not found" });
    res.json(conv);
  });

  // POST /projects/:pid/agents/:slug/compact          ← compacts the latest conversation
  // POST /projects/:pid/agents/:slug/conversations/:id/compact  ← compacts a specific one
  async function handleCompact(req, res, filename) {
    const p = project(req, res);
    if (!p) return;
    const agents = readAgents(p.path);
    const agent = agents.find((a) => a.slug === req.params.slug);
    if (!agent) return res.status(404).json({ error: "agent not found" });
    const modelId = (req.body || {}).model || agent.fields.Model;
    if (!modelId) return res.status(400).json({ error: "agent has no model" });
    try {
      const result = await compactConversation({
        storagePath: p.storagePath,
        agentSlug: agent.slug,
        filename: filename || null,
        modelId,
        config: p.config || config,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  app.post("/projects/:pid/agents/:slug/compact", (req, res) =>
    handleCompact(req, res, null)
  );

  app.post("/projects/:pid/agents/:slug/conversations/:id/compact", (req, res) =>
    handleCompact(req, res, req.params.id)
  );

  // ---- Agent-to-agent routing --------------------------------------
  app.post("/projects/:pid/send", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { from, to, body, deliver = false, _depth = 0 } = req.body || {};
    if (!from || !to || !body)
      return res.status(400).json({ error: "from, to, body required" });
    if (_depth > 3)
      return res.status(429).json({ error: "a2a depth limit (3) exceeded" });

    const agents = readAgents(p.path);
    const fromAgent = agents.find((a) => a.slug === from);
    const toAgent = agents.find((a) => a.slug === to);
    if (!fromAgent) return res.status(404).json({ error: `from agent "${from}" not found` });
    if (!toAgent) return res.status(404).json({ error: `to agent "${to}" not found` });

    const ts = nowIso();
    p.logMessage({ agent_slug: from, channel: "a2a", direction: "out", author: from, body, meta: { to, depth: _depth }, ts });
    p.logMessage({ agent_slug: to, channel: "a2a", direction: "in", author: from, body, meta: { from, depth: _depth }, ts });

    let reply = null;
    if (deliver && toAgent.fields.Model) {
      try {
        const tf = toAgent.fields;
        const parts = [];
        if (tf.Description) parts.push(tf.Description);
        if (tf.Role) parts.push(`Role: ${tf.Role}`);
        if (tf.Language) parts.push(`Default language: ${tf.Language}`);
        parts.push(`You are ${toAgent.slug}. You just received a message from ${fromAgent.slug}. Reply concisely.`);
        const memPath = path.join(p.path, ".apc", "agents", toAgent.slug, "memory.md");
        if (fs.existsSync(memPath)) parts.push("## Memory\n" + fs.readFileSync(memPath, "utf8"));

        const result = await callEngine({
          modelId: toAgent.fields.Model,
          system: parts.join("\n\n"),
          messages: [{ role: "user", content: `From ${fromAgent.slug}:\n\n${body}` }],
          config: p.config || config,
        });

        p.logMessage({ agent_slug: to, channel: "a2a", direction: "out", author: to, body: result.text, meta: { to: from, depth: _depth + 1, reply_to: fromAgent.slug, usage: result.usage } });
        p.logMessage({ agent_slug: from, channel: "a2a", direction: "in", author: to, body: result.text, meta: { from: to, depth: _depth + 1 } });
        reply = { text: result.text, usage: result.usage };
      } catch (e) {
        reply = { error: e.message };
      }
    }

    res.json({ from, to, body, ts, reply });
  });

  // GET /projects/:pid/agents/:slug/connections
  app.get("/projects/:pid/agents/:slug/connections", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const agents = readAgents(p.path);
    if (!agents.find((a) => a.slug === req.params.slug))
      return res.status(404).json({ error: "agent not found" });

    const messages = readProjectMessages(p.storagePath, { agent_slug: req.params.slug });
    const peers = new Map();
    for (const m of messages) {
      const peer = m.meta?.from || m.meta?.to || null;
      if (!peer) continue;
      const key = `${peer}|${m.channel}|${m.direction}`;
      const existing = peers.get(key);
      if (!existing) {
        peers.set(key, { peer, channel: m.channel, direction: m.direction, n: 1, last_ts: m.ts });
      } else {
        existing.n++;
        if (m.ts > existing.last_ts) existing.last_ts = m.ts;
      }
    }
    res.json(
      Array.from(peers.values()).sort((a, b) => (b.last_ts || "").localeCompare(a.last_ts || ""))
    );
  });

  // ---- Runtimes (external CLI agents) -------------------------------
  app.get("/runtimes", (_req, res) => res.json({ runtimes: RUNTIME_IDS }));

  app.get("/env/detect", async (_req, res) => {
    const detected = await detectAll();
    res.json(detected);
  });

  // POST /projects/:pid/agents/:slug/runtime
  app.post("/projects/:pid/agents/:slug/runtime", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { runtime, prompt, timeoutMs } = req.body || {};
    if (!runtime || !prompt)
      return res.status(400).json({ error: "runtime and prompt required" });

    const agents = readAgents(p.path);
    const agent = agents.find((a) => a.slug === req.params.slug);
    if (!agent) return res.status(404).json({ error: "agent not found" });

    let rt;
    try {
      rt = getRuntime(runtime);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    let projectName = path.basename(p.path);
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(p.path, ".apc", "project.json"), "utf8"));
      if (meta.name) projectName = meta.name;
    } catch {}

    const session = createRuntimeSession({
      projectRoot: p.path,
      storageRoot: p.storagePath,
      agentSlug: agent.slug,
      runtime,
      title: req.body?.title,
      taskRef: req.body?.task_ref || "",
    });

    const system = buildAgentSystem(p, agent, {
      invocation: "runtime",
      runtime,
      extraParts: [
        buildApfHint({
          projectName,
          projectPath: p.path,
          agentSlug: agent.slug,
          sessionId: session.id,
        }),
      ],
    });

    try {
      const r = await rt.run({
        system,
        prompt,
        cwd: p.path,
        timeoutMs: timeoutMs || 5 * 60 * 1000,
      });

      const apfResult = extractApfResult(r.output) || (r.output || "").slice(0, 200);
      closeRuntimeSession({ filePath: session.path, externalSessionPath: r.externalSessionPath || null, exitCode: r.exitCode, result: apfResult });

      p.logMessage({ agent_slug: agent.slug, channel: "runtime", direction: "in", author: "user", body: prompt, meta: { runtime, apc_session: session.id } });
      p.logMessage({ agent_slug: agent.slug, channel: "runtime", direction: "out", author: agent.slug, body: r.output || "", meta: { runtime, exit_code: r.exitCode, external_session_path: r.externalSessionPath || null, session_id: r.sessionId || null, apc_session: session.id } });
      projects.rebuild(p.id);

      res.json({
        runtime,
        exit_code: r.exitCode,
        output: r.output,
        stderr: r.stderr,
        external_session_path: r.externalSessionPath || null,
        session_id: r.sessionId || null,
        apc_session: session.id,
      });
    } catch (e) {
      try {
        closeRuntimeSession({ filePath: session.path, exitCode: -1, result: `error: ${e.message.slice(0, 200)}` });
      } catch {}
      res.status(500).json({ error: e.message, apc_session: session.id });
    }
  });

  // ---- Session resume -----------------------------------------------
  app.get("/projects/:pid/sessions/:id/resume", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { id } = req.params;

    const sessionRoots = [
      path.join(p.storagePath || p.path, "agents"),
      path.join(p.path, ".apc", "agents"),
    ];
    let sessionFile = null;
    let agentSlug = null;
    for (const agentsDir of sessionRoots) {
      if (!fs.existsSync(agentsDir)) continue;
      for (const slug of fs.readdirSync(agentsDir)) {
        const f = path.join(agentsDir, slug, "sessions", `${id}.md`);
        if (fs.existsSync(f)) {
          sessionFile = f;
          agentSlug = slug;
          break;
        }
      }
      if (sessionFile) break;
    }
    if (!sessionFile) return res.status(404).json({ error: `session ${id} not found` });

    const session = readSessionFrontmatter(sessionFile);
    const out = {
      id,
      agent: agentSlug,
      session_path: sessionFile,
      frontmatter: session?.fm || {},
      external_transcript: null,
      summary: null,
    };

    const externalPath = session?.fm?.external_session_path;
    if (externalPath && fs.existsSync(externalPath)) {
      const stat = fs.statSync(externalPath);
      const raw = fs.readFileSync(externalPath, "utf8");
      out.external_transcript = {
        path: externalPath,
        size: stat.size,
        tail: raw.length > 32 * 1024 ? raw.slice(-32 * 1024) : raw,
      };
    }

    if (req.query.summarize === "true" && isSuperAgentEnabled(config)) {
      try {
        const prompt =
          `Summarize what happened in this APC session in 4 concrete bullets.\n\n` +
          `Frontmatter:\n${JSON.stringify(out.frontmatter, null, 2)}\n\n` +
          (out.external_transcript
            ? `External transcript (last ${out.external_transcript.tail.length} chars):\n${out.external_transcript.tail}`
            : `(no external transcript)`);
        const sa = await runSuperAgent({ globalConfig: config, projects, plugins, registries, prompt, contextNote: `Resume request for session ${id}.` });
        out.summary = sa.text;
      } catch (e) {
        out.summary = `(super-agent failed: ${e.message})`;
      }
    }

    res.json(out);
  });

  // ---- Routines (per-project scheduled tasks) ----------------------
  app.get("/projects/:pid/routines", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(listRoutines(p.storagePath));
  });

  app.get("/projects/:pid/routines/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const r = getRoutine(p.storagePath, req.params.name);
    if (!r) return res.status(404).json({ error: "routine not found" });
    res.json(r);
  });

  app.post("/projects/:pid/routines", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      // Pass all fields including pipeline extensions.
      const r = upsertRoutine(p.storagePath, req.body || {});
      res.status(201).json(r);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ---- Artifacts (managed files in storagePath/artifacts/) ---------
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
    const ok = removeArtifact(p.storagePath, decodeURIComponent(req.params.name));
    res.status(ok ? 204 : 404).end();
  });

  app.delete("/projects/:pid/routines/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const ok = deleteRoutine(p.storagePath, req.params.name);
    res.status(ok ? 204 : 404).end();
  });

  app.post("/projects/:pid/routines/:name/enable", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    setRoutineEnabled(p.storagePath, req.params.name, true);
    res.json({ ok: true });
  });

  app.post("/projects/:pid/routines/:name/disable", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    setRoutineEnabled(p.storagePath, req.params.name, false);
    res.json({ ok: true });
  });

  app.post("/projects/:pid/routines/:name/run", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const r = getRoutine(p.storagePath, req.params.name);
    if (!r) return res.status(404).json({ error: "routine not found" });
    try {
      const result = await runRoutineNow({ project: p, projects, plugins, registries, globalConfig: config }, r);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Per-project config (.apc/config.json) -----------------------
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

  // ---- Run (bash execution) -----------------------------------------
  // POST /run  { cmd, cwd?, project?, timeout_ms? }
  // Executes a shell command and returns stdout + stderr.
  // `cwd` defaults to the project path (by id or first registered), or process.cwd().
  app.post("/run", (req, res) => {
    const { cmd, cwd: cwdOverride, project: projectRef, timeout_ms = 30000 } = req.body || {};
    if (!cmd) return res.status(400).json({ error: "cmd required" });

    // Resolve working directory
    let cwd = cwdOverride || null;
    if (!cwd) {
      let entry = null;
      if (projectRef !== undefined && projectRef !== null) {
        const all = projects.list();
        const ref = String(projectRef);
        entry = all.find((p) => String(p.id) === ref || p.path === path.resolve(ref));
      }
      if (!entry) {
        const all = projects.list().filter((p) => p.id !== 0);
        entry = all[0] || projects.get(0);
      }
      cwd = entry ? entry.path : process.cwd();
    }

    const timeout = Math.min(Math.max(parseInt(timeout_ms, 10) || 30000, 1000), 300000);

    execFile("bash", ["-c", cmd], { cwd, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const exit_code = err?.code ?? (err ? 1 : 0);
      res.json({
        ok: !err || exit_code === 0,
        exit_code,
        stdout: stdout || "",
        stderr: stderr || "",
        cwd,
      });
    });
  });

  // ---- Top-level memory shortcuts -----------------------------------
  // GET  /memory?project=<id>          → reads default agent memory.md
  // POST /memory?project=<id>  { body } → writes it
  //
  // Targets the *first non-default agent* of the resolved project,
  // or falls back to a bare memory.md in .apc/ root.

  function resolveTopProject(query) {
    const ref = query?.project;
    if (ref !== undefined && ref !== null) {
      const all = projects.list();
      const r = String(ref);
      return projects.get(all.find((p) => String(p.id) === r || p.path === path.resolve(r))?.id);
    }
    const all = projects.list().filter((p) => p.id !== 0);
    return all.length ? projects.get(all[0].id) : projects.get(0);
  }

  function resolveMemoryPath(p) {
    const agentsDir = path.join(p.path, ".apc", "agents");
    if (fs.existsSync(agentsDir)) {
      const slugs = fs.readdirSync(agentsDir).filter((s) => {
        const mp = path.join(agentsDir, s, "memory.md");
        return fs.statSync(path.join(agentsDir, s)).isDirectory();
      });
      if (slugs.length) return path.join(agentsDir, slugs[0], "memory.md");
    }
    return path.join(p.path, ".apc", "memory.md");
  }

  app.get("/memory", (req, res) => {
    const p = resolveTopProject(req.query);
    if (!p) return res.status(404).json({ error: "no project registered" });
    const memPath = resolveMemoryPath(p);
    const body = fs.existsSync(memPath) ? fs.readFileSync(memPath, "utf8") : "";
    res.json({ project_id: p.id, path: memPath, body });
  });

  app.post("/memory", (req, res) => {
    const p = resolveTopProject(req.query);
    if (!p) return res.status(404).json({ error: "no project registered" });
    const { body } = req.body || {};
    if (typeof body !== "string") return res.status(400).json({ error: "body must be string" });
    const memPath = resolveMemoryPath(p);
    fs.mkdirSync(path.dirname(memPath), { recursive: true });
    fs.writeFileSync(memPath, body);
    try { projects.rebuild(p.id); } catch {}
    res.json({ ok: true, path: memPath, bytes: Buffer.byteLength(body, "utf8") });
  });

  // ---- Top-level file shortcuts -------------------------------------
  // GET  /files?path=<rel>&project=<id>          → read file contents
  // POST /files?project=<id>  { path, content }  → write file

  app.get("/files", (req, res) => {
    const p = resolveTopProject(req.query);
    if (!p) return res.status(404).json({ error: "no project registered" });
    const rel = req.query.path;
    if (!rel) {
      // List top-level files of the project
      try {
        const entries = fs.readdirSync(p.path).map((name) => {
          const full = path.join(p.path, name);
          const stat = fs.statSync(full);
          return { name, type: stat.isDirectory() ? "dir" : "file", size: stat.isDirectory() ? null : stat.size };
        });
        return res.json({ project_id: p.id, cwd: p.path, entries });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }
    const abs = path.resolve(p.path, rel);
    if (!abs.startsWith(path.resolve(p.path))) return res.status(403).json({ error: "path escapes project root" });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "not found" });
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(abs).map((name) => {
        const s = fs.statSync(path.join(abs, name));
        return { name, type: s.isDirectory() ? "dir" : "file", size: s.isDirectory() ? null : s.size };
      });
      return res.json({ project_id: p.id, path: rel, type: "dir", entries });
    }
    const content = fs.readFileSync(abs, "utf8");
    res.json({ project_id: p.id, path: rel, type: "file", size: stat.size, content });
  });

  app.post("/files", (req, res) => {
    const p = resolveTopProject(req.query);
    if (!p) return res.status(404).json({ error: "no project registered" });
    const { path: rel, content } = req.body || {};
    if (!rel) return res.status(400).json({ error: "path required" });
    if (typeof content !== "string") return res.status(400).json({ error: "content must be string" });
    const abs = path.resolve(p.path, rel);
    if (!abs.startsWith(path.resolve(p.path))) return res.status(403).json({ error: "path escapes project root" });
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    res.json({ ok: true, path: rel, bytes: Buffer.byteLength(content, "utf8") });
  });

  // ---- Top-level MCP shortcuts --------------------------------------
  // GET  /mcp?project=<id>                        → list MCPs
  // POST /mcp/run  { project?, name, tool, params } → call MCP tool

  app.get("/mcp", (req, res) => {
    const p = resolveTopProject(req.query);
    if (!p) return res.status(404).json({ error: "no project registered" });
    res.json(registries.for(p).list());
  });

  app.post("/mcp/run", async (req, res) => {
    const { project: projectRef, name, tool, params } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    if (!tool) return res.status(400).json({ error: "tool required" });
    const p = resolveTopProject({ project: projectRef });
    if (!p) return res.status(404).json({ error: "no project registered" });
    try {
      const result = await registries.for(p).call(name, tool, params);
      res.json({ ok: true, result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Session search (cross-agent, cross-conversation) ------------
  // GET /sessions/search?q=...&project=...&limit=20
  // Searches session files (.apc/agents/{slug}/sessions/*.md) and
  // conversation files (~/.apx/.../conversations/*.md) by text content.
  app.get("/sessions/search", (req, res) => {
    const { q, project: projectRef, limit = "20" } = req.query;
    if (!q) return res.status(400).json({ error: "q required" });
    const lim = Math.min(parseInt(limit, 10) || 20, 200);
    const needle = q.toLowerCase();

    // Resolve project (or search all)
    const allProjects = projects.list();
    const targetProjects = (() => {
      if (projectRef != null) {
        const ref = String(projectRef);
        const found = allProjects.find((p) => String(p.id) === ref || p.path === path.resolve(ref));
        return found ? [projects.get(found.id)] : [];
      }
      return allProjects.map((p) => projects.get(p.id)).filter(Boolean);
    })();

    const matches = [];

    for (const p of targetProjects) {
      if (!p) continue;

      // 1. Search session files in project (.apc/agents/{slug}/sessions/)
      const sessionAgentsDir = path.join(p.path, ".apc", "agents");
      if (fs.existsSync(sessionAgentsDir)) {
        for (const slug of fs.readdirSync(sessionAgentsDir)) {
          const sessionsDir = path.join(sessionAgentsDir, slug, "sessions");
          if (!fs.existsSync(sessionsDir)) continue;
          for (const f of fs.readdirSync(sessionsDir).filter((x) => x.endsWith(".md"))) {
            const filePath = path.join(sessionsDir, f);
            try {
              const text = fs.readFileSync(filePath, "utf8");
              if (text.toLowerCase().includes(needle)) {
                // Find matching excerpt
                const lines = text.split("\n");
                const matchLine = lines.findIndex((l) => l.toLowerCase().includes(needle));
                const excerpt = lines.slice(Math.max(0, matchLine - 1), matchLine + 3).join("\n");
                matches.push({
                  type: "session",
                  project: p.id,
                  agent: slug,
                  filename: f,
                  path: filePath,
                  excerpt: excerpt.slice(0, 300),
                });
                if (matches.length >= lim) break;
              }
            } catch {}
          }
          if (matches.length >= lim) break;
        }
      }

      if (matches.length >= lim) break;

      // 2. Search conversation files in daemon storage (~/.apx/.../conversations/)
      const convAgentsDir = path.join(p.storagePath, "agents");
      if (fs.existsSync(convAgentsDir)) {
        for (const slug of fs.readdirSync(convAgentsDir)) {
          const convDir = path.join(convAgentsDir, slug, "conversations");
          if (!fs.existsSync(convDir)) continue;
          for (const f of fs.readdirSync(convDir).filter((x) => x.endsWith(".md"))) {
            const filePath = path.join(convDir, f);
            try {
              const text = fs.readFileSync(filePath, "utf8");
              if (text.toLowerCase().includes(needle)) {
                const lines = text.split("\n");
                const matchLine = lines.findIndex((l) => l.toLowerCase().includes(needle));
                const excerpt = lines.slice(Math.max(0, matchLine - 1), matchLine + 3).join("\n");
                matches.push({
                  type: "conversation",
                  project: p.id,
                  agent: slug,
                  filename: f,
                  path: filePath,
                  excerpt: excerpt.slice(0, 300),
                });
                if (matches.length >= lim) break;
              }
            } catch {}
          }
          if (matches.length >= lim) break;
        }
      }

      if (matches.length >= lim) break;
    }

    res.json({ q, count: matches.length, results: matches });
  });

  // POST /sessions/:id/compact
  // Shortcut: resolves which project/agent owns the session file,
  // then delegates to the existing compactConversation logic.
  // Body: { project?, model? }
  app.post("/sessions/:id/compact", async (req, res) => {
    const { id } = req.params;
    const { model: modelOverride, project: projectRef } = req.body || {};

    // Find which project/agent owns this session ID
    const allProjects = projectRef != null
      ? (() => {
          const ref = String(projectRef);
          const found = projects.list().find((p) => String(p.id) === ref || p.path === path.resolve(ref));
          return found ? [projects.get(found.id)] : [];
        })()
      : projects.list().map((p) => projects.get(p.id)).filter(Boolean);

    let found = null;
    const filename = id.endsWith(".md") ? id : `${id}.md`;

    for (const p of allProjects) {
      if (!p) continue;
      // Search in daemon conversation storage
      const agentsDir = path.join(p.storagePath, "agents");
      if (fs.existsSync(agentsDir)) {
        for (const slug of fs.readdirSync(agentsDir)) {
          const f = path.join(agentsDir, slug, "conversations", filename);
          if (fs.existsSync(f)) {
            found = { p, slug };
            break;
          }
        }
      }
      if (found) break;
    }

    if (!found) {
      return res.status(404).json({ error: `session/conversation "${id}" not found` });
    }

    const { p, slug } = found;
    const { readAgents: _readAgents } = await import("../core/parser.js");
    const agents = _readAgents(p.path);
    const agent = agents.find((a) => a.slug === slug);
    const modelId = modelOverride || agent?.fields?.Model;
    if (!modelId) return res.status(400).json({ error: "agent has no model; pass model in body" });

    try {
      const { compactConversation } = await import("./compact.js");
      const result = await compactConversation({
        storagePath: p.storagePath,
        agentSlug: slug,
        filename,
        modelId,
        config: p.config || config,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---- Admin --------------------------------------------------------
  app.post("/admin/shutdown", (_req, res) => {
    res.json({ ok: true });
    setTimeout(() => process.exit(0), 50);
  });

  // ---- 404 catchall -------------------------------------------------
  app.use((req, res) => res.status(404).json({ error: `no route ${req.method} ${req.path}` }));

  return app;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function agentToResponse(a) {
  if (!a) return null;
  const f = a.fields || {};
  const reserved = new Set(["Role", "Model", "Language", "Description", "Skills", "Tools"]);
  const extra = {};
  for (const [k, v] of Object.entries(f)) {
    if (!reserved.has(k)) extra[k] = v;
  }
  return {
    slug: a.slug,
    role: f.Role || null,
    model: f.Model || null,
    language: f.Language || null,
    description: f.Description || null,
    skills: Array.isArray(f.Skills) ? f.Skills : [],
    tools: Array.isArray(f.Tools) ? f.Tools : [],
    extra,
  };
}
