// Per-agent LLM endpoints — a project agent's own turn, tools and all.
//
//   POST /projects/:pid/agents/:slug/exec         one-shot, no history
//   POST /projects/:pid/agents/:slug/chat         append to (or start) a conversation
//   POST /projects/:pid/agents/:slug/chat/stream  the same turn, as NDJSON events
//
// These are NOT the super-agent (that lives in api/super-agent.js). They run the
// named agent, on its own system prompt, under its own tool allowlist.
import { readAgents } from "#core/apc/parser.js";
import { buildAgentSystem } from "#core/agent/build-agent-system.js";
import { resolveAgentModel } from "#core/agent/agent-model.js";
import { runAgentTurn } from "#core/agent/run-turn.js";
import { createWebConfirmAdapter } from "#core/confirmation/adapters/web.js";
import { CHANNELS } from "#core/constants/channels.js";
import {
  startConversation,
  appendTurn,
  readConversation,
  setStatus,
} from "#core/stores/conversations.js";
import { buildTurnAttribution, appendAgentReplyToConversation } from "#core/stores/turn-record.js";
import { answerDeliveries } from "#core/stores/deliveries.js";
import { attachmentsMeta } from "#core/stores/media-archive.js";
import { asyncRoute, rejectA2AWrite} from "./shared.js";
import { readTurnAttachments } from "./media.js";
import { broadcastTurn } from "../events-ws.js";
import { startActiveTurn, appendActiveTurn, endActiveTurn, convTurnKey } from "../active-turns.js";
import { wasAborted, abortedTurnEvent } from "./turn-abort.js";

// How long a streamed turn may go silent before it writes a keepalive byte.
// Matches api/super-agent.js — comfortably under undici's body timeout.
const KEEPALIVE_MS = 20_000;


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
function turnAttribution(agent, result) {
  return buildTurnAttribution({
    agentSlug: agent.slug,
    agentName: agent.fields?.Name || agent.slug,
    model: result.model,
    usage: result.usage,
    trace: result.trace,
  });
}

function persistAgentReply({ filePath, agent, result }) {
  // Images the agent attached to THIS reply (attach_media). Archived into
  // ~/.apx/media on the way, because a skill's picture lives beside its
  // SKILL.md and the media endpoint serves nothing from outside the media dir —
  // the row would name a file the viewer is not allowed to fetch.
  const attribution = { ...turnAttribution(agent, result), ...attachmentsMeta(result.media) };
  appendAgentReplyToConversation({
    filePath,
    reply: result.text,
    trace: result.trace,
    attribution,
  });
  return attribution;
}

export function register(api, { projects, project, config, plugins, registries }) {
  api.post("/projects/:pid/agents/:slug/exec", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    // An a2a thread is a transcript, not an addressable agent.
    if (rejectA2AWrite(req, res, "written to")) return;
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
      appendTurn({ filePath: conv.path, role: "user", content: turnPrompt, meta: turnFiles.media || undefined });

      const result = await runAgentTurn({
        p, agent, modelId, system, prompt: turnPrompt,
        attachments: turnFiles.attachments,
        channel: channel || CHANNELS.API,
        channelMeta,
        temperature, maxTokens, tools, maxIters,
        projects, plugins, registries, config,
      });

      const attribution = persistAgentReply({ filePath: conv.path, agent, result });
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
        meta: { conversation: conv.id, ...attribution },
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
    // An a2a thread is a transcript, not an addressable agent.
    if (rejectA2AWrite(req, res, "written to")) return;
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

      appendTurn({ filePath: turn.conv.path, role: "user", content: turnPrompt, meta: turnFiles.media || undefined });
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

      persistAgentReply({ filePath: turn.conv.path, agent, result });
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
    // An a2a thread is a transcript, not an addressable agent.
    if (rejectA2AWrite(req, res, "written to")) return;
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

    appendTurn({ filePath: turn.conv.path, role: "user", content: turnPrompt, meta: turnFiles.media || undefined });
    // Manu replied in this agent's chat → close its open deliveries (and cancel
    // any grace-window notify still pending). See core/stores/deliveries.js.
    try { answerDeliveries(p.storagePath, agent.slug); } catch { /* best-effort */ }

    // Register the turn and push it over the shared feed too, so a surface that
    // did NOT open this stream (another tab, or this one after a refresh) can
    // catch up on the partial and follow the tokens live. The turn keeps running
    // here regardless of whether this NDJSON socket stays open.
    const turnKey = convTurnKey(p.id, turn.conv.id);
    // The run's kill switch. Closing this socket deliberately does NOT stop the
    // turn — that is what lets another tab catch up — so stopping it has to be
    // asked for out loud, via POST .../turns/abort, which reaches `abort` here.
    const turnAbort = new AbortController();
    const active = startActiveTurn(turnKey, {
      project_id: p.id, agent_slug: agent.slug, conversation_id: turn.conv.id, model: modelId,
      abort: () => turnAbort.abort(),
    });
    // The steps as they happen. runAgentTurn throws on abort and its trace goes
    // with it, so an interrupted turn would otherwise be persisted as prose with
    // the work erased — and the turn that continues it would not know which
    // tools had already run for real.
    const partialTrace = [];
    const turnFrame = (phase, extra) => broadcastTurn({
      phase, project_id: p.id, agent_slug: agent.slug, conversation_id: turn.conv.id,
      turn_id: active.id, ...extra,
    });
    turnFrame("start");
    // The conversation's identity, up front. It used to ride only on `final`,
    // which meant the first turn of a new chat could not be addressed until it
    // was over — no way to stop it, and nothing for another tab to follow.
    send({
      type: "start",
      conversation_id: turn.conv.id,
      turn_id: active.id,
      agent_slug: agent.slug,
      model: modelId,
    });

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
        signal: turnAbort.signal,
        onEvent: (ev) => {
          if (ev?.type === "tool_result" && ev.trace) partialTrace.push(ev.trace);
          send(ev);
        },
        onToken: (chunk) => { send({ type: "assistant_delta", delta: chunk }); appendActiveTurn(active.id, chunk); turnFrame("delta", { delta: chunk }); },
        // A streamed turn CAN answer a confirmation round-trip (the client
        // posts to /super-agent/confirm/:id). A caller that cannot — `apx exec`
        // renders a spinner and nothing else — sends confirm:false and falls
        // back to the configured policy, same as the blocking endpoint.
        requestConfirmation:
          req.body?.confirm === false ? null : createWebConfirmAdapter({ onEvent: send }),
      });

      persistAgentReply({ filePath: turn.conv.path, agent, result });
      projects.rebuild(p.id);

      const finalResult = {
        conversation_id: turn.conv.id,
        text: result.text,
        usage: result.usage,
        name: agent.slug,
        model: result.model,
        trace: result.trace,
        allowed_tools: result.allowedTools,
        compacted: !!turn.conv.compactSummary,
      };
      turnFrame("final", { result: finalResult });
      send({ type: "final", result: finalResult });
      clearInterval(keepalive);
      res.end();
    } catch (e) {
      // Interrupted, not broken. Whatever streamed is real work the user saw, so
      // it stays in the thread — the message that interrupted this turn opens
      // the next one, and reads what got done here as its history. Same contract
      // Telegram has: "whatever streamed so far is already sent + logged; the
      // newer message's run continues the thread."
      if (wasAborted(e, turnAbort)) {
        const partial = (active.text || "").trim();
        if (partial || partialTrace.length) {
          persistAgentReply({
            filePath: turn.conv.path,
            agent,
            result: { text: partial, trace: partialTrace, model: modelId, media: [] },
          });
          projects.rebuild(p.id);
        }
        const ev = abortedTurnEvent({ text: partial, trace: partialTrace });
        turnFrame("aborted", ev);
        clearInterval(keepalive);
        send(ev);
        res.end();
        return;
      }
      turnFrame("error", { error: e.message });
      clearInterval(keepalive);
      send({ type: "error", error: e.message });
      res.end();
    } finally {
      endActiveTurn(active.id);
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
