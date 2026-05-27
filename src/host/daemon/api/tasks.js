// Per-project tasks (TODOs). Backed by core/tasks-store.js (JSONL event log).
//   GET    /projects/:pid/tasks                  ?state=open|done|dropped|all&tag=X&agent=Y&due_before=ISO&limit=N
//   POST   /projects/:pid/tasks                  { title, body?, tags?, due?, agent?, source?, meta? }
//   GET    /projects/:pid/tasks/:id              (id or prefix)
//   PATCH  /projects/:pid/tasks/:id              { patch: {...} }
//   POST   /projects/:pid/tasks/:id/done         { by? }
//   POST   /projects/:pid/tasks/:id/drop         { by? }
//   POST   /projects/:pid/tasks/:id/reopen
import {
  createTask,
  listTasks,
  getTask,
  patchTask,
  doneTask,
  dropTask,
  reopenTask,
  countTasks,
} from "../../../core/tasks-store.js";

export function register(app, { project }) {
  app.get("/projects/:pid/tasks", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { state, tag, agent, due_before, due_after, limit } = req.query;
    const out = listTasks(p.storagePath, {
      state: state || undefined,
      tag: tag || undefined,
      agent: agent || undefined,
      due_before: due_before || undefined,
      due_after: due_after || undefined,
      limit: limit ? Math.min(parseInt(limit, 10) || 0, 1000) : undefined,
    });
    res.json(out);
  });

  app.post("/projects/:pid/tasks", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      const task = createTask(p.storagePath, req.body || {});
      res.status(201).json(task);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/projects/:pid/tasks/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const task = getTask(p.storagePath, req.params.id);
    if (!task) return res.status(404).json({ error: "task not found" });
    res.json(task);
  });

  app.patch("/projects/:pid/tasks/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { patch } = req.body || {};
    if (!patch || typeof patch !== "object") {
      return res.status(400).json({ error: "patch object required" });
    }
    const updated = patchTask(p.storagePath, req.params.id, patch);
    if (!updated) return res.status(404).json({ error: "task not found" });
    res.json(updated);
  });

  app.post("/projects/:pid/tasks/:id/done", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { by = null } = req.body || {};
    const updated = doneTask(p.storagePath, req.params.id, by);
    if (!updated) return res.status(404).json({ error: "task not found" });
    res.json(updated);
  });

  app.post("/projects/:pid/tasks/:id/drop", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { by = null } = req.body || {};
    const updated = dropTask(p.storagePath, req.params.id, by);
    if (!updated) return res.status(404).json({ error: "task not found" });
    res.json(updated);
  });

  app.post("/projects/:pid/tasks/:id/reopen", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const updated = reopenTask(p.storagePath, req.params.id);
    if (!updated) return res.status(404).json({ error: "task not found" });
    res.json(updated);
  });

  // Lightweight summary endpoint for status displays.
  app.get("/projects/:pid/tasks-summary", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(countTasks(p.storagePath));
  });
}
