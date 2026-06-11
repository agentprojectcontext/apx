// Per-agent one-shot / multi-turn LLM endpoints. These do NOT run the
// super-agent tool loop — they go straight to the model with the agent's
// system prompt. The super-agent endpoints live in api/super-agent.js.
//
//   POST /projects/:pid/agents/:slug/exec     one-shot, no history
//   POST /projects/:pid/agents/:slug/chat     append to (or start) a conversation
import { callEngine } from "#core/engines/index.js";
import { readAgents } from "#core/apc/parser.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { resolveActiveModel } from "#core/agent/model-router.js";
import {
  startConversation,
  appendTurn,
  readConversation,
  setStatus,
} from "#core/stores/conversations.js";

// Pick a model for a direct agent chat: explicit override → agent's own model →
// super-agent default (resolved via the same router the super-agent uses, so
// it walks the fallback chain when the primary is empty/unhealthy).
async function pickAgentModel({ modelOverride, agent, config }) {
  if (modelOverride) return modelOverride;
  if (agent.fields?.Model) return agent.fields.Model;
  try {
    const routing = await resolveActiveModel(config);
    return routing?.modelId || null;
  } catch {
    return null;
  }
}

export function register(app, { projects, project, config }) {
  app.post("/projects/:pid/agents/:slug/exec", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const {
      prompt,
      model: modelOverride,
      temperature,
      maxTokens,
    } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const agents = readAgents(p.path);
    const agent = agents.find((a) => a.slug === req.params.slug);
    if (!agent) return res.status(404).json({ error: "agent not found" });
    const modelId = await pickAgentModel({ modelOverride, agent, config });
    if (!modelId)
      return res
        .status(400)
        .json({ error: "agent has no model and none provided" });

    try {
      const system = buildAgentSystem(p, agent, { invocation: "engine" });
      const conv = startConversation({
        storagePath: p.storagePath,
        agentSlug: agent.slug,
        engine: modelId,
        system,
      });
      appendTurn({ filePath: conv.path, role: "user", content: prompt });

      const result = await callEngine({
        modelId,
        system,
        messages: [{ role: "user", content: prompt }],
        config: p.config || config,
        temperature,
        maxTokens,
      });

      appendTurn({
        filePath: conv.path,
        role: "assistant",
        content: result.text,
      });
      setStatus(conv.path, "closed");

      p.logMessage({
        agent_slug: agent.slug,
        channel: "engine",
        direction: "in",
        author: "user",
        body: prompt,
        meta: { conversation: conv.id },
      });
      p.logMessage({
        agent_slug: agent.slug,
        channel: "engine",
        direction: "out",
        type: "agent",
        actor_id: agent.slug,
        actor_kind: "agent",
        author: agent.slug,
        body: result.text,
        meta: { conversation: conv.id, usage: result.usage },
      });

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

  app.post("/projects/:pid/agents/:slug/chat", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const {
      prompt,
      conversation_id,
      model: modelOverride,
      temperature,
      maxTokens,
    } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const agents = readAgents(p.path);
    const agent = agents.find((a) => a.slug === req.params.slug);
    if (!agent) return res.status(404).json({ error: "agent not found" });
    const modelId = await pickAgentModel({ modelOverride, agent, config });
    if (!modelId)
      return res
        .status(400)
        .json({ error: "agent has no model and none provided" });

    try {
      let convPath;
      let convId;
      let history = [];
      let compactSummary = null;

      if (conversation_id) {
        const existing = readConversation(
          p.storagePath,
          agent.slug,
          conversation_id
        );
        if (!existing)
          return res
            .status(404)
            .json({ error: `conversation ${conversation_id} not found` });
        convPath = existing.path;
        convId = conversation_id;
        // Inject compact summary into system instead of replaying it as a turn.
        const compactTurn = existing.turns.find((t) => t.role === "compact");
        if (compactTurn) {
          compactSummary = compactTurn.content
            .replace(/^\[Compacted \d+ turns.*?\]\n\n?/, "")
            .trim();
        }
        history = existing.turns
          .filter((t) => t.role === "user" || t.role === "assistant")
          .map((t) => ({ role: t.role, content: t.content }));
      }

      const extraParts = compactSummary
        ? [`## Previous Conversation Context (Compacted)\n${compactSummary}`]
        : [];
      const system = buildAgentSystem(p, agent, {
        invocation: "engine",
        extraParts,
      });

      if (!conversation_id) {
        const conv = startConversation({
          storagePath: p.storagePath,
          agentSlug: agent.slug,
          engine: modelId,
          system,
        });
        convPath = conv.path;
        convId = conv.id;
      }

      appendTurn({ filePath: convPath, role: "user", content: prompt });
      history.push({ role: "user", content: prompt });

      const result = await callEngine({
        modelId,
        system,
        messages: history,
        config: p.config || config,
        temperature,
        maxTokens,
      });
      appendTurn({
        filePath: convPath,
        role: "assistant",
        content: result.text,
      });
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
}
