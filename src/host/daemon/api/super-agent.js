// "super-agent" here is the *default APX agent* — the tool-using loop that
// runs when no project agent is named (Telegram, overlay, TUI without
// --agent). It is NOT a persona with that name; it is the system-level
// dispatcher described in core/agent/run-agent.js.
//
//   POST /projects/:pid/super-agent/chat/stream    NDJSON event stream
//   POST /projects/:pid/super-agent/chat            blocking JSON response
import { runSuperAgent } from "#core/agent/super-agent.js";
import { resolveSuperAgentContext,
  appendSuperAgentErrorTrace, asyncRoute } from "./shared.js";
import { loggerFor } from "#core/logging.js";
import { appendGlobalMessage } from "#core/stores/messages.js";
import { summarizeToolTrace } from "#core/agent/tool-summary.js";
import { SUPERAGENT_ACTOR_ID } from "#core/identity/index.js";
import { createWebConfirmAdapter } from "#core/confirmation/adapters/web.js";
import { tryResolveSkillCommand } from "#core/agent/skills/trigger.js";
import { suggestSkillForPrompt } from "#core/agent/skills/rag.js";
import { inspectPromptForSkills, isInspectorEnabled, summarizeTrace } from "#core/agent/skills/inspector.js";
import { CHANNELS } from "#core/constants/channels.js";
import { readTurnAttachments } from "./media.js";
import { startActiveTurn, appendActiveTurn, endActiveTurn, superAgentTurnKey } from "../active-turns.js";
import { wasAborted, abortedTurnEvent } from "./turn-abort.js";

const log = loggerFor("super-agent");

// How long a streamed turn may go silent before it writes a keepalive byte.
// Comfortably under undici's 300s body timeout and the usual proxy idle limits.
const KEEPALIVE_MS = 20_000;

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

// What of the inspector trace is worth keeping on disk: the decision, not the
// payload. `null` only when the inspector had nothing to say at all — no skill
// injected AND no candidate scored. When it scored candidates but none crossed
// the load/hint bar we STILL keep the row: a reopened thread should be able to
// show what was suggested each round (the "considered" near-misses), which is
// what makes the per-turn RAG legible instead of silently doing nothing.
export function inspectorRecord(trace) {
  if (!trace?.enabled) return null;
  const loaded = trace.loaded || [];
  const hinted = trace.hinted || [];
  const scored = trace.scored || [];
  if (loaded.length === 0 && hinted.length === 0 && scored.length === 0) return null;
  return {
    ...(trace.embedder ? { embedder: trace.embedder } : {}),
    ...(loaded.length ? { loaded } : {}),
    ...(hinted.length ? { hinted } : {}),
    // Already capped at the top 5 upstream — the similarities the badge shows,
    // and the source of the dim "considered" badges when nothing was injected.
    ...(scored.length ? { scored } : {}),
  };
}

// Persist human web turns to the cross-channel message store so they feed the
// RAG index, search_messages, and the "active threads" awareness block.
//
// This used to keep only web + web_sidebar, on the reasoning that everything
// else was "automation". That was wrong once real people started arriving over
// those channels: a WhatsApp contact writing to the bridge, or an agent relay,
// produced a turn that was answered and then vanished — no thread, no history,
// nothing in the inbox, and no way to tell a working bridge from a dead one.
//
// So the rule inverts: a conversation is written unless it is machine chatter.
// A routine's output already travels its own delivery path and lands in the
// agent's chat; writing it here too would double it and bury the inbox.
//
// Consequence worth naming: message text from third parties (WhatsApp) now
// enters the ledger, which is what feeds RAG and the awareness block. That is
// the price of the conversation being visible at all, and the owner chose it.
// Best-effort: a logging failure never breaks the reply.
const LEDGER_SKIP_CHANNELS = new Set([CHANNELS.ROUTINE]);

/** Which project the chat was opened from. The ledger is one file per
 *  channel+day for the whole daemon, so without this stamp a chat started
 *  inside a project could only be found in the Base workspace — from the
 *  project it was started in, it looked gone. */
const ledgerScope = (project) =>
  project ? { project_id: String(project.id), project_name: project.name } : {};

/**
 * The INBOUND half, written the moment the request arrives.
 *
 * It used to be written with the reply, when the turn was over. A WhatsApp
 * round drives a phone for three minutes, and for those three minutes nothing
 * anywhere showed that a message had arrived at all — the panel open on that
 * thread stayed blank until the whole turn landed, and a turn that crashed took
 * the record of the message with it. What arrived is a fact as soon as it
 * arrives; what the agent answers is a separate one.
 *
 * Best-effort: a logging failure never breaks the turn.
 */
function logInboundTurn(channel, { prompt, project, media }) {
  if (!channel || LEDGER_SKIP_CHANNELS.has(channel)) return;
  try {
    appendGlobalMessage({
      channel, direction: "in", type: "user", author: "user", body: prompt,
      // `media` records the file the turn was sent with (local_path, name, mime
      // — see readTurnAttachments), which is what lets a reopened thread render
      // the photo instead of the marker text the agent was handed.
      meta: { ...ledgerScope(project), ...(media || {}) },
    });
  } catch { /* the ledger is a record, not a dependency */ }
}

function logWebTurn(channel, { replyText, name, model, usage, trace, project, inspector, reasoning }) {
  if (!channel || LEDGER_SKIP_CHANNELS.has(channel)) return;
  const scope = ledgerScope(project);
  try {
    // The steps, one row each — the same shape the Telegram path writes, which
    // is what lets a reopened thread render its tool calls instead of a bare
    // answer with the work erased. Results are already truncated upstream
    // (run-agent's summarizeForTrace), so a row stays small.
    for (const item of Array.isArray(trace) ? trace : []) {
      if (!item?.tool) continue;
      appendGlobalMessage({
        channel,
        direction: "out",
        type: "tool",
        actor_id: item.tool,
        actor_kind: "tool",
        author: name || undefined,
        body: `${item.tool}(${JSON.stringify(item.args || {}).slice(0, 200)})`,
        meta: { ...scope, tool: item.tool, args: item.args, result: item.result },
      });
    }
    if (replyText) {
      // Attribution rides along on the record: which model answered and what the
      // turn cost. Without it a reloaded thread renders "0 tok" and no model.
      const toolSummary = summarizeToolTrace(trace);
      // The skill inspector's decision, recorded next to the tool summary and
      // for the same reason: it rides a live stream event, so a reopened thread
      // had no way to show which skills paid for this turn's prompt. Only the
      // decision is kept (slugs + similarities), never the injected bodies.
      const skillInspector = inspectorRecord(inspector);
      appendGlobalMessage({
        channel,
        direction: "out",
        type: "agent",
        actor_id: SUPERAGENT_ACTOR_ID,
        actor_kind: "superagent",
        agent_slug: SUPERAGENT_ACTOR_ID,
        author: name || undefined,
        body: replyText,
        meta: {
          ...scope,
          ...(model ? { model } : {}),
          ...(usage ? { usage } : {}),
          ...(toolSummary ? { tool_summary: toolSummary } : {}),
          ...(skillInspector ? { skill_inspector: skillInspector } : {}),
          // Stored in meta, not as its own row: rows are what the agent reads
          // back as history (getRecentChannelTurnsFromFs) and what search and
          // the RAG index walk. The thinking is for whoever reopens the thread,
          // never an input the model gets fed its own notes from.
          ...(reasoning?.length ? { reasoning } : {}),
        },
      });
    }
  } catch {
    /* best-effort */
  }
}

// A turn's thinking goes on the record, but the ledger is a day-file the whole
// daemon shares: an agent that loops twenty times must not write a novel into
// it. One segment per model pass, both ends bounded.
const REASONING_SEGMENT_CAP = 4000;
const REASONING_MAX_SEGMENTS = 10;

// Wrap an onEvent emitter so that operationally interesting events also land
// in the unified daemon log. We don't log every "model_start" — too noisy —
// just the ones a user would want to see in `apx log -f` after a turn fails
// or rotates models.
function wrapOnEventForLog(send, { trace_id, channel, reasoning }) {
  return (event) => {
    // The thinking, kept for the record. It rides its own event and never the
    // answer text, so this is the only place it can be picked up before it is
    // gone — same problem the tool trace has, same fix.
    if (event?.type === "assistant_reasoning" && Array.isArray(reasoning)) {
      const piece = String(event.reasoning || "").trim();
      if (piece && reasoning.length < REASONING_MAX_SEGMENTS) {
        reasoning.push(
          piece.length > REASONING_SEGMENT_CAP
            ? piece.slice(0, REASONING_SEGMENT_CAP) + "…"
            : piece,
        );
      }
    }
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

export function register(api, { projects, registries, plugins, project, config }) {
  api.post("/projects/:pid/super-agent/chat/stream", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    // Optional coding-surface knobs: the terminal Code TUI (apx code, Build
    // mode) sends these so it runs to completion exactly like the web Code
    // module. Plain chat callers omit them and keep the lightweight defaults.
    const { prompt: rawPrompt, previousMessages, model, maxIters, maxTokens, completionContract } =
      req.body || {};
    // Files the composer uploaded to ~/.apx/media and named on this turn. A
    // photo with no caption IS a turn: the marker built below stands in for the
    // text, exactly as it does when the same photo arrives over Telegram.
    const turnFiles = readTurnAttachments(req.body?.attachments);
    if (!rawPrompt && !turnFiles.markers.length) {
      return res.status(400).json({ error: "prompt required" });
    }
    const ctx = resolveSuperAgentContext(req, p);

    // `/slug ...` shortcut: load the matching skill body into contextNote and
    // strip the prefix from the user prompt. Falls through unchanged when the
    // slug is unknown.
    const slashed = tryResolveSkillCommand(rawPrompt || "", { projectPath: p.path });
    const prompt = slashed.handled ? slashed.prompt : rawPrompt || "";
    const inspectorOn = isInspectorEnabled(config);
    let inspectorTrace = null;
    if (slashed.handled) {
      ctx.contextNote = [ctx.contextNote, slashed.contextNote].filter(Boolean).join("\n\n");
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
      // Inspector off — fall back to the passive nudge.
      const hint = await suggestSkillForPrompt(prompt, { projectPath: p.path });
      if (hint) ctx.contextNote = [ctx.contextNote, hint].filter(Boolean).join("\n\n");
    }

    // What the model reads, and what the ledger stores: the attachment markers
    // first, then whatever was typed. The markers are built on this side so the
    // path they name is one the daemon resolved, not one a client claimed.
    const turnPrompt = [...turnFiles.markers, prompt].filter(Boolean).join(" ");

    // Before a single token: the message exists now, and the panel (and the
    // inbox, and the live feed) should say so while the turn is still working.
    logInboundTurn(ctx.channel, { prompt: turnPrompt, project: p, media: turnFiles.media });

    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();

    const send = (event) => {
      lastWriteAt = Date.now();
      res.write(JSON.stringify(event) + "\n");
    };

    // Keepalive. A turn only writes when something happens, and one tool can own
    // the turn for minutes on end — run_routine blocks until the routine ends,
    // by design. To an HTTP client that is an idle response body, and undici
    // (the CLI, the TUI) drops it at its body timeout with UND_ERR_BODY_TIMEOUT;
    // proxies in front of the daemon do the same. A bare newline is a valid
    // no-op in NDJSON — every reader here skips blank lines — so it holds the
    // connection open without inventing an event type clients must know about.
    let lastWriteAt = Date.now();
    const keepalive = setInterval(() => {
      if (Date.now() - lastWriteAt < KEEPALIVE_MS) return;
      lastWriteAt = Date.now();
      try { res.write("\n"); } catch { /* the socket is gone; the finally clears us */ }
    }, KEEPALIVE_MS);
    keepalive.unref?.();
    res.on("close", () => clearInterval(keepalive));

    const reasoning = [];
    // The run's kill switch, plus the registry entry that lets any surface find
    // it. Roby's web chat has no conversation id — its thread IS the channel —
    // so one live turn per project+channel, exactly as Telegram keys one live
    // turn per chat_id. POST .../turns/abort reaches `abort` through this.
    const turnAbort = new AbortController();
    const turnKey = superAgentTurnKey(p.id, ctx.channel);
    const active = startActiveTurn(turnKey, {
      project_id: p.id, channel: ctx.channel, model: model || null,
      abort: () => turnAbort.abort(),
    });
    // The steps as they happen. runSuperAgent throws on abort and its trace goes
    // with it, so an interrupted turn would otherwise land in the ledger as
    // prose with the work erased — and the turn that continues it would not know
    // which tools had already run for real.
    const partialTrace = [];
    const logged = wrapOnEventForLog(send, {
      trace_id: req.apxTraceId,
      channel: ctx.channel,
      reasoning,
    });
    const onEvent = (ev) => {
      if (ev?.type === "tool_result" && ev.trace) partialTrace.push(ev.trace);
      return logged(ev);
    };

    // The turn's identity, up front, so a client can stop it (POST
    // .../turns/abort takes the channel for Roby — its thread IS the channel).
    send({ type: "start", turn_id: active.id, channel: ctx.channel });

    // Surface the inspector decision to clients before model_start so the web
    // debug panel / TUI can render "loaded: X" the moment the turn begins.
    if (inspectorTrace) {
      try { onEvent({ type: "skill_inspector", inspector: inspectorTrace }); }
      catch { /* trace is best-effort */ }
      logInspectorDecision(inspectorTrace, { trace_id: req.apxTraceId, channel: ctx.channel });
    }

    // Web/TUI channels receive a "confirmation_required" SSE event and respond
    // via POST /super-agent/confirm/:correlationId (see api/confirm.js).
    // Non-interactive callers (e.g. `apx exec`, which streams only to render a
    // progress indicator) send `confirm: false` to opt out: they have no way to
    // answer the round-trip, so they fall back to the default permission policy —
    // exactly matching the blocking POST /super-agent/chat endpoint's semantics.
    const requestConfirmation =
      req.body?.confirm === false ? undefined : createWebConfirmAdapter({ onEvent });

    try {
      const saResult = await runSuperAgent({
        globalConfig: config,
        projects,
        plugins,
        registries,
        prompt: turnPrompt,
        // Images ride on this turn's user message; every other kind is already
        // named, with its path, in the marker.
        attachments: turnFiles.attachments,
        channel: ctx.channel,
        channelMeta: ctx.channelMeta,
        contextNote: ctx.contextNote,
        previousMessages: previousMessages || [],
        overrideModel: model,
        ...(Number.isFinite(Number(maxIters)) ? { maxIters: Number(maxIters) } : {}),
        ...(Number.isFinite(Number(maxTokens)) ? { maxTokens: Number(maxTokens) } : {}),
        ...(completionContract ? { completionContract: true } : {}),
        onEvent,
        signal: turnAbort.signal,
        // Token-by-token text. `assistant_text` still closes each segment with
        // the cleaned version, so a client that ignores deltas (apx exec) reads
        // exactly what it read before — it just reads it later.
        onToken: (chunk) => { send({ type: "assistant_delta", delta: chunk }); appendActiveTurn(active.id, chunk); },
        // The thinking, live and on its own channel. Clients that don't render
        // it drop it; the answer never carries a word of it either way.
        onReasoningToken: (chunk) => send({ type: "assistant_reasoning_delta", reasoning: chunk }),
        requestConfirmation,
        skipSkillsHint: inspectorOn,
      });
      projects.rebuild(p.id);
      logWebTurn(ctx.channel, {
        replyText: saResult.text,
        name: saResult.name,
        model: saResult.model,
        usage: saResult.usage,
        trace: saResult.trace,
        project: p,
        inspector: inspectorTrace,
        reasoning,
      });
      send({
        type: "final",
        result: {
          text: saResult.text,
          usage: saResult.usage,
          // `name` is the agent persona; `model` is the engine that answered
          // (it can differ from the configured one after a routing fallback).
          name: saResult.name,
          model: saResult.model,
          trace: saResult.trace,
        },
      });
      clearInterval(keepalive);
      res.end();
    } catch (e) {
      // Interrupted, not broken. Whatever streamed is real work the user saw, so
      // it goes into the ledger the same way a finished turn does — the message
      // that interrupted this one opens the next turn and reads this as its
      // history. Same contract Telegram has: "whatever streamed so far is
      // already sent + logged; the newer message's run continues the thread."
      if (wasAborted(e, turnAbort)) {
        const partial = (active.text || "").trim();
        if (partial || partialTrace.length) {
          logWebTurn(ctx.channel, {
            replyText: partial,
            model: model || null,
            trace: partialTrace,
            project: p,
            inspector: inspectorTrace,
            reasoning,
          });
        }
        clearInterval(keepalive);
        send(abortedTurnEvent({ text: partial, trace: partialTrace }));
        res.end();
        return;
      }
      clearInterval(keepalive);
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
    } finally {
      endActiveTurn(active.id);
    }
  }));

  // Project-agnostic one-shot summarize endpoint. Used by `apx session resume
  // <id>` when the session lives outside any registered APX project (e.g. a
  // raw Claude/Codex session). Returns { text } so callers can format the
  // summary however they want.
  api.post("/super-agent/summarize", asyncRoute(async (req, res) => {
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
  }));

  api.post("/projects/:pid/super-agent/chat", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { prompt, previousMessages, model, maxIters, maxTokens, completionContract } =
      req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const ctx = resolveSuperAgentContext(req, p);
    const inspectorOn = isInspectorEnabled(config);
    let inspectorTrace = null;
    const reasoning = [];
    if (inspectorOn) {
      try {
        const out = await inspectPromptForSkills({ prompt, projectPath: p.path, globalConfig: config });
        inspectorTrace = out.trace;
        if (out.contextNote) {
          ctx.contextNote = [ctx.contextNote, out.contextNote].filter(Boolean).join("\n\n");
        }
        logInspectorDecision(out.trace, { trace_id: req.apxTraceId, channel: ctx.channel });
      } catch { /* inspector failure must not block the turn */ }
    }
    // The message is on the record before the turn starts. This is the endpoint
    // the phone bridge posts to, and its turns are the long ones.
    logInboundTurn(ctx.channel, { prompt, project: p });
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
          reasoning,
        }),
        skipSkillsHint: inspectorOn,
      });
      projects.rebuild(p.id);
      logWebTurn(ctx.channel, {
        replyText: saResult.text,
        name: saResult.name,
        model: saResult.model,
        usage: saResult.usage,
        trace: saResult.trace,
        project: p,
        inspector: inspectorTrace,
        reasoning,
      });
      res.json({
        text: saResult.text,
        usage: saResult.usage,
        name: saResult.name,
        model: saResult.model,
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
  }));
}
