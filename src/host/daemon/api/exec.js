// Per-agent LLM endpoints — a project agent's own turn, tools and all.
//
//   POST /projects/:pid/agents/:slug/exec         one-shot, no history
//   POST /projects/:pid/agents/:slug/chat         append to (or start) a conversation
//   POST /projects/:pid/agents/:slug/chat/stream  the same turn, as NDJSON events
//
// These are NOT the super-agent (that lives in api/super-agent.js). They run the
// named agent, on its own system prompt, under its own tool allowlist.
import { callEngine } from "#core/engines/index.js";
import { readAgents } from "#core/apc/parser.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { resolveAgentModel } from "#core/agent/agent-model.js";
import { resolveAgentAllowedTools } from "#core/agent/agent-tools.js";
import { runAgent } from "#core/agent/index.js";
import { createToolSession, makeToolHandlers } from "#core/agent/tools/registry.js";
import { createWebConfirmAdapter } from "#core/confirmation/adapters/web.js";
import { CHANNELS } from "#core/constants/channels.js";
import {
  startConversation,
  appendTurn,
  readConversation,
  setStatus,
} from "#core/stores/conversations.js";
import { answerDeliveries } from "#core/stores/deliveries.js";
import { asyncRoute } from "./shared.js";
import { readTurnAttachments } from "./media.js";

// A chat reply is prose, not a Telegram one-liner: run-agent's 512-token default
// truncates an agent mid-answer on the surface where the whole answer is the
// point. Same headroom the routine runner gives itself.
const AGENT_TURN_MAX_TOKENS = 4096;

// How long a streamed turn may go silent before it writes a keepalive byte.
// Matches api/super-agent.js — comfortably under undici's body timeout.
const KEEPALIVE_MS = 20_000;

/**
 * One turn of a project agent.
 *
 * WHY THIS EXISTS. This used to be `callEngine` and nothing else: system prompt
 * in, text out, no tools anywhere. Which is why an agent asked to browse
 * answered with a fenced {"tool":"browser_navigate",…} instead of browsing — it
 * had nothing to call, so narrating the call was the only move left to it. The
 * tools existed, the per-agent allowlist existed; they were simply never handed
 * over outside a routine, and `runAgent` had exactly one caller in the repo.
 *
 * Now the same loop the routine runner uses runs here too, gated by the same
 * `resolveAgentAllowedTools` — the agent's declared `tools:` field when it has
 * one, the broad default when it does not.
 *
 * `tools: false` keeps the old shape for a caller that wants one model call and
 * no side effects.
 */
async function runAgentTurn({
  p,
  agent,
  modelId,
  system,
  prompt,
  previousMessages = [],
  // Images that arrived with this turn: [{ kind, mime, data, path }]. Only the
  // tool-driven path forwards them — the toolless callEngine branch is text.
  attachments = [],
  channel,
  channelMeta,
  temperature,
  maxTokens,
  tools = true,
  maxIters,
  projects,
  plugins,
  registries,
  config,
  onEvent = null,
  onToken = null,
  requestConfirmation = null,
}) {
  const cap = Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : AGENT_TURN_MAX_TOKENS;

  if (tools === false) {
    const result = await callEngine({
      modelId,
      system,
      messages: [...previousMessages, { role: "user", content: prompt }],
      config: p.config || config,
      temperature,
      maxTokens,
    });
    return {
      text: result.text || "",
      trace: [],
      usage: result.usage,
      // What ANSWERED, which is not always what was resolved: routing can fall
      // back mid-turn, and the caller should be told which model replied.
      model: result.model || modelId,
      allowedTools: [],
    };
  }

  const cfg = structuredClone(p.config || config || {});
  // Deliberately NOT forcing permission_mode. A routine pins it to "total"
  // because a scheduled run has nobody to approve a dangerous tool; a chat has
  // a person on the other end, so the configured policy stands and a blocked
  // tool comes back to the model as an observation it can re-plan around.
  const allowedTools = resolveAgentAllowedTools(agent);
  // The allowlist decides WHAT it may call; the channel decides how much of it
  // is loaded up front — a full channel gets the lot, a lightweight one starts
  // on the base set and expands through discover_tools.
  const toolSession = createToolSession(channel, { allowedTools });

  const result = await runAgent({
    globalConfig: cfg,
    system,
    prompt,
    previousMessages,
    attachments,
    overrideModel: modelId,
    toolSchemas: toolSession.initialSchemas,
    makeToolHandlers,
    toolHandlerCtx: {
      projects,
      plugins,
      registries,
      globalConfig: cfg,
      channel,
      channelMeta: {
        ...(channelMeta || {}),
        agentSlug: agent.slug,
        projectPath: p.path,
      },
      toolSession,
      requestConfirmation,
    },
    agentName: agent.slug,
    maxTokens: cap,
    ...(Number.isFinite(Number(maxIters)) ? { maxIters: Number(maxIters) } : {}),
    onEvent,
    onToken,
  });

  return {
    text: result.text || "",
    trace: Array.isArray(result.trace) ? result.trace : [],
    usage: result.usage,
    model: result.model || modelId,
    allowedTools,
  };
}

/** Resolve the agent and its model, or answer the request and return null. */
async function resolveTarget(req, res, p, config) {
  const agents = readAgents(p.path);
  const agent = agents.find((a) => a.slug === req.params.slug);
  if (!agent) {
    res.status(404).json({ error: "agent not found" });
    return null;
  }
  const modelId = await resolveAgentModel({
    agent,
    config,
    override: req.body?.model,
  });
  if (!modelId) {
    res.status(400).json({ error: "agent has no model and none provided" });
    return null;
  }
  return { agent, modelId };
}

/**
 * The conversation this turn belongs to: the one named, or a fresh one.
 * Returns the path, the id, the turns to replay, and any compacted summary.
 */
function openConversation({ p, agent, modelId, system, conversationId, channel }) {
  if (!conversationId) {
    const conv = startConversation({
      storagePath: p.storagePath,
      agentSlug: agent.slug,
      engine: modelId,
      system,
      channel,
    });
    return { path: conv.path, id: conv.id, history: [], compactSummary: null };
  }
  const existing = readConversation(p.storagePath, agent.slug, conversationId);
  if (!existing) return null;
  // Inject compact summary into system instead of replaying it as a turn.
  const compactTurn = existing.turns.find((t) => t.role === "compact");
  const compactSummary = compactTurn
    ? compactTurn.content.replace(/^\[Compacted \d+ turns.*?\]\n\n?/, "").trim()
    : null;
  return {
    path: existing.path,
    id: conversationId,
    history: existing.turns
      .filter((t) => t.role === "user" || t.role === "assistant")
      .map((t) => ({ role: t.role, content: t.content })),
    compactSummary,
  };
}

/** The attribution a reopened conversation renders from. */
function assistantMeta(agent, model, usage, trace) {
  return {
    agent: agent.slug,
    model,
    ...(usage ? { usage } : {}),
    ...(trace && trace.length ? { tools: trace.length } : {}),
  };
}

export function register(api, { projects, project, config, plugins, registries }) {
  api.post("/projects/:pid/agents/:slug/exec", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const {
      prompt,
      temperature,
      maxTokens,
      tools,
      maxIters,
      channel,
      channelMeta,
      attachments,
    } = req.body || {};
    // Files the composer uploaded to ~/.apx/media and named on this turn,
    // resolved the way the super-agent turn resolves them: images ride on the
    // model message, and a marker naming each file is folded into the prompt so
    // a photo with no caption is still a turn and a non-vision engine is told a
    // file arrived and where it lives.
    const turnFiles = readTurnAttachments(attachments);
    if (!prompt && !turnFiles.markers.length) {
      return res.status(400).json({ error: "prompt required" });
    }
    const turnPrompt = [...turnFiles.markers, prompt].filter(Boolean).join(" ");
    const target = await resolveTarget(req, res, p, config);
    if (!target) return;
    const { agent, modelId } = target;

    try {
      const system = buildAgentSystem(p, agent, { invocation: "engine" });
      const conv = startConversation({
        storagePath: p.storagePath,
        agentSlug: agent.slug,
        engine: modelId,
        system,
      });
      appendTurn({ filePath: conv.path, role: "user", content: turnPrompt });

      const result = await runAgentTurn({
        p, agent, modelId, system, prompt: turnPrompt,
        attachments: turnFiles.attachments,
        channel: channel || CHANNELS.API,
        channelMeta,
        temperature, maxTokens, tools, maxIters,
        projects, plugins, registries, config,
      });

      appendTurn({
        filePath: conv.path,
        role: "assistant",
        content: result.text,
        // The same attribution the ledger row below carries. A conversation
        // reopened from its file is read by the same viewer as a channel
        // thread, and without this it renders "0 tok" and no model.
        meta: assistantMeta(agent, result.model, result.usage, result.trace),
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
        // Full attribution, same as the conversation-file half above — the
        // ledger row renders "0 tok"/no model without both fields.
        meta: { conversation: conv.id, model: result.model, usage: result.usage },
      });

      projects.rebuild(p.id);
      res.json({
        conversation: { id: conv.id, filename: conv.filename, path: conv.path },
        text: result.text,
        usage: result.usage,
        engine: result.model,
        trace: result.trace,
        allowed_tools: result.allowedTools,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));

  api.post("/projects/:pid/agents/:slug/chat", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const {
      prompt,
      conversation_id,
      temperature,
      maxTokens,
      tools,
      maxIters,
      channel,
      channelMeta,
      attachments,
    } = req.body || {};
    // Files the composer uploaded to ~/.apx/media and named on this turn,
    // resolved the way the super-agent turn resolves them: images ride on the
    // model message, and a marker naming each file is folded into the prompt so
    // a photo with no caption is still a turn and a non-vision engine is told a
    // file arrived and where it lives.
    const turnFiles = readTurnAttachments(attachments);
    if (!prompt && !turnFiles.markers.length) {
      return res.status(400).json({ error: "prompt required" });
    }
    const turnPrompt = [...turnFiles.markers, prompt].filter(Boolean).join(" ");
    const target = await resolveTarget(req, res, p, config);
    if (!target) return;
    const { agent, modelId } = target;

    try {
      const turn = prepareChatTurn({ p, agent, modelId, conversation_id, channel });
      if (!turn) {
        return res
          .status(404)
          .json({ error: `conversation ${conversation_id} not found` });
      }

      appendTurn({ filePath: turn.conv.path, role: "user", content: turnPrompt });
      // Manu replied in this agent's chat → close its open deliveries (and cancel
      // any grace-window notify still pending). See core/stores/deliveries.js.
      try { answerDeliveries(p.storagePath, agent.slug); } catch { /* best-effort */ }

      const result = await runAgentTurn({
        p, agent, modelId,
        system: turn.system,
        prompt: turnPrompt,
        attachments: turnFiles.attachments,
        previousMessages: turn.conv.history,
        channel: channel || CHANNELS.API,
        channelMeta,
        temperature, maxTokens, tools, maxIters,
        projects, plugins, registries, config,
      });

      appendTurn({
        filePath: turn.conv.path,
        role: "assistant",
        content: result.text,
        meta: assistantMeta(agent, result.model, result.usage, result.trace),
      });
      projects.rebuild(p.id);

      res.json({
        conversation_id: turn.conv.id,
        text: result.text,
        usage: result.usage,
        engine: result.model,
        trace: result.trace,
        allowed_tools: result.allowedTools,
        compacted: !!turn.conv.compactSummary,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));

  // The same turn, streamed. Identical event vocabulary to the super-agent's
  // /chat/stream, so a client that already renders tool progress for Roby needs
  // no second reader for Magui.
  api.post("/projects/:pid/agents/:slug/chat/stream", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const {
      prompt,
      conversation_id,
      temperature,
      maxTokens,
      tools,
      maxIters,
      channel,
      channelMeta,
      attachments,
    } = req.body || {};
    // Files the composer uploaded to ~/.apx/media and named on this turn,
    // resolved the way the super-agent turn resolves them: images ride on the
    // model message, and a marker naming each file is folded into the prompt so
    // a photo with no caption is still a turn and a non-vision engine is told a
    // file arrived and where it lives.
    const turnFiles = readTurnAttachments(attachments);
    if (!prompt && !turnFiles.markers.length) {
      return res.status(400).json({ error: "prompt required" });
    }
    const turnPrompt = [...turnFiles.markers, prompt].filter(Boolean).join(" ");
    const target = await resolveTarget(req, res, p, config);
    if (!target) return;
    const { agent, modelId } = target;

    const turn = prepareChatTurn({ p, agent, modelId, conversation_id, channel });
    if (!turn) {
      return res
        .status(404)
        .json({ error: `conversation ${conversation_id} not found` });
    }

    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();

    let lastWriteAt = Date.now();
    const send = (event) => {
      lastWriteAt = Date.now();
      res.write(JSON.stringify(event) + "\n");
    };
    // A bare newline is a valid no-op in NDJSON: one tool can own the turn for
    // minutes, and to an HTTP client that is an idle body undici drops.
    const keepalive = setInterval(() => {
      if (Date.now() - lastWriteAt < KEEPALIVE_MS) return;
      lastWriteAt = Date.now();
      try { res.write("\n"); } catch { /* the socket is gone; close clears us */ }
    }, KEEPALIVE_MS);
    keepalive.unref?.();
    res.on("close", () => clearInterval(keepalive));

    appendTurn({ filePath: turn.conv.path, role: "user", content: turnPrompt });
    // Manu replied in this agent's chat → close its open deliveries (and cancel
    // any grace-window notify still pending). See core/stores/deliveries.js.
    try { answerDeliveries(p.storagePath, agent.slug); } catch { /* best-effort */ }

    try {
      const result = await runAgentTurn({
        p, agent, modelId,
        system: turn.system,
        prompt: turnPrompt,
        attachments: turnFiles.attachments,
        previousMessages: turn.conv.history,
        channel: channel || CHANNELS.WEB,
        channelMeta,
        temperature, maxTokens, tools, maxIters,
        projects, plugins, registries, config,
        onEvent: send,
        onToken: (chunk) => send({ type: "assistant_delta", delta: chunk }),
        // A streamed turn CAN answer a confirmation round-trip (the client
        // posts to /super-agent/confirm/:id). A caller that cannot — `apx exec`
        // renders a spinner and nothing else — sends confirm:false and falls
        // back to the configured policy, same as the blocking endpoint.
        requestConfirmation:
          req.body?.confirm === false ? null : createWebConfirmAdapter({ onEvent: send }),
      });

      appendTurn({
        filePath: turn.conv.path,
        role: "assistant",
        content: result.text,
        meta: assistantMeta(agent, result.model, result.usage, result.trace),
      });
      projects.rebuild(p.id);

      send({
        type: "final",
        result: {
          conversation_id: turn.conv.id,
          text: result.text,
          usage: result.usage,
          name: agent.slug,
          model: result.model,
          trace: result.trace,
          allowed_tools: result.allowedTools,
          compacted: !!turn.conv.compactSummary,
        },
      });
      clearInterval(keepalive);
      res.end();
    } catch (e) {
      clearInterval(keepalive);
      send({ type: "error", error: e.message });
      res.end();
    }
  }));

  /** Everything both chat endpoints need before the model is called. */
  function prepareChatTurn({ p, agent, modelId, conversation_id, channel }) {
    // The system prompt has to exist before the conversation file that records
    // it, and the compacted summary has to be inside it — so the file is opened
    // first when it already exists, and created after when it does not.
    const existing = conversation_id
      ? openConversation({ p, agent, modelId, system: "", conversationId: conversation_id, channel })
      : null;
    if (conversation_id && !existing) return null;

    const extraParts = existing?.compactSummary
      ? [`## Previous Conversation Context (Compacted)\n${existing.compactSummary}`]
      : [];
    const system = buildAgentSystem(p, agent, { invocation: "engine", extraParts });

    const conv =
      existing ||
      openConversation({ p, agent, modelId, system, conversationId: null, channel });
    return { system, conv };
  }
}
