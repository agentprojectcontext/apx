// Tasks (TODOs). Backed by core/stores/tasks.js (JSONL event log).
//   GET    /tasks                                cross-project; same filters, plus ?offset
//   GET    /projects/:pid/tasks                  ?state=open|done|dropped|all&tag=X&agent=Y
//                                                &due_before=ISO&due_after=ISO&limit=N
//                                                &status=pending|running|in_review|blocked&updated_since=ISO
//   POST   /projects/:pid/tasks                  { title, description?, body?, tags?, due?,
//                                                agent?, source?, meta? }
//   GET    /projects/:pid/tasks/:id              (id or prefix)
//   PATCH  /projects/:pid/tasks/:id              { patch: {...} }
//   POST   /projects/:pid/tasks/:id/done         { by? }
//   POST   /projects/:pid/tasks/:id/drop         { by? }
//   POST   /projects/:pid/tasks/:id/reopen
//   POST   /projects/:pid/tasks/:id/comments    { text, by? } — @mentions summon agents
//   GET    /tasks/columns                       the GLOBAL board-column catalog
//   PUT    /tasks/columns                       { columns: [{id,label?}] }
//   GET    /projects/:pid/tasks/columns         { columns, catalog } for that project
//   PUT    /projects/:pid/tasks/columns         { columns: [id] } — a subset of the catalog
//
// `?parent=<id>` on either list route returns that task's SUBTASKS; `?parent=`
// (empty) returns only top-level tasks. A subtask is a task with a parent, so
// every verb above works on one unchanged.
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
} from "#core/stores/tasks.js";
import { addComment } from "#core/stores/tasks.js";
import { readConfig, writeConfig } from "#core/config/index.js";
import {
  DONE_COLUMN, columnHook, normalizeColumns, isColumnId, projectColumns, readColumnCatalog,
} from "#core/tasks/columns.js";
import { readAgents } from "#core/apc/parser.js";
import { readProjectConfig, writeProjectConfig } from "../project-config.js";
import { mentionedAgents, runCommentMentions } from "#core/tasks/comment-turn.js";
import { OWNER_ACTOR_ID } from "#core/constants/actors.js";
import { pageEnvelope } from "./shared.js";

/** What the board says when a column has an agent but no instruction. */
function defaultHookLine(label) {
  return `esta task pasó a "${label}". Hacé lo que corresponda y dejá el resultado acá.`;
}

/**
 * Is this column's agent already working on this task?
 *
 * The newest comment being an owner-authored summon of that same agent means we
 * asked and nothing has come back yet — the moment the agent replies, ITS
 * comment is the newest one and a genuine re-run is allowed again. Without this,
 * dragging a card out of a column and back in (a thing people do constantly)
 * starts a second paid run on top of the first.
 *
 * Matching on `mentions` rather than on the text: the summon line is the
 * column's own instruction when it has one, so there is no wording to look for.
 */
function hookAlreadyRunning(task, agent) {
  const last = task.comments?.[task.comments.length - 1];
  if (!last) return false;
  return last.by === OWNER_ACTOR_ID && (last.mentions || []).includes(agent);
}

export function register(api, { project, projects, config, plugins, registries }) {
  // Global tasks across every project, newest first. Returns a { meta, data }
  // envelope. Paginated via ?limit & ?offset; with no limit, data is the full
  // set as one page.
  api.get("/tasks", (req, res) => {
    const { state, tag, agent, due_before, due_after, status, updated_since, parent } = req.query;

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
      // "all" is passed THROUGH, not turned into undefined: listTasks reads a
      // missing state as "open only", so mapping all→undefined made the
      // aggregated view's All chip show exactly the same rows as Open.
      state: state || "open",
      tag: tag || undefined,
      agent: agent || undefined,
      due_before: due_before || undefined,
      due_after: due_after || undefined,
      status: status || undefined,
      updated_since: updated_since || undefined,
      ...(parent !== undefined ? { parent } : {}),
    });

    const envelope = pageEnvelope(tasks, req.query);
    // Say when a project could not be read rather than quietly showing less.
    if (skipped.length) envelope.meta = { ...(envelope.meta || {}), skipped };
    res.json(envelope);
  });

  // The vocabulary every board shares. Editing it here renames/adds/removes a
  // column for every project at once, which is the point: "QA" has to mean the
  // same thing everywhere or an agent told to move something to QA has to ask
  // which one. What each project SHOWS is the per-project route below.
  api.get("/tasks/columns", (_req, res) => {
    res.json({ columns: readColumnCatalog(readConfig()) });
  });

  api.put("/tasks/columns", (req, res) => {
    const { columns } = req.body || {};
    if (!Array.isArray(columns) || columns.length === 0) {
      return res.status(400).json({ error: "columns must be a non-empty array" });
    }
    const bad = columns.find((c) => !isColumnId(typeof c === "string" ? c : c?.id));
    if (bad) {
      return res.status(400).json({
        error: `invalid column id: ${JSON.stringify(typeof bad === "string" ? bad : bad?.id)} ` +
          `(lowercase letters, digits, - and _; "${DONE_COLUMN}" is reserved)`,
      });
    }
    const cfg = readConfig();
    const next = normalizeColumns(columns);
    writeConfig({ ...cfg, tasks: { ...(cfg.tasks || {}), columns: next } });
    res.json({ columns: next });
  });

  // What THIS project shows, in order, with `done` appended — plus the catalog
  // it may pick from, so the editor needs one request instead of two.
  api.get("/projects/:pid/tasks/columns", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const global = readConfig();
    res.json({
      columns: projectColumns(global, readProjectConfig(p.path)),
      catalog: readColumnCatalog(global),
    });
  });

  api.put("/projects/:pid/tasks/columns", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { columns } = req.body || {};
    if (!Array.isArray(columns)) return res.status(400).json({ error: "columns must be an array" });
    const global = readConfig();
    const known = new Set(readColumnCatalog(global).map((c) => c.id));
    const picked = [...new Set(columns.map((c) => String(c?.id || c || "").trim().toLowerCase()))]
      .filter((id) => known.has(id));
    const cfg = readProjectConfig(p.path);
    writeProjectConfig(p.path, { ...cfg, tasks: { ...(cfg.tasks || {}), columns: picked } });
    res.json({
      columns: projectColumns(global, readProjectConfig(p.path)),
      catalog: readColumnCatalog(global),
    });
  });

  // Per-project tasks. Returns a { meta, data } envelope; with no ?limit the
  // data array is the full filtered set (one page).
  api.get("/projects/:pid/tasks", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { state, tag, agent, due_before, due_after, status, updated_since, parent } = req.query;
    const all = listTasks(p.storagePath, {
      state: state || undefined,
      tag: tag || undefined,
      agent: agent || undefined,
      due_before: due_before || undefined,
      due_after: due_after || undefined,
      status: status || undefined,
      updated_since: updated_since || undefined,
      ...(parent !== undefined ? { parent } : {}),
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

  // Move an open task to a column. The valid set is the project's own columns
  // (core/tasks/columns.js) — not the four built-ins, which are only the default
  // catalog. `done` is not among them: closing a task is POST …/done, and a
  // board that let you *set* done would leave state and status disagreeing.
  api.post("/projects/:pid/tasks/:id/status", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { status } = req.body || {};
    const columns = projectColumns(readConfig(), readProjectConfig(p.path));
    const statuses = columns.map((c) => c.id).filter((id) => id !== DONE_COLUMN);
    if (!statuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${statuses.join(", ")}` });
    }
    const updated = setTaskStatus(p.storagePath, req.params.id, status, { statuses });
    if (!updated) return res.status(404).json({ error: "task not found" });

    // Column automation: dropping a card in a column that has one hands the task
    // to an agent. It runs through the SAME path a human @mention takes — the
    // handover is written into the thread first, so the board never does
    // anything invisible, and the reply comes back as a comment under the same
    // ceiling. Fire-and-forget: a real QA run takes as long as the QA takes.
    const hook = columnHook(columns, status);
    if (hook && !hookAlreadyRunning(updated, hook.agent)) {
      let hasAgent = false;
      try { hasAgent = readAgents(p.path).some((a) => a.slug === hook.agent); } catch { hasAgent = false; }
      if (hasAgent) {
        const label = columns.find((c) => c.id === status)?.label || status;
        const text = hook.instruction
          ? `@${hook.agent} ${hook.instruction}`
          : `@${hook.agent} ${defaultHookLine(label)}`;
        try {
          addComment(p.storagePath, updated.id, {
            by: OWNER_ACTOR_ID, text, mentions: [hook.agent],
          });
          runCommentMentions({
            p, taskId: updated.id, seed: [hook.agent], author: OWNER_ACTOR_ID,
            projects, plugins, registries, config,
          }).catch(() => { /* the failure is written into the thread */ });
        } catch { /* a broken hook must not fail the move */ }
      }
    }

    res.json(updated);
  });

  // Add a comment. @-mentioning an agent hands it the task: it runs a REAL turn
  // with its own tools and writes back another comment (core/tasks/comment-turn).
  //
  // The cascade is NOT awaited. An agent doing actual QA takes as long as the QA
  // takes, and a request that hangs for it would time out on the phone and be
  // retried into a second run. The comment is persisted before we answer, so the
  // 201 is honest about what exists; the replies arrive in the thread after.
  api.post("/projects/:pid/tasks/:id/comments", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { text, by = OWNER_ACTOR_ID } = req.body || {};
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text required" });
    }

    // Resolved here, not in the store: the roster lives with the project and
    // the thread should record who was actually reachable on the day.
    const mentions = mentionedAgents(text, p.path, by);
    let task;
    try {
      task = addComment(p.storagePath, req.params.id, { by, text, mentions });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (!task) return res.status(404).json({ error: "task not found" });

    if (mentions.length) {
      runCommentMentions({
        p, taskId: task.id, seed: mentions, author: by,
        projects, plugins, registries, config,
      }).catch(() => { /* the failure is already written into the thread */ });
    }

    res.status(201).json({ task, summoned: mentions });
  });

  // Lightweight summary endpoint for status displays.
  api.get("/projects/:pid/tasks-summary", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(countTasks(p.storagePath));
  });
}
