// Code module API — persistent OpenCode-style coding sessions per project.
//
//   GET    /projects/:pid/code/sessions
//   POST   /projects/:pid/code/sessions                 { title?, model?, mode? }
//   GET    /projects/:pid/code/sessions/:sid
//   PATCH  /projects/:pid/code/sessions/:sid            { title?, model?, mode? }
//   DELETE /projects/:pid/code/sessions/:sid
//   POST   /projects/:pid/code/sessions/:sid/chat/stream   { prompt }   NDJSON
//   GET    /projects/:pid/code/sessions/:sid/changes
//
// Unlike the stateless super-agent endpoint, these sessions are server-side
// stateful: the turn handler rebuilds `previousMessages` from the stored
// transcript, runs the super-agent on the `code` channel (with plan/build mode
// + per-mode tool gating), then persists the rich assistant turn.
import { runSuperAgent } from "#core/agent/super-agent.js";
import { appendSuperAgentErrorTrace } from "./shared.js";
import { createWebConfirmAdapter } from "#core/confirmation/adapters/web.js";
import { CHANNELS } from "#core/constants/channels.js";
import { CODE_MODES, DEFAULT_CODE_MODE } from "#core/constants/code-modes.js";
import {
  listCodeSessions,
  getCodeSession,
  createCodeSession,
  updateCodeSession,
  removeCodeSession,
  appendTurn,
} from "#core/stores/code-sessions.js";
import { captureBaseline, diffAgainstBaseline, initGitRepo } from "#core/git-baseline.js";
import { loggerFor } from "#core/logging.js";
import { readAgents } from "#core/apc/parser.js";
import { CODE_PLAN_TOOLS, CODE_BUILD_TOOLS } from "#core/agent/tools/names.js";
import { codeModeGuidance } from "#core/agent/prompts/modes/index.js";

const log = loggerFor("code");

// Mode-specific tool allow-lists and prompt fragments are owned by core/:
//   - tool names + plan/build lists → #core/agent/tools/names.js
//   - per-mode guidance text         → #core/agent/prompts/modes/*.md
// This file just picks the right pair for the request.
function modeGuidanceFor(mode) {
  return codeModeGuidance(mode);
}

// Build the [{role, content}] history the super-agent expects from the stored
// rich transcript: flatten each turn's text parts. Tool parts are normally
// internal, but ask_questions is special — without surfacing it the model
// loses track that it ALREADY asked, sees the user's compiled-answer reply
// as a fresh request, and asks again forever. We render a one-line synthetic
// summary of each ask_questions call so the next turn's context shows
// "I asked X, the user replied Y" naturally.
function summarizeAskQuestionsPart(part) {
  const raw = part?.args?.questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lines = raw
    .map((q) => {
      if (typeof q === "string") return `- ${q}`;
      if (!q || typeof q !== "object" || typeof q.question !== "string") return null;
      const opts = Array.isArray(q.options) ? q.options : [];
      const optStr = opts
        .map((o) => (typeof o === "string" ? o : (o && typeof o.label === "string" ? o.label : "")))
        .filter(Boolean)
        .join(", ");
      return optStr ? `- ${q.question} (opciones: ${optStr})` : `- ${q.question}`;
    })
    .filter(Boolean);
  if (lines.length === 0) return null;
  return `[ask_questions]\n${lines.join("\n")}`;
}

function historyFrom(session) {
  return (session.messages || []).map((m) => {
    const chunks = [];
    for (const p of m.parts || []) {
      if (!p) continue;
      if (p.kind === "text" && p.text) chunks.push(p.text);
      else if (p.kind === "tool" && p.tool === "ask_questions") {
        const summary = summarizeAskQuestionsPart(p);
        if (summary) chunks.push(summary);
      }
    }
    return { role: m.role, content: chunks.join("\n\n").trim() };
  });
}

// Accumulate stream events into the rich ChatPart shape so the persisted
// assistant turn matches exactly what the UI rendered live. Mirrors the
// front-end reducer in hooks/useChat.ts (applyStreamEvent).
function makeTurnAccumulator() {
  const parts = [];
  const notes = [];
  let model = null;
  let usage = null;
  const findTool = (id) => parts.find((p) => p.kind === "tool" && p.id === id);
  return {
    apply(ev) {
      switch (ev?.type) {
        case "model_start":
          if (ev.model) model = ev.model;
          break;
        case "model_routed":
          if (ev.model) model = ev.model;
          if (ev.from_fallback) notes.push(`routing fell back → ${ev.model}`);
          break;
        case "engine_failed":
          notes.push(`engine ${ev.model || "?"} failed → ${ev.retry_with || "retry"}`);
          break;
        case "model_retry":
          notes.push(`retry (${ev.reason || "?"})`);
          break;
        case "tools_suppressed":
          notes.push(`tools suppressed: ${(ev.tools || []).join(", ")}`);
          break;
        case "assistant_text":
          if (ev.text) parts.push({ kind: "text", text: ev.text });
          break;
        case "tool_start":
          if (ev.trace)
            parts.push({
              kind: "tool",
              id: ev.trace.id,
              tool: ev.trace.tool,
              args: ev.trace.args,
              status: "running",
            });
          break;
        case "tool_deduped": {
          const t = ev.trace && findTool(ev.trace.id);
          if (t) t.status = "deduped";
          break;
        }
        case "tool_result": {
          const t = ev.trace && findTool(ev.trace.id);
          if (t) {
            t.result = ev.trace.result;
            const errored =
              ev.trace.result && typeof ev.trace.result === "object" && ev.trace.result.error;
            t.status = errored ? "error" : t.status === "deduped" ? "deduped" : "done";
          }
          break;
        }
        case "final":
          usage = ev.result?.usage ?? usage;
          if (!model) model = ev.result?.name || null;
          break;
        default:
          break;
      }
    },
    build() {
      return { parts, notes, model, usage };
    },
  };
}

export function register(app, { projects, project, config, registries, plugins }) {
  const findProject = (req, res) => project(req, res);

  // ---- List ----------------------------------------------------------------
  app.get("/projects/:pid/code/sessions", (req, res) => {
    const p = findProject(req, res);
    if (!p) return;
    res.json({ sessions: listCodeSessions(p.storagePath) });
  });

  // ---- Create (captures git baseline) --------------------------------------
  app.post("/projects/:pid/code/sessions", (req, res) => {
    const p = findProject(req, res);
    if (!p) return;
    const { title, model, mode, agentSlug } = req.body || {};
    let git = captureBaseline(p.path);
    // No baseline because the project isn't a git repo yet. For real projects
    // (not the default apx home, id 0) init one so the "changes" diff works —
    // a coding surface is expected to be version-controlled. Best-effort.
    if (!git && String(p.id) !== "0") {
      if (initGitRepo(p.path)) {
        git = captureBaseline(p.path);
        log.info(`code: initialized git repo for diff tracking at ${p.path}`, {
          pid: p.id,
        });
      }
    }
    const session = createCodeSession(p.storagePath, {
      projectId: p.id,
      title,
      model,
      mode,
      agentSlug: agentSlug || null,
      git,
    });
    res.status(201).json(session);
  });

  // ---- Get full transcript -------------------------------------------------
  app.get("/projects/:pid/code/sessions/:sid", (req, res) => {
    const p = findProject(req, res);
    if (!p) return;
    const session = getCodeSession(p.storagePath, req.params.sid);
    if (!session) return res.status(404).json({ error: "session not found" });
    res.json(session);
  });

  // ---- Patch (rename / model / mode) ---------------------------------------
  app.patch("/projects/:pid/code/sessions/:sid", (req, res) => {
    const p = findProject(req, res);
    if (!p) return;
    const session = updateCodeSession(p.storagePath, req.params.sid, req.body || {});
    if (!session) return res.status(404).json({ error: "session not found" });
    res.json(session);
  });

  // ---- Delete --------------------------------------------------------------
  app.delete("/projects/:pid/code/sessions/:sid", (req, res) => {
    const p = findProject(req, res);
    if (!p) return;
    const ok = removeCodeSession(p.storagePath, req.params.sid);
    if (!ok) return res.status(404).json({ error: "session not found" });
    res.json({ ok: true });
  });

  // ---- Changes (diff vs baseline) ------------------------------------------
  app.get("/projects/:pid/code/sessions/:sid/changes", (req, res) => {
    const p = findProject(req, res);
    if (!p) return;
    const session = getCodeSession(p.storagePath, req.params.sid);
    if (!session) return res.status(404).json({ error: "session not found" });
    if (!session.git || !session.git.baselineTree) {
      return res.json({ git: false, files: [] });
    }
    try {
      const files = diffAgainstBaseline(p.path, session.git.baselineTree);
      res.json({ git: true, files });
    } catch (e) {
      res.status(500).json({ error: e.message, git: true, files: [] });
    }
  });

  // ---- Streaming turn ------------------------------------------------------
  app.post("/projects/:pid/code/sessions/:sid/chat/stream", async (req, res) => {
    const p = findProject(req, res);
    if (!p) return;
    const session = getCodeSession(p.storagePath, req.params.sid);
    if (!session) return res.status(404).json({ error: "session not found" });
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    const mode = session.mode === CODE_MODES.PLAN ? CODE_MODES.PLAN : DEFAULT_CODE_MODE;
    const previousMessages = historyFrom(session);

    // If a project agent is selected, inject its system prompt as a suffix so
    // the super-agent's tool loop runs with the agent's personality/context.
    let agentSystemSuffix = "";
    if (session.agentSlug) {
      const agents = readAgents(p.path);
      const agent = agents.find((a) => a.slug === session.agentSlug);
      if (agent?.body) agentSystemSuffix = `\n\n## Agente seleccionado: ${session.agentSlug}\n${agent.body}`;
    }

    // Persist the user turn immediately so a crash mid-stream still records it.
    appendTurn(p.storagePath, session.id, {
      role: "user",
      parts: [{ kind: "text", text: prompt }],
      mode,
    });

    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();

    const send = (event) => res.write(JSON.stringify(event) + "\n");
    const acc = makeTurnAccumulator();
    const onEvent = (event) => {
      acc.apply(event);
      send(event);
    };

    try {
      const saResult = await runSuperAgent({
        globalConfig: config,
        projects,
        plugins,
        registries,
        prompt,
        channel: CHANNELS.WEB_CODE,
        channelMeta: {
          projectId: String(p.id),
          projectName: p.name,
          projectPath: p.path,
          mode,
          modeGuidance: modeGuidanceFor(mode),
          agentSlug: session.agentSlug || null,
        },
        previousMessages,
        systemSuffix: agentSystemSuffix,
        overrideModel: session.model || undefined,
        allowedTools: mode === CODE_MODES.PLAN ? CODE_PLAN_TOOLS : CODE_BUILD_TOOLS,
        // Coding tasks are multi-step: give the loop a high safety ceiling so it
        // can chain 20-30+ tools (read → edit → run → verify …) and a real
        // output budget for substantial code / explanations per turn. The
        // completion contract (build mode) is what actually keeps it going until
        // done — maxIters is just the runaway backstop.
        maxIters: 100,
        maxTokens: 8192,
        // Build mode = the model must keep calling tools until it calls `finish`.
        // Plan mode is read-only investigation that ends with a written plan, so
        // it keeps the normal "text ends the turn" behavior.
        completionContract: mode === CODE_MODES.BUILD,
        onEvent,
        requestConfirmation: createWebConfirmAdapter({ onEvent }),
      });
      projects.rebuild(p.id);

      const turn = acc.build();
      // Persist the final text unless it's already the last text part we
      // streamed. Previously this only appended when there was NO text part at
      // all, so a trailing summary that came AFTER a tool call (the model's
      // closing words) was silently dropped from the stored transcript.
      if (
        saResult.text &&
        !turn.parts.some((p2) => p2.kind === "text" && p2.text === saResult.text)
      ) {
        turn.parts.push({ kind: "text", text: saResult.text });
      }
      appendTurn(p.storagePath, session.id, {
        role: "assistant",
        parts: turn.parts,
        notes: turn.notes,
        model: turn.model || saResult.name,
        mode,
        usage: saResult.usage || turn.usage,
      });

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
      log.warn(`code session turn failed: ${e.message}`, {
        trace_id: req.apxTraceId,
        sid: session.id,
      });
      appendSuperAgentErrorTrace(req, e, {
        prompt,
        channel: CHANNELS.WEB_CODE,
        previousMessages,
        model: session.model,
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
}
