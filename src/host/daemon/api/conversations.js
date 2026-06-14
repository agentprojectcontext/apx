// Per-agent conversation surface: list, fetch, compact, and a2a /send.
//   GET  /projects/:pid/agents/:slug/conversations
//   GET  /projects/:pid/agents/:slug/conversations/:id
//   POST /projects/:pid/agents/:slug/compact
//   POST /projects/:pid/agents/:slug/conversations/:id/compact
//   POST /projects/:pid/send                                   (agent-to-agent)
import { readAgents } from "#core/apc/parser.js";
import { listConversations, readConversation } from "#core/stores/conversations.js";
import { compactConversation } from "#core/stores/conversations-compactor.js";
import { replyAsAgent } from "#core/agent/a2a/reply.js";
import { nowIso } from "./shared.js";

export function register(app, { project, config }) {
  // The super-agent (default name "apx") is a pseudo-agent: it owns
  // conversations per project but is NOT listed in AGENTS.md. Resolve its slug
  // so `apx conversations list` (which defaults to the super-agent) works
  // instead of 404-ing on the AGENTS.md check.
  const superAgentSlug = () => config?.super_agent?.name || "apx";
  const agentResolvable = (p, slug) =>
    slug === superAgentSlug() || readAgents(p.path).some((a) => a.slug === slug);

  app.get("/projects/:pid/agents/:slug/conversations", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    if (!agentResolvable(p, req.params.slug))
      return res.status(404).json({ error: "agent not found" });
    res.json(listConversations(p.storagePath, req.params.slug));
  });

  app.get("/projects/:pid/agents/:slug/conversations/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const conv = readConversation(p.storagePath, req.params.slug, req.params.id);
    if (!conv) return res.status(404).json({ error: "conversation not found" });
    res.json(conv);
  });

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

  app.post(
    "/projects/:pid/agents/:slug/conversations/:id/compact",
    (req, res) => handleCompact(req, res, req.params.id)
  );

  // ---- Agent-to-agent routing ----
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

    let reply = null;
    if (deliver && toAgent.fields.Model) {
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
  });
}
