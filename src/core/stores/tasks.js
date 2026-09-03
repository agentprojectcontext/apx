// Tasks (TODOs) per project.
//
// Append-only JSONL event log, one file per month under
//   ~/.apx/projects/<apxId>/tasks/YYYY-MM.jsonl
//
// Each line is a `{ id, ts, op, ... }` event. The current state of a task is
// the result of folding every event with that id in chronological order:
//
//   create  — sets initial fields (title, description, body, tags, due, agent,
//             source, meta, parent)
//   comment — appends one comment to the task's thread (by, text)
//   update — shallow-merge patch (`patch` field)
//   done   — closes the task (`by` field optional)
//   drop   — archives without "completed" semantics (`by` field optional)
//
// State values: "open" (after create) → "done" or "dropped". Once dropped or
// done, further updates are recorded but the state is sticky unless the
// caller explicitly re-opens with op="reopen".
import fs from "node:fs";
import path from "node:path";
import { nowIso } from "../util/time.js";
import { shortId as makeShortId } from "../util/ids.js";
import { normalizeTaskCategory, normalizeTaskLocation } from "#core/constants/task-categories.js";

// Workflow sub-status for an *open* task. Orthogonal to `state`
// (open/done/dropped): `state` is the storage lifecycle, `status` is how an
// open task is progressing. `blocked` means it's waiting on a human/agent.
export const TASK_STATUSES = Object.freeze(["pending", "running", "in_review", "blocked"]);
export const DEFAULT_TASK_STATUS = "pending";

/**
 * Write-side validation. `allowed` is the caller's vocabulary — the four above
 * by default, or whatever columns the install has configured (core/tasks/
 * columns.js). The store stays config-free: whoever knows the catalog passes it.
 */
function normalizeStatus(v, allowed = TASK_STATUSES) {
  const list = Array.isArray(allowed) && allowed.length ? allowed : TASK_STATUSES;
  return list.includes(v) ? v : DEFAULT_TASK_STATUS;
}

/**
 * Read-side. Deliberately NOT re-validated against today's vocabulary: the value
 * was checked when it was written, and a column removed from the catalog later
 * must not silently rewrite the history of every task that sat in it. Shape only.
 */
function readStatus(v) {
  return typeof v === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v) ? v : DEFAULT_TASK_STATUS;
}

function tasksDir(storagePath) {
  return path.join(storagePath, "tasks");
}

function monthlyFile(storagePath, date = new Date()) {
  const ym = date.toISOString().slice(0, 7); // YYYY-MM
  return path.join(tasksDir(storagePath), `${ym}.jsonl`);
}

function shortId() {
  return makeShortId("t");
}

function appendEvent(storagePath, event) {
  const file = monthlyFile(storagePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(event) + "\n");
  _events.delete(storagePath);
}

// Parsed events, keyed by storage path and validated against the directory's
// shape (names + sizes + mtimes). Only the READ and the JSON.parse are cached;
// the fold is redone every call, so nobody can poison the cache by mutating a
// task object we handed out.
//
// It earns its place now that comments live on this log: a task detail is one
// getTask, a thread of twenty comments is twenty more events, and both the
// panel and the phone poll. Before this, every list, get, patch and comment
// re-read and re-parsed every monthly file on disk — four times per write.
const _events = new Map();

function dirSignature(dir, files) {
  let sig = "";
  for (const f of files) {
    const st = fs.statSync(path.join(dir, f));
    sig += `${f}:${st.size}:${st.mtimeMs};`;
  }
  return sig;
}

function readAllEvents(storagePath) {
  const dir = tasksDir(storagePath);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();

  const sig = dirSignature(dir, files);
  const hit = _events.get(storagePath);
  if (hit && hit.sig === sig) return hit.events;

  const events = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev && ev.id && ev.op) events.push(ev);
      } catch {
        // Skip corrupt lines; one bad write shouldn't break the projection.
        // We could log here; for now we silently drop.
      }
    }
  }
  events.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  _events.set(storagePath, { sig, events });
  return events;
}

/** Drop every cached parse. For tests, and for anything that edits logs by hand. */
export function resetTasksCache() {
  _events.clear();
}

function projectState(events) {
  const tasks = new Map();
  for (const ev of events) {
    const existing = tasks.get(ev.id);
    switch (ev.op) {
      case "create": {
        if (existing) break; // duplicate create — keep first
        tasks.set(ev.id, {
          id: ev.id,
          created_at: ev.ts,
          updated_at: ev.ts,
          state: "open",
          status: readStatus(ev.status),
          title: ev.title || "",
          parent: ev.parent || null,
          // Every comment on this task, oldest first. Lives on the same event
          // log as the task itself so a comment is never orphaned from what it
          // is about, and so an agent's reply is as durable as the task row.
          comments: [],
          // What the OWNER has to do, in their words. `body` next to it is the
          // agent's prompt. They were one field for a while and it made the
          // task unreadable as a to-do: the panel labelled it "Prompt" and
          // hinted "what the agent receives", so a list of things to do read
          // like a queue of jobs to dispatch. Splitting them is what lets the
          // same row be legible to a person and useful to an agent.
          description: ev.description || null,
          body: ev.body || null,
          tags: Array.isArray(ev.tags) ? [...ev.tags] : [],
          due: ev.due || null,
          agent: ev.agent || null,
          source: ev.source || null,
          created_by: ev.created_by || null,
          thread: ev.thread || null,
          // What KIND of task, and where. Both are first-class rather than
          // conventions inside `meta` or `tags`, because the daemon routes on
          // them — see core/constants/task-categories.js.
          category: normalizeTaskCategory(ev.category),
          location: normalizeTaskLocation(ev.location),
          meta: ev.meta && typeof ev.meta === "object" ? { ...ev.meta } : {},
        });
        break;
      }
      case "update": {
        if (!existing) break;
        const patch = ev.patch && typeof ev.patch === "object" ? ev.patch : {};
        for (const k of Object.keys(patch)) {
          if (k === "id" || k === "state" || k === "created_at") continue;
          if (k === "status") existing[k] = readStatus(patch[k]);
          else if (k === "category") existing[k] = normalizeTaskCategory(patch[k]);
          // A patch that clears the location must be able to say so, so null
          // survives here where an unknown key would just be copied.
          else if (k === "location") existing[k] = normalizeTaskLocation(patch[k]);
          else existing[k] = patch[k];
        }
        existing.updated_at = ev.ts;
        break;
      }
      case "done": {
        if (!existing) break;
        existing.state = "done";
        existing.done_at = ev.ts;
        existing.done_by = ev.by || null;
        existing.updated_at = ev.ts;
        break;
      }
      case "drop": {
        if (!existing) break;
        existing.state = "dropped";
        existing.dropped_at = ev.ts;
        existing.dropped_by = ev.by || null;
        existing.updated_at = ev.ts;
        break;
      }
      case "reopen": {
        if (!existing) break;
        existing.state = "open";
        existing.reopened_at = ev.ts;
        existing.updated_at = ev.ts;
        break;
      }
      case "comment": {
        if (!existing) break;
        existing.comments.push({
          id: ev.comment_id || ev.ts,
          ts: ev.ts,
          // Who said it: an actor id ("owner") or an agent slug. Free-form on
          // purpose — the surfaces label it, the store just records it.
          by: ev.by || null,
          text: typeof ev.text === "string" ? ev.text : "",
          // Agent slugs this comment addressed. Resolved at WRITE time by the
          // caller, because the roster it resolves against can change later and
          // a thread should keep saying who was actually pulled in that day.
          mentions: Array.isArray(ev.mentions) ? [...ev.mentions] : [],
        });
        // A comment IS activity on the task — it moves updated_at, which is what
        // `--updated-since` and every "what moved?" view read.
        existing.updated_at = ev.ts;
        break;
      }
      default:
        // unknown op — record nothing, but don't throw
        break;
    }
  }
  return tasks;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create a new task. Returns the freshly projected task object.
 * fields: { title (required), description?, body?, tags?, due?, agent?,
 *           source?, meta?, category?, location? }
 */
export function createTask(storagePath, fields, { statuses } = {}) {
  if (!fields || typeof fields !== "object") throw new Error("createTask: fields required");
  if (!fields.title || typeof fields.title !== "string") throw new Error("createTask: title required");
  const id = shortId();
  const ev = {
    id,
    ts: nowIso(),
    op: "create",
    title: fields.title.trim(),
    // A subtask is just a task with a parent. No second store, no second set of
    // verbs: everything that lists, filters, closes or comments on a task works
    // on a subtask unchanged, which is the whole reason it is one field.
    parent: fields.parent || null,
    description: fields.description || null,
    body: fields.body || null,
    status: normalizeStatus(fields.status, statuses),
    tags: Array.isArray(fields.tags) ? fields.tags.filter((t) => typeof t === "string") : [],
    due: fields.due || null,
    agent: fields.agent || null,
    source: fields.source || null,
    created_by: fields.created_by || null,
    thread: fields.thread || null,
    category: normalizeTaskCategory(fields.category),
    location: normalizeTaskLocation(fields.location),
    meta: fields.meta && typeof fields.meta === "object" ? fields.meta : {},
  };
  appendEvent(storagePath, ev);
  return getTask(storagePath, id);
}

/**
 * Newest first, with `id` as a tiebreak.
 *
 * The tiebreak is not cosmetic: nowIso() strips milliseconds, so every task
 * created within the same SECOND shares a created_at — which is the norm when a
 * routine files several at once. Without a second key the order of those rows
 * is whatever the sort happened to do, and a list that reshuffles between two
 * identical calls is worse than one that is merely arbitrary.
 */
function byNewest(a, b) {
  const t = (b.created_at || "").localeCompare(a.created_at || "");
  return t !== 0 ? t : String(b.id || "").localeCompare(String(a.id || ""));
}

/**
 * How many children each task has, and how many are closed. Computed once over
 * the whole fold rather than per row, because "2/5" on a parent is the only
 * thing that makes an epic readable at a glance.
 */
function childIndex(tasks) {
  const idx = new Map();
  for (const t of tasks) {
    if (!t.parent) continue;
    const e = idx.get(t.parent) || { total: 0, done: 0 };
    e.total += 1;
    if (t.state === "done") e.done += 1;
    idx.set(t.parent, e);
  }
  return idx;
}

/**
 * A list row. Comments are DROPPED here and only counted: a page of 20 tasks
 * with their full threads is a payload nobody on that screen reads, and the
 * phone pays for it twice.
 */
function row(task, idx) {
  const kids = idx.get(task.id);
  const { comments, ...rest } = task;
  return {
    ...rest,
    comment_count: comments.length,
    subtask_count: kids?.total || 0,
    subtask_done: kids?.done || 0,
  };
}

/** List tasks with optional filters. */
export function listTasks(storagePath, opts = {}) {
  const events = readAllEvents(storagePath);
  const all = [...projectState(events).values()];
  const idx = childIndex(all);
  const tasks = all.map((t) => row(t, idx));

  let out = tasks;
  if (opts.state && opts.state !== "all") {
    out = out.filter((t) => t.state === opts.state);
  } else if (!opts.state) {
    out = out.filter((t) => t.state === "open");
  }
  if (opts.tag) {
    out = out.filter((t) => Array.isArray(t.tags) && t.tags.includes(opts.tag));
  }
  if (opts.agent) {
    out = out.filter((t) => t.agent === opts.agent);
  }
  // Children of one task ("" / null asks for TOP-LEVEL tasks only, which is
  // what a list wants so an epic's children do not also sit at the root).
  if (opts.parent !== undefined) {
    const want = opts.parent || null;
    out = out.filter((t) => (t.parent || null) === want);
  }
  if (opts.due_before) {
    out = out.filter((t) => t.due && t.due <= opts.due_before);
  }
  if (opts.due_after) {
    out = out.filter((t) => t.due && t.due >= opts.due_after);
  }
  // Workflow sub-status of an OPEN task (pending/running/in_review/blocked).
  // Orthogonal to `state` — "what is blocked right now" is a different question
  // from "what is open".
  if (opts.status) {
    out = out.filter((t) => t.status === opts.status);
  }
  // Everything touched since a moment. The cheapest way to ask "what moved?".
  if (opts.updated_since) {
    out = out.filter((t) => (t.updated_at || t.created_at || "") >= opts.updated_since);
  }
  out.sort(byNewest);
  if (opts.limit && Number.isFinite(opts.limit)) {
    out = out.slice(0, opts.limit);
  }
  return out;
}

/**
 * The same query, folded across every registered project.
 *
 * Lives in core rather than in the daemon route because the CLI, the HTTP API
 * and the panel all need it, and AGENTS.md rule 8 puts a shared operation in
 * one home with the surfaces as adapters. The caller supplies the project list
 * so this stays free of daemon and config imports.
 *
 * A project whose task log is unreadable is SKIPPED, not fatal: one corrupt
 * JSONL file must not blank out the cross-project view. Skipped ids are
 * returned so a surface can say so instead of quietly showing less.
 *
 * @param {{id: any, name?: string, path?: string, storagePath: string}[]} projects
 * @param {object} opts  Same filters as listTasks, plus `limit` applied AFTER
 *                       the merge (a per-project limit would silently favour
 *                       whichever project sorts first).
 * @returns {{ tasks: object[], skipped: {id: any, error: string}[] }}
 */
export function listTasksAcrossProjects(projects, opts = {}) {
  const { limit, ...perProject } = opts || {};
  const tasks = [];
  const skipped = [];

  for (const entry of projects || []) {
    if (!entry?.storagePath) continue;
    try {
      for (const t of listTasks(entry.storagePath, perProject)) {
        tasks.push({
          ...t,
          project_id: entry.id,
          project_name: entry.name || entry.path || String(entry.id),
        });
      }
    } catch (e) {
      skipped.push({ id: entry.id, error: e?.message || String(e) });
    }
  }

  tasks.sort(byNewest);
  return {
    tasks: Number.isFinite(limit) && limit > 0 ? tasks.slice(0, limit) : tasks,
    skipped,
  };
}

/** Get a single task by id or by id prefix (≥ 3 chars, must be unique). */
export function getTask(storagePath, idOrPrefix) {
  if (!idOrPrefix || typeof idOrPrefix !== "string") return null;
  const events = readAllEvents(storagePath);
  const tasks = projectState(events);
  const idx = childIndex([...tasks.values()]);

  // The detail keeps its thread — it is the one screen that reads it.
  const full = (t) => ({ ...row(t, idx), comments: t.comments.map((c) => ({ ...c })) });

  if (tasks.has(idOrPrefix)) return full(tasks.get(idOrPrefix));
  if (idOrPrefix.length < 3) return null;
  const matches = [...tasks.values()].filter((t) => t.id.startsWith(idOrPrefix));
  if (matches.length === 1) return full(matches[0]);
  return null;
}

/** Patch a task. Returns the projected task; null if id not found. */
export function patchTask(storagePath, idOrPrefix, patch) {
  const existing = getTask(storagePath, idOrPrefix);
  if (!existing) return null;
  if (!patch || typeof patch !== "object") return existing;
  appendEvent(storagePath, {
    id: existing.id,
    ts: nowIso(),
    op: "update",
    patch,
  });
  return getTask(storagePath, existing.id);
}

/**
 * Move an open task to a column. `statuses` is the vocabulary to validate
 * against — omit it and the four built-ins apply.
 */
export function setTaskStatus(storagePath, idOrPrefix, status, { statuses } = {}) {
  const existing = getTask(storagePath, idOrPrefix);
  if (!existing) return null;
  appendEvent(storagePath, {
    id: existing.id,
    ts: nowIso(),
    op: "update",
    patch: { status: normalizeStatus(status, statuses) },
  });
  return getTask(storagePath, existing.id);
}

/** Mark done. */
export function doneTask(storagePath, idOrPrefix, by = null) {
  const existing = getTask(storagePath, idOrPrefix);
  if (!existing) return null;
  appendEvent(storagePath, {
    id: existing.id,
    ts: nowIso(),
    op: "done",
    by,
  });
  return getTask(storagePath, existing.id);
}

/** Drop (archive without completion). */
export function dropTask(storagePath, idOrPrefix, by = null) {
  const existing = getTask(storagePath, idOrPrefix);
  if (!existing) return null;
  appendEvent(storagePath, {
    id: existing.id,
    ts: nowIso(),
    op: "drop",
    by,
  });
  return getTask(storagePath, existing.id);
}

/**
 * Append a comment to a task's thread. Returns the projected task, or null if
 * the task does not exist.
 *
 * `mentions` are agent slugs the caller already resolved — the store does no
 * roster lookup of its own, so a thread keeps saying who was actually pulled in
 * on the day it was written even after the project's agents change.
 */
export function addComment(storagePath, idOrPrefix, { by = null, text = "", mentions = [] } = {}) {
  const existing = getTask(storagePath, idOrPrefix);
  if (!existing) return null;
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) throw new Error("addComment: text required");
  appendEvent(storagePath, {
    id: existing.id,
    ts: nowIso(),
    op: "comment",
    comment_id: makeShortId("c"),
    by,
    text: body,
    mentions: Array.isArray(mentions) ? mentions.filter((m) => typeof m === "string") : [],
  });
  return getTask(storagePath, existing.id);
}

/** Re-open a done/dropped task. */
export function reopenTask(storagePath, idOrPrefix) {
  const existing = getTask(storagePath, idOrPrefix);
  if (!existing) return null;
  appendEvent(storagePath, {
    id: existing.id,
    ts: nowIso(),
    op: "reopen",
  });
  return getTask(storagePath, existing.id);
}

/** Counts for status displays. */
export function countTasks(storagePath) {
  const tasks = [...projectState(readAllEvents(storagePath)).values()];
  const today = new Date().toISOString().slice(0, 10);
  const open = tasks.filter((t) => t.state === "open");
  // Every built-in, plus any configured column actually in use — a board with a
  // "qa" column whose summary never mentions qa is a summary of a different board.
  const byStatus = {};
  for (const s of TASK_STATUSES) byStatus[s] = 0;
  for (const t of open) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  return {
    open: open.length,
    done: tasks.filter((t) => t.state === "done").length,
    dropped: tasks.filter((t) => t.state === "dropped").length,
    overdue: open.filter((t) => t.due && t.due < today).length,
    total: tasks.length,
    status: byStatus,
  };
}
