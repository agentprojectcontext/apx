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
import { runSuperAgent } from "../super-agent.js";
import { appendSuperAgentErrorTrace } from "./shared.js";
import { createWebConfirmAdapter } from "../../../core/confirmation/adapters/web.js";
import {
  listCodeSessions,
  getCodeSession,
  createCodeSession,
  updateCodeSession,
  removeCodeSession,
  appendTurn,
} from "../../../core/code-sessions-store.js";
import { captureBaseline, diffAgainstBaseline, initGitRepo } from "../../../core/git-baseline.js";
import { loggerFor } from "../../../core/logging.js";

const log = loggerFor("code");

// Read-only tool allowlist for PLAN mode: the agent can explore the repo but
// not mutate it (no write/edit/shell/delegation/side-effects). Build mode gets
// the unrestricted set ("*"). Names must match super-agent-tools/index.js.
const PLAN_TOOLS = [
  "read_file",
  "list_files",
  "search_files",
  "grep",
  "glob",
  "list_projects",
  "list_agents",
  "list_mcps",
  "read_agent_memory",
  "read_self_memory",
  "search_sessions",
  "search_messages",
  "tail_messages",
  "list_skills",
  "load_skill",
  "list_tasks",
  "ask_questions",
  "fetch",
  "search",
];

function modeGuidanceFor(mode) {
  if (mode === "plan") {
    return [
      "MODE: plan. Investigate the codebase (read/list/search/grep) and propose",
      "an approach with the EXACT changes you would make (files + diffs/snippets).",
      "Do NOT write or edit files and do NOT run mutating shell commands — your",
      "editing tools are disabled in this mode. End with a concise, ordered plan.",
    ].join(" ");
  }
  return [
    "MODE: build. Make the changes directly using your file and shell tools",
    "(read_file, write_file, edit_file, run_shell, …). Do not ask for",
    "confirmation and do not stop after one step — keep calling tools until the",
    "entire task is done, then briefly summarize what you changed and why.",
    "Prefer surgical edits over rewrites.",
    "When the user asks for a reusable script, snippet, or 'artifact' (something",
    "they want to keep and run later), put it under `artifacts/<name>` inside",
    "the project — it then shows up in the Artifacts tab. Don't drop reusable",
    "scripts at the project root.",
    "If a parameter you need is missing (API key, app id, target URL, …), call",
    "`ask_questions` ONCE with all your questions and stop — control returns",
    "to the user. Do not call ask_questions again in the same turn; you'll just",
    "get the same blank state back. Each question can be a string (free-text",
    "answer) OR an object {question, options:[{label, description}], multiSelect}",
    "for choices. Prefer 2–4 mutually-exclusive options when a question has a",
    "natural shortlist (yes/no, which-of-these, …); leave options empty for",
    "open-ended answers (API keys, names, free-form ideas).",
  ].join(" ");
}

// Build the [{role, content}] history the super-agent expects from the stored
// rich transcript: flatten each turn's text parts (tool parts are internal).
function historyFrom(session) {
  return (session.messages || []).map((m) => ({
    role: m.role,
    content: (m.parts || [])
      .filter((p) => p && p.kind === "text" && p.text)
      .map((p) => p.text)
      .join("\n\n")
      .trim(),
  }));
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
    const { title, model, mode } = req.body || {};
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

    const mode = session.mode === "plan" ? "plan" : "build";
    const previousMessages = historyFrom(session);

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
        channel: "code",
        channelMeta: {
          projectId: String(p.id),
          projectName: p.name,
          projectPath: p.path,
          mode,
          modeGuidance: modeGuidanceFor(mode),
        },
        previousMessages,
        overrideModel: session.model || undefined,
        allowedTools: mode === "plan" ? PLAN_TOOLS : "*",
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
        completionContract: mode === "build",
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
        channel: "code",
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
