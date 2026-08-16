// Tasks (TODOs). Backed by core/stores/tasks.js (JSONL event log).
//   GET    /tasks                                cross-project; same filters, plus ?offset
//   GET    /projects/:pid/tasks                  ?state=open|done|dropped|all&tag=X&agent=Y
//                                                &due_before=ISO&due_after=ISO&limit=N
//                                                &status=pending|running|in_review|blocked&updated_since=ISO
//   POST   /projects/:pid/tasks                  { title, body?, tags?, due?, agent?, source?, meta? }
//   GET    /projects/:pid/tasks/:id              (id or prefix)
//   PATCH  /projects/:pid/tasks/:id              { patch: {...} }
//   POST   /projects/:pid/tasks/:id/done         { by? }
//   POST   /projects/:pid/tasks/:id/drop         { by? }
//   POST   /projects/:pid/tasks/:id/reopen
import {
  createTask,
  listTasks,
  listTasksAcrossProjects,
  getTask,
  patchTask,
  doneTask,
  dropTask,
  reopenTask,
  setTaskStatus,
  countTasks,
  TASK_STATUSES,
} from "#core/stores/tasks.js";
import { pageEnvelope } from "./shared.js";

export function register(api, { project, projects }) {
  // Global tasks across every project, newest first. Returns a { meta, data }
  // envelope. Paginated via ?limit & ?offset; with no limit, data is the full
  // set as one page.
  api.get("/tasks", (req, res) => {
    const { state, tag, agent, due_before, due_after, status, updated_since } = req.query;

    // Resolve the registered projects to what core needs, dropping any the
    // manager can no longer open.
    const entries = [];
    for (const entry of projects.list()) {
      const p = projects.get(entry.id);
      if (!p?.storagePath) continue;
      entries.push({
        id: entry.id,
        name: entry.name || entry.path,
        path: entry.path,
        storagePath: p.storagePath,
      });
    }

    const { tasks, skipped } = listTasksAcrossProjects(entries, {
      state: state === "all" ? undefined : (state || "open"),
      tag: tag || undefined,
      agent: agent || undefined,
      due_before: due_before || undefined,
      due_after: due_after || undefined,
      status: status || undefined,
      updated_since: updated_since || undefined,
    });

    const envelope = pageEnvelope(tasks, req.query);
    // Say when a project could not be read rather than quietly showing less.
    if (skipped.length) envelope.meta = { ...(envelope.meta || {}), skipped };
    res.json(envelope);
  });

  // Per-project tasks. Returns a { meta, data } envelope; with no ?limit the
  // data array is the full filtered set (one page).
  api.get("/projects/:pid/tasks", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { state, tag, agent, due_before, due_after, status, updated_since } = req.query;
    const all = listTasks(p.storagePath, {
      state: state || undefined,
      tag: tag || undefined,
      agent: agent || undefined,
      due_before: due_before || undefined,
      due_after: due_after || undefined,
      status: status || undefined,
      updated_since: updated_since || undefined,
    });
    res.json(pageEnvelope(all, req.query));
  });

  api.post("/projects/:pid/tasks", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      const task = createTask(p.storagePath, req.body || {});
      res.status(201).json(task);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.get("/projects/:pid/tasks/:id", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const task = getTask(p.storagePath, req.params.id);
    if (!task) return res.status(404).json({ error: "task not found" });
    res.json(task);
  });

  api.patch("/projects/:pid/tasks/:id", (req, res) => {
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

  api.post("/projects/:pid/tasks/:id/done", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { by = null } = req.body || {};
    const updated = doneTask(p.storagePath, req.params.id, by);
    if (!updated) return res.status(404).json({ error: "task not found" });
    res.json(updated);
  });

  api.post("/projects/:pid/tasks/:id/drop", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { by = null } = req.body || {};
    const updated = dropTask(p.storagePath, req.params.id, by);
    if (!updated) return res.status(404).json({ error: "task not found" });
    res.json(updated);
  });

  api.post("/projects/:pid/tasks/:id/reopen", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const updated = reopenTask(p.storagePath, req.params.id);
    if (!updated) return res.status(404).json({ error: "task not found" });
    res.json(updated);
  });

  // Move an open task through its workflow (pending → running → in_review …).
  api.post("/projects/:pid/tasks/:id/status", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { status } = req.body || {};
    if (!TASK_STATUSES.includes(status))
      return res.status(400).json({ error: `status must be one of ${TASK_STATUSES.join(", ")}` });
    const updated = setTaskStatus(p.storagePath, req.params.id, status);
    if (!updated) return res.status(404).json({ error: "task not found" });
    res.json(updated);
  });

  // Lightweight summary endpoint for status displays.
  api.get("/projects/:pid/tasks-summary", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(countTasks(p.storagePath));
  });
}
