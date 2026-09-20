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
import { asyncRoute, readThreadMessages } from "./shared.js";

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
    res.json(timelineFromTurns(thread.messages || [], declared));
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
