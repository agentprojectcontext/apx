// Milestones — the steps a piece of work went through, so a long chat can be
// followed without reading it. Backed by core/milestones/ (the merge of the
// declared store and the spine derived from the turns).
//
//   GET    /projects/:pid/milestones                       the cross-chat timeline
//                                                          ?since=ISO&until=ISO&limit=N
//   GET    /projects/:pid/agents/:slug/conversations/:id/milestones
//                                                          one project agent's chat
//   GET    /projects/:pid/super-agent/threads/:channel/:id/milestones
//                                                          one ledger thread (the
//                                                          super-agent's own chats,
//                                                          a2a, group rooms)
//   POST   /projects/:pid/milestones                       { title, state?, track?, … }
//   POST   /projects/:pid/milestones/:id/close             { state, note? }
//   PATCH  /projects/:pid/milestones/:id                   { patch: {...} }
//
// The two GETs are not the same query with a filter on it, and that is the
// point of having both. A chat's timeline is DERIVED — it reads that
// conversation file and knows about requests nobody ever declared a milestone
// for. The cross-chat one is built from the ledger, one file per day, so asking
// "what happened this week" opens seven files instead of every conversation the
// project has ever had.
import {
  conversationTimeline,
  projectTimeline,
  timelineFromTurns,
  sinceDaysAgo,
} from "#core/milestones/index.js";
import {
  startMilestone,
  closeMilestone,
  updateMilestone,
  getMilestone,
  listMilestones,
} from "#core/stores/milestones.js";
import {
  getActiveTurnByKey,
  convTurnKey,
  threadTurnKey,
  superAgentTurnKey,
  listActiveTurns,
} from "../active-turns.js";
import { asyncRoute, readThreadMessages } from "./shared.js";

// A TURN IN FLIGHT IS NOT AN ABANDONED ONE, and the transcript cannot tell them
// apart: the request is written to the conversation before the model is called,
// so the chat you are looking at RIGHT NOW ends in a user turn with nothing
// after it — the same three bytes a daemon that died mid-turn leaves behind.
// Rendered from the file alone, the panel announced "never answered" over the
// request it was busy answering.
//
// The register of live turns is the only place that knows, and it is this
// process's memory: not a store, not reachable from core. So it is read here
// and the fact is handed down.
// ONE ROUTE, TWO KEYS. A group room and an a2a thread are addressed by
// `threadTurnKey`, but the super-agent's own chat is not: it has no
// conversation id, so its live turn is keyed per project+channel
// (`superAgentTurnKey`) and carries the day as `thread_id`. Checking only the
// first shape meant Roby's chat — the one most likely to be open while a turn
// runs — was the one place this never reported.
//
// The day still has to match. A live turn keyed on the channel says nothing
// about YESTERDAY's thread, and marking that one running would be a new lie in
// place of the old one.
function threadIsRunning(projectId, channel, id) {
  if (getActiveTurnByKey(threadTurnKey(projectId, channel, id))) return true;
  const sa = getActiveTurnByKey(superAgentTurnKey(projectId, channel));
  return !!sa && sa.thread_id === id;
}

function runningConversationIds(projectId) {
  const ids = new Set();
  for (const turn of listActiveTurns({ projectId })) {
    if (turn.conversation_id) ids.add(turn.conversation_id);
    if (turn.thread_id) ids.add(turn.thread_id);
  }
  return ids;
}

export function register(api, { project }) {
  api.get("/projects/:pid/milestones", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const limit = Number(req.query.limit);
    res.json(
      await projectTimeline({
        storagePath: p.storagePath,
        since: req.query.since || sinceDaysAgo(),
        until: req.query.until || null,
        limit: Number.isFinite(limit) && limit > 0 ? limit : 200,
        runningIds: runningConversationIds(p.id),
      })
    );
  }));

  api.get(
    "/projects/:pid/agents/:slug/conversations/:id/milestones",
    asyncRoute(async (req, res) => {
      const p = project(req, res);
      if (!p) return;
      res.json(
        await conversationTimeline({
          storagePath: p.storagePath,
          agentSlug: req.params.slug,
          conversationId: req.params.id,
          running: !!getActiveTurnByKey(convTurnKey(p.id, req.params.id)),
        })
      );
    })
  );

  // The super-agent's own chats, and group rooms, are not conversation files —
  // they are ledger threads, in one of three stores. Same timeline, same
  // reading; only where the turns come from differs, which is why the store
  // decision is `readThreadMessages` in shared.js and not repeated here.
  api.get("/projects/:pid/super-agent/threads/:channel/:id/milestones", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const thread = readThreadMessages({
      storagePath: p.storagePath,
      projectId: p.id,
      channel: req.params.channel,
      id: req.params.id,
    });
    if (!thread) return res.status(404).json({ error: "thread not found" });
    const declared = listMilestones(p.storagePath, {
      channel: req.params.channel,
      thread_id: req.params.id,
    });
    res.json(
      timelineFromTurns(thread.messages || [], declared, {
        running: threadIsRunning(p.id, req.params.channel, req.params.id),
      })
    );
  });

  api.post("/projects/:pid/milestones", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      res.status(201).json(startMilestone(p.storagePath, req.body || {}));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.post("/projects/:pid/milestones/:id/close", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { state, note } = req.body || {};
    try {
      const row = closeMilestone(p.storagePath, req.params.id, state || "done", note || null);
      if (!row) return res.status(404).json({ error: "milestone not found" });
      res.json(row);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.patch("/projects/:pid/milestones/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { patch } = req.body || {};
    if (!patch || typeof patch !== "object") {
      return res.status(400).json({ error: "patch object required" });
    }
    const row = updateMilestone(p.storagePath, req.params.id, patch);
    if (!row) return res.status(404).json({ error: "milestone not found" });
    res.json(row);
  });

  api.get("/projects/:pid/milestones/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const row = getMilestone(p.storagePath, req.params.id);
    if (!row) return res.status(404).json({ error: "milestone not found" });
    res.json(row);
  });
}
