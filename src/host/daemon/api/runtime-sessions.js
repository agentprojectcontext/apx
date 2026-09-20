// Sessions an external runtime ran — Claude Code, Codex, Aider — as something
// you can look at, and write back into.
//
//   GET  /runtime-sessions                              every project, newest first
//   GET  /projects/:pid/runtime-sessions                one project's
//   GET  /projects/:pid/runtime-sessions/:id            one session, with its notes
//   POST /projects/:pid/runtime-sessions/:id/continue   { prompt } — say more to it
//
// WHY THIS EXISTS. `call_runtime` has always written a record per run
// (core/stores/runtime-sessions.js) and nothing ever read it back except the
// resume path. So on 2026-09-20 nine Claude Code sessions ran, six of them died
// at a deadline, and the only account of any of it was whatever the agent that
// launched them chose to say — which, that afternoon, was that work was running
// when it was not. Manu, the same day: "así puedo ver qué hacen, qué hablan y
// qué sesiones vas lanzando".
//
// CONTINUING ONE GOES STRAIGHT TO THE RUNTIME. The same ask names the part that
// matters: "si yo escribo ahí le llegará a Claude y vos no hacés nada". So this
// route calls the runtime itself — no super-agent turn in between, nothing
// rewritten in somebody else's voice. It runs through the `call_runtime`
// handler rather than around it, because everything that makes a launch safe
// and visible lives there: the permission gate, the session record, the cwd,
// the background deadline, and the rows the session writes into the thread.
import {
  listRuntimeSessions,
  readRuntimeSession,
} from "#core/stores/runtime-sessions.js";
import { readProjectRuntimeRoom, listProjectRuntimeRooms } from "#core/stores/runtime-room.js";
import { makeToolHandlers } from "#core/agent/tools/registry.js";
import { RUNTIME_IDS } from "#core/runtimes/index.js";
import { asyncRoute, pageEnvelope } from "./shared.js";

/** A list is a list: the notes a runtime left in its file are the detail's. */
function row(session, entry) {
  const { path: _path, body: _body, ...rest } = session;
  return {
    ...rest,
    project_id: entry.id,
    project_name: entry.name || entry.path,
  };
}

export function register(api, { projects, project, plugins, config }) {
  api.get("/runtime-sessions", (req, res) => {
    const limit = Number(req.query.limit) || 100;
    const rows = [];
    for (const entry of projects.list()) {
      const p = projects.get(entry.id);
      if (!p?.storagePath) continue;
      try {
        for (const s of listRuntimeSessions(p.storagePath, { limit })) rows.push(row(s, entry));
      } catch {
        // A project whose storage moved must not blank out the list — the same
        // rule the inbox and the agent directory carry.
        continue;
      }
    }
    rows.sort((a, b) => b.mtime - a.mtime);
    res.json(pageEnvelope(rows.slice(0, limit), req.query));
  });

  api.get("/projects/:pid/runtime-sessions", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const limit = Number(req.query.limit) || 100;
    const entry = { id: p.id, name: p.name, path: p.path };
    res.json(pageEnvelope(listRuntimeSessions(p.storagePath, { limit }).map((s) => row(s, entry)), req.query));
  });

  api.get("/projects/:pid/runtime-sessions/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const session = readRuntimeSession(p.storagePath, req.params.id);
    if (!session) return res.status(404).json({ error: "runtime session not found" });
    const { path: _path, ...rest } = session;
    res.json({ ...rest, project_id: p.id, project_name: p.name });
  });

  // The session as a CONVERSATION — the shape the chat viewer reads.
  //
  // Next to the detail route above rather than replacing it: that one answers
  // "what is this session" (engine, cwd, exit code, the notes it left), this
  // one answers "what was said in it", and the panel wants both on the same
  // screen. Shaped like a group thread, because it is one: `messages` already
  // carries the three voices (see core/stores/runtime-room.js).
  api.get("/projects/:pid/runtime-rooms/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const room = readProjectRuntimeRoom(p.storagePath, req.params.id);
    if (!room) return res.status(404).json({ error: "runtime room not found" });
    res.json({ ...room, project_id: p.id, project_name: p.name });
  });

  api.get("/projects/:pid/runtime-rooms", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(pageEnvelope(listProjectRuntimeRooms(p.storagePath), req.query));
  });

  api.post("/projects/:pid/runtime-sessions/:id/continue", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    const session = readRuntimeSession(p.storagePath, req.params.id);
    if (!session) return res.status(404).json({ error: "runtime session not found" });
    // A runtime this daemon does not know how to spawn cannot be continued, and
    // guessing one would start a DIFFERENT engine under the old session's name.
    if (!RUNTIME_IDS.includes(session.runtime)) {
      return res.status(400).json({ error: `session has no runnable runtime (${session.runtime || "unknown"})` });
    }

    // `channel: "runtime"` keeps the answer IN THE ROOM.
    //
    // It used to be "web", which made the run narrate itself into the panel's
    // day thread — the right answer when a session had nowhere else to land.
    // It has somewhere now: the room this prompt was typed into, which already
    // holds both sides of the conversation. A launch notice filed beside them
    // would be the thread announcing itself. `runtime` is a room channel, so
    // runtimeThreadCanCarry() declines it and only the room rows are written.
    //
    // Telegram still gets its narration: that is a different surface, and a
    // person who asked from their phone is not looking at this panel.
    const handlers = makeToolHandlers({
      projects,
      plugins,
      registries: null,
      globalConfig: config,
      channel: req.body?.channel === "telegram" ? "telegram" : "runtime",
      // THE OWNER TYPED THIS. The room records who wrote each prompt, and the
      // engine cannot tell — `claude -p` reads one user either way. It rides in
      // the handler context and not in the tool's arguments on purpose: a model
      // must never be able to sign the owner's name to its own message.
      promptAuthor: "owner",
    });

    const out = await handlers.call_runtime({
      project: String(p.id),
      runtime: session.runtime,
      prompt,
      // Resumed by the APX session id: `findEngineSessionById` reads this very
      // file for the title and last prompt, so the runtime opens knowing what
      // it was doing.
      resume_session_id: session.id,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      background: true,
      // The owner typed this into a session THEY opened; a second confirmation
      // for the same action they just took is a dialog about their own click.
      confirmed: true,
    });

    if (out?.error) return res.status(502).json(out);
    res.status(202).json(out);
  }));
}
