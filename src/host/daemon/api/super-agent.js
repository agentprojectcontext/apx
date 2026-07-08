// "super-agent" here is the *default APX agent* — the tool-using loop that
// runs when no project agent is named (Telegram, overlay, TUI without
// --agent). It is NOT a persona with that name; it is the system-level
// dispatcher described in core/agent/run-agent.js.
//
//   POST /projects/:pid/super-agent/chat/stream    NDJSON event stream
//   POST /projects/:pid/super-agent/chat            blocking JSON response
import { runSuperAgent } from "#core/agent/super-agent.js";
import {
  resolveSuperAgentContext,
  appendSuperAgentErrorTrace,
} from "./shared.js";
import { loggerFor } from "#core/logging.js";
import { appendGlobalMessage } from "#core/stores/messages.js";
import { createWebConfirmAdapter } from "#core/confirmation/adapters/web.js";
import { tryResolveSkillCommand, matchSkillKeywordTriggers } from "#core/agent/skills/trigger.js";
import { suggestSkillForPrompt } from "#core/agent/skills/rag.js";
import { inspectPromptForSkills, isInspectorEnabled, summarizeTrace } from "#core/agent/skills/inspector.js";
import { CHANNELS } from "#core/constants/channels.js";

const log = loggerFor("super-agent");

// Emit a single, readable line so `apx log -f` shows exactly what the skill
// inspector decided this turn (which skills it loaded/hinted, the embedder, and
// the top similarity). Best-effort: logging must never break a reply.
function logInspectorDecision(trace, { trace_id, channel } = {}) {
  if (!trace) return;
  try {
    const top = trace.scored?.[0];
    const topStr = top ? ` top=${top.slug}@${top.sim}` : "";
    log.info(`skill inspector: ${summarizeTrace(trace)} [${trace.embedder || "?"}]${topStr}`, {
      trace_id,
      channel,
      loaded: trace.loaded || [],
      hinted: trace.hinted || [],
    });
  } catch {
    /* logging is best-effort */
  }
}

// One readable log line per keyword-trigger match so `apx log -f` shows which
// skill(s) a keyword auto-injected. Best-effort, mirrors logInspectorDecision.
function logKeywordTriggerDecision(keyword, { trace_id, channel } = {}) {
  if (!keyword?.matched?.length) return;
  try {
    const summary = keyword.matched.map((m) => `${m.slug}("${m.keyword}")`).join(", ");
    log.info(`skill keyword trigger: injected ${summary}`, {
      trace_id,
      channel,
      matched: keyword.matched,
    });
  } catch {
    /* logging is best-effort */
  }
}

// Persist human web turns to the cross-channel message store so they feed the
// RAG index, search_messages, and the "active threads" awareness block. Only
// the human surfaces (web big chat + sidebar) — not generic "api"/automation
// callers. Best-effort: a logging failure never breaks the reply.
const WEB_LOGGED_CHANNELS = new Set([CHANNELS.WEB, CHANNELS.WEB_SIDEBAR]);
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
    const { prompt: rawPrompt, previousMessages, model, maxIters, maxTokens, completionContract } =
      req.body || {};
    if (!rawPrompt) return res.status(400).json({ error: "prompt required" });
    const ctx = resolveSuperAgentContext(req, p);

    // `/slug ...` shortcut: load the matching skill body into contextNote and
    // strip the prefix from the user prompt. Falls through unchanged when the
    // slug is unknown.
    const slashed = tryResolveSkillCommand(rawPrompt, { projectPath: p.path });
    const prompt = slashed.handled ? slashed.prompt : rawPrompt;
    const inspectorOn = isInspectorEnabled(config);
    let inspectorTrace = null;
    // Keyword triggers ("option B") — checked after the slash shortcut. On a
    // match the body is already injected, so the inspector/RAG step is skipped
    // for this turn.
    const keyword = slashed.handled
      ? { matched: [] }
      : matchSkillKeywordTriggers(prompt, { projectPath: p.path, config });
    if (slashed.handled) {
      ctx.contextNote = [ctx.contextNote, slashed.contextNote].filter(Boolean).join("\n\n");
    } else if (keyword.matched.length) {
      ctx.contextNote = [ctx.contextNote, keyword.contextNote].filter(Boolean).join("\n\n");
    } else if (inspectorOn) {
      // Inspector middleware: per-turn semantic RAG. Replaces both the passive
      // suggestSkillForPrompt nudge AND the static slug-dump in the system
      // prompt — see runSuperAgent({ skipSkillsHint }).
      const out = await inspectPromptForSkills({
        prompt,
        projectPath: p.path,
        globalConfig: config,
      });
      inspectorTrace = out.trace;
      if (out.contextNote) {
        ctx.contextNote = [ctx.contextNote, out.contextNote].filter(Boolean).join("\n\n");
      }
    } else {
      // Legacy path — passive nudge, still works when inspector is off.
      const hint = await suggestSkillForPrompt(prompt, { projectPath: p.path });
      if (hint) ctx.contextNote = [ctx.contextNote, hint].filter(Boolean).join("\n\n");
    }

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

    // Surface the inspector decision to clients before model_start so the web
    // debug panel / TUI can render "loaded: X" the moment the turn begins.
    if (inspectorTrace) {
      try { onEvent({ type: "skill_inspector", inspector: inspectorTrace }); }
      catch { /* trace is best-effort */ }
      logInspectorDecision(inspectorTrace, { trace_id: req.apxTraceId, channel: ctx.channel });
    }
    // Same idea for keyword triggers: tell the client which skills a keyword
    // match auto-injected this turn.
    if (keyword.matched.length) {
      try { onEvent({ type: "skill_keyword_trigger", matched: keyword.matched }); }
      catch { /* trace is best-effort */ }
      logKeywordTriggerDecision(keyword, { trace_id: req.apxTraceId, channel: ctx.channel });
    }

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
        skipSkillsHint: inspectorOn,
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
        channel: CHANNELS.API,
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
    const { prompt, previousMessages, model, maxIters, maxTokens, completionContract } =
      req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const ctx = resolveSuperAgentContext(req, p);
    const inspectorOn = isInspectorEnabled(config);
    // Keyword triggers first — a match injects the body directly and skips the
    // inspector for this turn (same precedence as the stream endpoint).
    const keyword = matchSkillKeywordTriggers(prompt, { projectPath: p.path, config });
    if (keyword.matched.length) {
      ctx.contextNote = [ctx.contextNote, keyword.contextNote].filter(Boolean).join("\n\n");
      logKeywordTriggerDecision(keyword, { trace_id: req.apxTraceId, channel: ctx.channel });
    } else if (inspectorOn) {
      try {
        const out = await inspectPromptForSkills({ prompt, projectPath: p.path, globalConfig: config });
        if (out.contextNote) {
          ctx.contextNote = [ctx.contextNote, out.contextNote].filter(Boolean).join("\n\n");
        }
        logInspectorDecision(out.trace, { trace_id: req.apxTraceId, channel: ctx.channel });
      } catch { /* inspector failure must not block the turn */ }
    }
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
        onEvent: wrapOnEventForLog(null, {
          trace_id: req.apxTraceId,
          channel: ctx.channel,
        }),
        skipSkillsHint: inspectorOn,
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
