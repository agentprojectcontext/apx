// Per-agent conversation surface: list, fetch, compact, and a2a /send.
//   GET  /projects/:pid/agents/:slug/conversations
//   GET  /projects/:pid/agents/:slug/conversations/:id
//   GET  /projects/:pid/super-agent/threads                    (channel ledger)
//   GET  /projects/:pid/super-agent/threads/:channel/:id
//   POST /projects/:pid/agents/:slug/compact
//   POST /projects/:pid/agents/:slug/conversations/:id/compact
//   POST /projects/:pid/send                                   (agent-to-agent)
import { readAgents } from "#core/apc/parser.js";
import { listConversations, readConversation, deleteConversation, setConversationMeta, shapeConversationMessage } from "#core/stores/conversations.js";
import { listGlobalThreads, readGlobalThread, deleteGlobalThread, setGlobalThreadMeta } from "#core/stores/messages.js";
import { compactConversation } from "#core/stores/conversations-compactor.js";
import { replyAsAgent } from "#core/agent/a2a/reply.js";
import { resolveAgentModel } from "#core/agent/agent-model.js";
import { nowIso, asyncRoute } from "./shared.js";

export function register(api, { project, config }) {
  // The super-agent (default name "apx") is a pseudo-agent: it owns
  // conversations per project but is NOT listed in AGENTS.md. Resolve its slug
  // so `apx conversations list` (which defaults to the super-agent) works
  // instead of 404-ing on the AGENTS.md check.
  const superAgentSlug = () => config?.super_agent?.name || "apx";
  const agentResolvable = (p, slug) =>
    slug === superAgentSlug() || readAgents(p.path).some((a) => a.slug === slug);

  api.get("/projects/:pid/agents/:slug/conversations", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    if (!agentResolvable(p, req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    res.json(
      listConversations(p.storagePath, req.params.slug, {
        includeArchived: req.query.include_archived === "1",
      }),
    );
  });

  // Rename, or put away. Archiving is the smaller decision — the file stays
  // exactly where it is and only drops out of the lists that offer chats to
  // resume, so it stays a decision you can take back.
  api.patch("/projects/:pid/agents/:slug/conversations/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    if (!agentResolvable(p, req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    const { title, archived } = req.body || {};
    if (title === undefined && archived === undefined)
      return res.status(400).json({ error: "nothing to change" });
    const ok = setConversationMeta(p.storagePath, req.params.slug, req.params.id, {
      ...(title !== undefined ? { title } : {}),
      ...(archived !== undefined ? { archived: !!archived } : {}),
    });
    if (!ok) return res.status(404).json({ error: "conversation not found" });
    res.json({ ok: true });
  });

  api.get("/projects/:pid/agents/:slug/conversations/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const conv = readConversation(p.storagePath, req.params.slug, req.params.id);
    if (!conv) return res.status(404).json({ error: "conversation not found" });
    // Shape the response as the `ConversationDetail` the web client expects:
    // `messages[]` (mapped from the parsed `turns`) + id/agent/channel. Without
    // this the client's `detail.messages.filter(...)` throws on every load.
    res.json({
      id: req.params.id,
      agent_slug: req.params.slug,
      channel: conv.fm?.channel,
      messages: (conv.turns || []).map(shapeConversationMessage),
      meta: conv.fm || {},
    });
  });

  api.delete("/projects/:pid/agents/:slug/conversations/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    if (!agentResolvable(p, req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    const ok = deleteConversation(p.storagePath, req.params.slug, req.params.id);
    if (!ok) return res.status(404).json({ error: "conversation not found" });
    res.json({ ok: true });
  });

  // ---- Super-agent channel threads ----
  // The super-agent's chats (telegram, web quick-chat, desktop, deck …) live
  // in the global per-channel ledger, not in per-agent conversation files.
  // These endpoints surface that ledger as day-threads so the web Chats
  // sidebar can list and reopen them.
  //
  // Scope: each project lists only the super-agent chats that happened in it.
  // The default workspace (project 0) additionally owns every unstamped turn —
  // Telegram, desktop and deck have no project of their own, so that is where
  // those conversations live. Passing `undefined` for project 0, as this used
  // to, means "no filter", and the unstamped-rows-belong-everywhere rule it
  // paired with then listed the same ~90 Telegram threads under every project.
  // Channel grouping is untouched: a project with its own Telegram routing
  // still gets a Telegram group holding just its chats.
  const threadScope = (p) => String(p.id);

  api.get("/projects/:pid/super-agent/threads", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(
      listGlobalThreads({
        project: threadScope(p),
        includeArchived: req.query.include_archived === "1",
      }),
    );
  });

  api.get("/projects/:pid/super-agent/threads/:channel/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const thread = readGlobalThread({
      channel: req.params.channel,
      date: req.params.id,
      project: threadScope(p),
    });
    if (!thread) return res.status(404).json({ error: "thread not found" });
    res.json(thread);
  });

  api.delete("/projects/:pid/super-agent/threads/:channel/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const ok = deleteGlobalThread({
      channel: req.params.channel,
      date: req.params.id,
      project: threadScope(p),
    });
    if (!ok) return res.status(404).json({ error: "thread not found" });
    res.json({ ok: true });
  });

  // A channel thread has no file of its own to carry a name, so the two
  // decisions a reader can make about one — what to call it, whether to put it
  // away — live in a small index beside the ledger. The messages are untouched.
  api.patch("/projects/:pid/super-agent/threads/:channel/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { title, archived } = req.body || {};
    if (title === undefined && archived === undefined)
      return res.status(400).json({ error: "nothing to change" });
    const ok = setGlobalThreadMeta({
      channel: req.params.channel,
      date: req.params.id,
      ...(title !== undefined ? { title } : {}),
      ...(archived !== undefined ? { archived: !!archived } : {}),
    });
    if (!ok) return res.status(404).json({ error: "thread not found" });
    res.json({ ok: true });
  });

  async function handleCompact(req, res, filename) {
    const p = project(req, res);
    if (!p) return;
    const agents = readAgents(p.path);
    const agent = agents.find((a) => a.slug === req.params.slug);
    if (!agent) return res.status(404).json({ error: "agent not found" });
    const modelId = await resolveAgentModel({
      agent,
      config: p.config || config,
      override: (req.body || {}).model,
    });
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

  api.post("/projects/:pid/agents/:slug/compact", (req, res) =>
    handleCompact(req, res, null)
  );

  api.post(
    "/projects/:pid/agents/:slug/conversations/:id/compact",
    (req, res) => handleCompact(req, res, req.params.id)
  );

  // ---- Agent-to-agent routing ----
  api.post("/projects/:pid/send", asyncRoute(async (req, res) => {
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
    if (!fromAgent)
      return res.status(404).json({ error: `from agent "${from}" not found` });
    if (!toAgent)
      return res.status(404).json({ error: `to agent "${to}" not found` });

    const ts = nowIso();
    p.logMessage({
      agent_slug: from,
      channel: "a2a",
      direction: "out",
      author: from,
      body,
      meta: { to, depth: _depth },
      ts,
    });
    p.logMessage({
      agent_slug: to,
      channel: "a2a",
      direction: "in",
      author: from,
      body,
      meta: { from, depth: _depth },
      ts,
    });

    // An agent that inherits still replies: replyAsAgent resolves the router
    // default for it. `deliver` is the only gate here.
    let reply = null;
    if (deliver) {
      try {
        const result = await replyAsAgent({
          projectPath: p.path,
          toAgent,
          fromAgent,
          body,
          config: p.config || config,
        });

        p.logMessage({
          agent_slug: to,
          channel: "a2a",
          direction: "out",
          author: to,
          body: result.text,
          meta: {
            to: from,
            depth: _depth + 1,
            reply_to: fromAgent.slug,
            usage: result.usage,
          },
        });
        p.logMessage({
          agent_slug: from,
          channel: "a2a",
          direction: "in",
          author: to,
          body: result.text,
          meta: { from: to, depth: _depth + 1 },
        });
        reply = { text: result.text, usage: result.usage };
      } catch (e) {
        reply = { error: e.message };
      }
    }

    res.json({ from, to, body, ts, reply });
  }));
}
