// "super-agent" here is the *default APX agent* — the tool-using loop that
// runs when no project agent is named (Telegram, overlay, TUI without
// --agent). It is NOT a persona with that name; it is the system-level
// dispatcher described in core/agent/run-agent.js.
//
//   POST /projects/:pid/super-agent/chat/stream    NDJSON event stream
//   POST /projects/:pid/super-agent/chat            blocking JSON response
import { runSuperAgent } from "../super-agent.js";
import {
  resolveSuperAgentContext,
  appendSuperAgentErrorTrace,
} from "./shared.js";
import { loggerFor } from "../../../core/logging.js";
import { appendGlobalMessage } from "../../../core/messages-store.js";
import { createWebConfirmAdapter } from "../../../core/confirmation/adapters/web.js";

const log = loggerFor("super-agent");

// Persist human web turns to the cross-channel message store so they feed the
// RAG index, search_messages, and the "active threads" awareness block. Only
// the human surfaces (web big chat + sidebar) — not generic "api"/automation
// callers. Best-effort: a logging failure never breaks the reply.
const WEB_LOGGED_CHANNELS = new Set(["web", "web_sidebar"]);
function logWebTurn(channel, { prompt, replyText }) {
  if (!WEB_LOGGED_CHANNELS.has(channel)) return;
  try {
    appendGlobalMessage({ channel, direction: "in", type: "user", author: "user", body: prompt });
    if (replyText) {
      appendGlobalMessage({ channel, direction: "out", type: "agent", body: replyText });
    }
  } catch {
    /* best-effort */
  }
}

// Wrap an onEvent emitter so that operationally interesting events also land
// in the unified daemon log. We don't log every "model_start" — too noisy —
// just the ones a user would want to see in `apx log -f` after a turn fails
// or rotates models.
function wrapOnEventForLog(send, { trace_id, channel }) {
  return (event) => {
    if (event?.type === "engine_failed") {
      log.warn(
        `engine ${event.model || "?"} failed → retrying with ${event.retry_with || "?"}`,
        { trace_id, channel, reason: event.reason }
      );
    } else if (event?.type === "tools_suppressed") {
      log.info(
        `tools suppressed: ${(event.tools || []).join(", ")} (${event.reason || "?"})`,
        { trace_id, channel }
      );
    } else if (event?.type === "model_routed" && event.from_fallback) {
      log.info(
        `model routing fell back: ${event.model} (provider=${event.provider})`,
        { trace_id, channel }
      );
    }
    if (send) send(event);
  };
}

export function register(app, { projects, registries, plugins, project, config }) {
  app.post("/projects/:pid/super-agent/chat/stream", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    // Optional coding-surface knobs: the terminal Code TUI (apx code, Build
    // mode) sends these so it runs to completion exactly like the web Code
    // module. Plain chat callers omit them and keep the lightweight defaults.
    const { prompt, previousMessages, model, maxIters, maxTokens, completionContract } =
      req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const ctx = resolveSuperAgentContext(req, p);

    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();

    const send = (event) => {
      res.write(JSON.stringify(event) + "\n");
    };

    const onEvent = wrapOnEventForLog(send, {
      trace_id: req.apxTraceId,
      channel: ctx.channel,
    });

    // Web/TUI channels receive a "confirmation_required" SSE event and respond
    // via POST /super-agent/confirm/:correlationId (see api/confirm.js).
    const requestConfirmation = createWebConfirmAdapter({ onEvent });

    try {
      const saResult = await runSuperAgent({
        globalConfig: config,
        projects,
        plugins,
        registries,
        prompt,
        channel: ctx.channel,
        channelMeta: ctx.channelMeta,
        contextNote: ctx.contextNote,
        previousMessages: previousMessages || [],
        overrideModel: model,
        ...(Number.isFinite(Number(maxIters)) ? { maxIters: Number(maxIters) } : {}),
        ...(Number.isFinite(Number(maxTokens)) ? { maxTokens: Number(maxTokens) } : {}),
        ...(completionContract ? { completionContract: true } : {}),
        onEvent,
        requestConfirmation,
      });
      projects.rebuild(p.id);
      logWebTurn(ctx.channel, { prompt, replyText: saResult.text });
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
      appendSuperAgentErrorTrace(req, e, {
        prompt,
        channel: ctx.channel,
        previousMessages,
        model,
        stream: true,
      });
      send({
        type: "error",
        trace_id: req.apxTraceId,
        error: `${e.message} (trace: ${req.apxTraceId})`,
      });
      res.end();
    }
  });

  // Project-agnostic one-shot summarize endpoint. Used by `apx session resume
  // <id>` when the session lives outside any registered APX project (e.g. a
  // raw Claude/Codex session). Returns { text } so callers can format the
  // summary however they want.
  app.post("/super-agent/summarize", async (req, res) => {
    const { prompt, context_note: contextNote = "", model, max_tokens } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    try {
      const saResult = await runSuperAgent({
        globalConfig: config,
        projects,
        plugins,
        registries,
        prompt,
        contextNote,
        channel: "api",
        overrideModel: model,
        maxTokens:
          max_tokens && Number.isFinite(Number(max_tokens))
            ? Number(max_tokens)
            : undefined,
        // Summaries are pure text — no tool registry, so a transcript that
        // mentions a tool (telegram, etc.) can't trigger a real side effect.
        noTools: true,
      });
      res.json({
        text: saResult.text,
        usage: saResult.usage,
        name: saResult.name,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/projects/:pid/super-agent/chat", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { prompt, previousMessages, model } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const ctx = resolveSuperAgentContext(req, p);
    try {
      const saResult = await runSuperAgent({
        globalConfig: config,
        projects,
        plugins,
        registries,
        prompt,
        channel: ctx.channel,
        channelMeta: ctx.channelMeta,
        contextNote: ctx.contextNote,
        previousMessages: previousMessages || [],
        overrideModel: model,
        onEvent: wrapOnEventForLog(null, {
          trace_id: req.apxTraceId,
          channel: ctx.channel,
        }),
      });
      projects.rebuild(p.id);
      logWebTurn(ctx.channel, { prompt, replyText: saResult.text });
      res.json({
        text: saResult.text,
        usage: saResult.usage,
        name: saResult.name,
        trace: saResult.trace,
      });
    } catch (e) {
      appendSuperAgentErrorTrace(req, e, {
        prompt,
        channel: ctx.channel,
        previousMessages,
        model,
        stream: false,
      });
      res.status(500).json({ error: e.message, trace_id: req.apxTraceId });
    }
  });
}
