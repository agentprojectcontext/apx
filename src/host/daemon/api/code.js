// Code module API — persistent OpenCode-style coding sessions per project.
//
//   GET    /code/sessions                               every project's, tagged with pid
//   GET    /projects/:pid/code/sessions
//   POST   /projects/:pid/code/sessions                 { title?, model?, mode? }
//   GET    /projects/:pid/code/sessions/:sid
//   PATCH  /projects/:pid/code/sessions/:sid            { title?, model?, mode? }
//   DELETE /projects/:pid/code/sessions/:sid
//   POST   /projects/:pid/code/sessions/:sid/chat/stream                    NDJSON
//                        { prompt, channel?, cwd?, confirm? }
//   POST   /projects/:pid/code/sessions/:sid/truncate    { keep_visible }
//   GET    /projects/:pid/code/sessions/:sid/changes
//
// Unlike the stateless super-agent endpoint, these sessions are server-side
// stateful: the turn handler rebuilds `previousMessages` from the stored
// transcript, runs the super-agent on a code channel (with plan/build mode
// + per-mode tool gating), then persists the rich assistant turn.
//
// Both code surfaces come through here: the web panel (`web_code`) and
// `apx exec --code` (`code`). That is the point — a session is where a coding
// turn is READABLE afterwards, so a turn that skips it is a turn nobody can
// find. See resolveCodeChannel().
import { runSuperAgent } from "#core/agent/super-agent.js";
import { appendSuperAgentErrorTrace, asyncRoute } from "./shared.js";
import {
  startActiveTurn,
  appendActiveTurn,
  recordActiveTurnEvent,
  isVisibleTurnEvent,
  endActiveTurn,
  getActiveTurnByKey,
  codeTurnKey,
} from "../active-turns.js";
import { broadcastTurn } from "../events-ws.js";
import { wasAborted, abortedTurnEvent } from "./turn-abort.js";
import { createWebConfirmAdapter } from "#core/confirmation/adapters/web.js";
import { CHANNELS } from "#core/constants/channels.js";
import { CODE_MODES, DEFAULT_CODE_MODE } from "#core/constants/code-modes.js";
import {
  listCodeSessions,
  listCodeSessionsAcross,
  getCodeSession,
  createCodeSession,
  updateCodeSession,
  removeCodeSession,
  appendTurn,
  truncateCodeSession,
  codeSessionHistory,
} from "#core/stores/code-sessions.js";
import { makeTurnAccumulator } from "#core/agent/stream/turn-accumulator.js";
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

// A code session is the persistent thing; `code` and `web_code` are the two
// SURFACES that drive one. The web panel is the default; `apx exec --code`
// passes `channel: "code"` so the turn is prompted as the terminal surface it
// actually came from (and gets the caller's cwd) while still landing in a
// session the panel can open. Anything else falls back to the web channel —
// a client must not be able to name an arbitrary channel here.
const CODE_CHANNELS = new Set([CHANNELS.CODE, CHANNELS.WEB_CODE]);
function resolveCodeChannel(raw) {
  const channel = String(raw || "").toLowerCase();
  return CODE_CHANNELS.has(channel) ? channel : CHANNELS.WEB_CODE;
}

// History flattening + stream-event accumulator now live in core/ — see
// codeSessionHistory() (transcript → engine messages) and makeTurnAccumulator()
// (stream events → persistable ChatParts) imported above.

export function register(api, { projects, project, config, registries, plugins }) {
  const findProject = (req, res) => project(req, res);

  // ---- List across every project ------------------------------------------
  // A code session is addressed by (project, id), so a client that only knows
  // the project it is currently looking at cannot find a session started
  // anywhere else — from the panel a turn run from another cwd simply looked
  // lost. This is the unfiltered list; the per-project route below is the
  // filter, not the default.
  api.get("/code/sessions", (req, res) => {
    const entries = projects
      .list()
      .map((row) => ({
        id: row.id,
        name: row.name,
        storagePath: projects.get(row.id)?.storagePath || null,
      }));
    res.json({ sessions: listCodeSessionsAcross(entries) });
  });

  // ---- List ----------------------------------------------------------------
  api.get("/projects/:pid/code/sessions", (req, res) => {
    const p = findProject(req, res);
    if (!p) return;
    res.json({ sessions: listCodeSessions(p.storagePath) });
  });

  // ---- Create (captures git baseline) --------------------------------------
  api.post("/projects/:pid/code/sessions", (req, res) => {
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
  // `active_turn` is what the transcript alone cannot say: a turn is written to
  // the session only once it ENDS, so a panel opened (or refreshed) while one is
  // running read a finished-looking conversation and drew no activity at all —
  // the work was happening on the daemon with nothing on screen to show it. The
  // daemon's own copy of the turn in flight rides along, and the client paints
  // it and then follows the live frames.
  api.get("/projects/:pid/code/sessions/:sid", (req, res) => {
    const p = findProject(req, res);
    if (!p) return;
    const session = getCodeSession(p.storagePath, req.params.sid);
    if (!session) return res.status(404).json({ error: "session not found" });
    res.json({ ...session, active_turn: getActiveTurnByKey(codeTurnKey(p.id, session.id)) });
  });

  // ---- Patch (rename / model / mode) ---------------------------------------
  api.patch("/projects/:pid/code/sessions/:sid", (req, res) => {
    const p = findProject(req, res);
    if (!p) return;
    const session = updateCodeSession(p.storagePath, req.params.sid, req.body || {});
    if (!session) return res.status(404).json({ error: "session not found" });
    res.json(session);
  });

  // ---- Delete --------------------------------------------------------------
  api.delete("/projects/:pid/code/sessions/:sid", (req, res) => {
    const p = findProject(req, res);
    if (!p) return;
    const ok = removeCodeSession(p.storagePath, req.params.sid);
    if (!ok) return res.status(404).json({ error: "session not found" });
    res.json({ ok: true });
  });

  // ---- Rewind (what Regenerate and Edit & resend stand on) -----------------
  // The pane rewinds to a turn and the transcript has to rewind with it, or the
  // next turn is prompted with the very answer it is replacing. Not while one
  // is running: the turn in flight appends when it ends, and it would append
  // onto a transcript that had moved under it.
  api.post("/projects/:pid/code/sessions/:sid/truncate", (req, res) => {
    const p = findProject(req, res);
    if (!p) return;
    const keepVisible = Number(req.body?.keep_visible);
    if (!Number.isInteger(keepVisible) || keepVisible < 0) {
      return res.status(400).json({ error: "keep_visible must be a non-negative integer" });
    }
    if (getActiveTurnByKey(codeTurnKey(p.id, req.params.sid))) {
      return res.status(409).json({ error: "a turn is running on this session" });
    }
    const session = truncateCodeSession(p.storagePath, req.params.sid, keepVisible);
    if (!session) return res.status(404).json({ error: "session not found" });
    res.json({ ok: true, messages: session.messages.length });
  });

  // ---- Changes (diff vs baseline) ------------------------------------------
  api.get("/projects/:pid/code/sessions/:sid/changes", (req, res) => {
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
  api.post("/projects/:pid/code/sessions/:sid/chat/stream", asyncRoute(async (req, res) => {
    const p = findProject(req, res);
    if (!p) return;
    const session = getCodeSession(p.storagePath, req.params.sid);
    if (!session) return res.status(404).json({ error: "session not found" });
    const { prompt, cwd } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const channel = resolveCodeChannel(req.body?.channel);

    const mode = session.mode === CODE_MODES.PLAN ? CODE_MODES.PLAN : DEFAULT_CODE_MODE;
    const previousMessages = codeSessionHistory(session);

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

    // The socket belongs to whoever started the turn, and the turn deliberately
    // outlives it — closing the stream has never stopped a run, which is what
    // lets a refresh or a second surface catch up. So writing to a socket that
    // has gone away is a normal event, not a failure.
    const send = (event) => {
      try { res.write(JSON.stringify(event) + "\n"); } catch { /* nobody is reading any more */ }
    };
    const acc = makeTurnAccumulator();

    // The run's kill switch plus the registry entry that lets ANY surface find
    // it: the panel's Stop, a message that interrupts, and a tab that arrives
    // mid-turn all reach this record. Keyed by (project, session) because that
    // is the whole identity of a code session — the web panel and
    // `apx exec --code` drive the same one under different channel names.
    const turnAbort = new AbortController();
    const active = startActiveTurn(codeTurnKey(p.id, session.id), {
      project_id: p.id,
      channel,
      thread_id: session.id,
      model: session.model || null,
      abort: () => turnAbort.abort(),
    });
    const turnFrame = (phase, extra = {}) => broadcastTurn({
      phase,
      project_id: p.id,
      agent_slug: session.agentSlug || null,
      conversation_id: null,
      channel,
      thread_id: session.id,
      turn_id: active.id,
      ...extra,
    });

    const onEvent = (event) => {
      acc.apply(event);
      recordActiveTurnEvent(active.id, event);
      // Same work, both ways in: recorded for a surface that re-opens this
      // session mid-turn, pushed for one already following it over the feed.
      if (isVisibleTurnEvent(event)) turnFrame("event", { event });
      // A rotation off the asked-for model is the difference between "the model
      // you chose answered" and "something else did", and on this route it was
      // invisible: the note reached the panel and nothing reached the log, so
      // "I asked for big-pickle and got Gemini" had no recorded why.
      if (event?.type === "engine_failed") {
        log.warn(
          `engine ${event.model || "?"} failed → retrying with ${event.retry_with || "?"}`,
          { trace_id: req.apxTraceId, channel, sid: session.id, reason: event.reason },
        );
      }
      send(event);
    };

    // The turn names itself before it does any work, so it can be stopped from
    // the first token rather than only once it is over.
    turnFrame("start");
    send({ type: "start", turn_id: active.id, channel, code_session_id: session.id });

    /** Persist what the turn produced. Shared by the finished and the
     *  interrupted path: an interrupted turn did real work the user watched
     *  happen, and the message that interrupts it reads this as its history. */
    const persist = (extra = {}) => {
      const turn = acc.build();
      const text = typeof extra.text === "string" ? extra.text : "";
      if (text && !turn.parts.some((p2) => p2.kind === "text" && p2.text === text)) {
        turn.parts.push({ kind: "text", text });
      }
      // A finished turn is recorded even when it said nothing (that empty row
      // is itself the evidence); an interrupted one that never got a word out
      // has nothing to record.
      if (extra.skipEmpty && !turn.parts.length) return turn;
      appendTurn(p.storagePath, session.id, {
        role: "assistant",
        parts: turn.parts,
        notes: turn.notes,
        model: turn.model || extra.name || null,
        mode,
        usage: extra.usage || turn.usage,
      });
      return turn;
    };

    try {
      const saResult = await runSuperAgent({
        globalConfig: config,
        projects,
        plugins,
        registries,
        prompt,
        channel,
        channelMeta: {
          projectId: String(p.id),
          projectName: p.name,
          projectPath: p.path,
          // `code.md` renders {{cwd}}; a missing var renders empty, so the web
          // surface is unaffected by carrying the key.
          cwd: typeof cwd === "string" && cwd ? cwd : p.path,
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
        // What Stop and "send this instead" actually pull. Without a signal the
        // run had no way to end early: the browser's fetch was all that closed,
        // and the loop kept calling tools against a pane nobody was watching.
        signal: turnAbort.signal,
        // Token-by-token text, so a surface that joins mid-turn (or the one
        // that started it, after a refresh) sees the answer being written
        // rather than a still frame. `assistant_text` still closes each segment
        // with the cleaned version, so a client that ignores deltas reads
        // exactly what it read before.
        onToken: (chunk) => {
          send({ type: "assistant_delta", delta: chunk });
          appendActiveTurn(active.id, chunk);
          turnFrame("delta", { delta: chunk });
        },
        // The confirmation round-trip needs a client that can answer it (the
        // panel POSTs to /super-agent/confirm/:id). `apx exec --code` streams
        // only to draw a spinner, so it sends `confirm: false` and falls back
        // to the permission policy — same opt-out the super-agent route has.
        requestConfirmation:
          req.body?.confirm === false ? undefined : createWebConfirmAdapter({ onEvent }),
      });
      projects.rebuild(p.id);

      // Persist the final text unless it's already one of the parts we
      // streamed. This used to only append when there was NO text part at all,
      // so a trailing summary that came AFTER a tool call (the model's closing
      // words) was silently dropped from the stored transcript.
      persist({ text: saResult.text, name: saResult.name, usage: saResult.usage });

      const finalResult = {
        text: saResult.text,
        usage: saResult.usage,
        name: saResult.name,
        trace: saResult.trace,
      };
      turnFrame("final", { result: finalResult });
      send({ type: "final", result: finalResult });
      res.end();
    } catch (e) {
      // Interrupted, not broken. Everything that streamed is work the user
      // watched happen, so it lands in the session the way a finished turn
      // does — the message that interrupted this one opens the next turn and
      // reads this as its history. It ends on `aborted` and deliberately not
      // `error`: a panel that paints errors red must not accuse the daemon
      // every time you press Stop.
      if (wasAborted(e, turnAbort)) {
        const turn = persist({ skipEmpty: true });
        projects.rebuild(p.id);
        const ev = abortedTurnEvent({
          text: (active.text || "").trim(),
          trace: turn.parts.filter((part) => part.kind === "tool"),
        });
        turnFrame("aborted", { result: ev.result });
        send(ev);
        res.end();
        return;
      }
      log.warn(`code session turn failed: ${e.message}`, {
        trace_id: req.apxTraceId,
        sid: session.id,
      });
      appendSuperAgentErrorTrace(req, e, {
        prompt,
        channel,
        previousMessages,
        model: session.model,
        stream: true,
      });
      turnFrame("error", { error: e.message });
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
}
