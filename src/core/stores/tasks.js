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
//   depend   — this task waits on another (target, reason, owner, condition)
//   undepend — that wait is lifted, with the reason it no longer holds
//   ask      — somebody needs a decision (question, options, who decides)
//   decide   — the decision was answered (answer, by)
//   withdraw — the question no longer applies (reason)
//   decision_notice — what happened when the decider was notified remotely
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
import { OWNER_ACTOR_ID } from "#core/constants/actors.js";
import {
  activityAt,
  awaitsOwner,
  blockedByOwner,
  commentPreview,
  ownerAliasesFrom,
} from "#core/tasks/attention.js";
import {
  normalizeTaskAssignee,
  normalizeTaskPriority,
  normalizeTaskReminderFrequency,
} from "#core/constants/task-fields.js";

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
          // When the CURRENT blocked period began. Derived from transitions,
          // never written: a comment moves updated_at, and a watcher reading
          // that clock was silenced by the owner asking "any news?".
          blocked_since: readStatus(ev.status) === "blocked" ? ev.ts : null,
          // Who put the card in its current column, and when — so a "running"
          // nobody can explain can at least be traced to whoever set it.
          status_changed_at: ev.ts,
          status_changed_by: ev.created_by || null,
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
          agent: normalizeTaskAssignee(ev.agent),
          priority: normalizeTaskPriority(ev.priority),
          reminder_frequency: normalizeTaskReminderFrequency(ev.reminder_frequency),
          source: ev.source || null,
          created_by: ev.created_by || null,
          thread: ev.thread || null,
          // What KIND of task, and where. Both are first-class rather than
          // conventions inside `meta` or `tags`, because the daemon routes on
          // them — see core/constants/task-categories.js.
          category: normalizeTaskCategory(ev.category),
          location: normalizeTaskLocation(ev.location),
          meta: ev.meta && typeof ev.meta === "object" ? { ...ev.meta } : {},
          // What this task waits on (other tasks in this project), and the
          // waits that were lifted — kept, with why, so a removed dependency
          // never just vanishes from the record.
          depends_on: [],
          dependency_log: [],
          // Decisions somebody owes on this task — a structured question, not a
          // marker buried in a report (core/tasks/decisions.js).
          decisions: [],
        });
        break;
      }
      case "ask": {
        if (!existing || !ev.decision_id) break;
        if (existing.decisions.some((d) => d.id === ev.decision_id)) break;
        existing.decisions.push({
          id: ev.decision_id,
          question: ev.question || "",
          options: Array.isArray(ev.options) ? [...ev.options] : [],
          recommendation: ev.recommendation || null,
          responsible: ev.responsible || OWNER_ACTOR_ID,
          blocking: ev.blocking || null,
          can_continue: ev.can_continue || null,
          asked_by: ev.by || null,
          asked_at: ev.ts,
          state: "open",
          notice: null,
        });
        existing.updated_at = ev.ts;
        break;
      }
      case "decide":
      case "withdraw": {
        const d = existing?.decisions.find((x) => x.id === ev.decision_id);
        if (!d || d.state !== "open") break;
        if (ev.op === "decide") {
          d.state = "answered";
          d.answer = ev.answer || "";
          d.choice = ev.choice ?? null;
          d.answered_by = ev.by || null;
          d.answered_at = ev.ts;
        } else {
          d.state = "withdrawn";
          d.withdrawn_reason = ev.reason || null;
          d.withdrawn_by = ev.by || null;
          d.withdrawn_at = ev.ts;
        }
        existing.updated_at = ev.ts;
        break;
      }
      case "decision_notice": {
        const d = existing?.decisions.find((x) => x.id === ev.decision_id);
        if (!d) break;
        // Not activity on the task: a delivery receipt, so updated_at stays.
        d.notice = { at: ev.ts, channel: ev.channel || null, status: ev.status || "unknown", ...(ev.error ? { error: ev.error } : {}) };
        break;
      }
      case "depend": {
        if (!existing || !ev.target) break;
        if (existing.depends_on.some((d) => d.task_id === ev.target)) break;
        existing.depends_on.push({
          task_id: ev.target,
          reason: ev.reason || null,
          owner: ev.owner || null,
          condition: ev.condition || null,
          since: ev.ts,
          by: ev.by || null,
        });
        existing.updated_at = ev.ts;
        break;
      }
      case "undepend": {
        if (!existing || !ev.target) break;
        const gone = existing.depends_on.find((d) => d.task_id === ev.target);
        if (!gone) break;
        existing.depends_on = existing.depends_on.filter((d) => d.task_id !== ev.target);
        existing.dependency_log.push({ ...gone, removed_at: ev.ts, removed_by: ev.by || null, removed_reason: ev.reason || null });
        existing.updated_at = ev.ts;
        break;
      }
      case "update": {
        if (!existing) break;
        const patch = ev.patch && typeof ev.patch === "object" ? ev.patch : {};
        for (const k of Object.keys(patch)) {
          if (k === "id" || k === "state" || k === "created_at" || k === "blocked_since"
            || k === "status_changed_at" || k === "status_changed_by") continue;
          if (k === "status") {
            const next = readStatus(patch[k]);
            if (next === "blocked" && existing.status !== "blocked") existing.blocked_since = ev.ts;
            else if (next !== "blocked") existing.blocked_since = null;
            if (next !== existing.status) {
              existing.status_changed_at = ev.ts;
              existing.status_changed_by = ev.by || null;
            }
            existing[k] = next;
          }
          else if (k === "category") existing[k] = normalizeTaskCategory(patch[k]);
          // A patch that clears the location must be able to say so, so null
          // survives here where an unknown key would just be copied.
          else if (k === "location") existing[k] = normalizeTaskLocation(patch[k]);
          else if (k === "agent") existing[k] = normalizeTaskAssignee(patch[k]);
          else if (k === "priority") existing[k] = normalizeTaskPriority(patch[k]);
          else if (k === "reminder_frequency") existing[k] = normalizeTaskReminderFrequency(patch[k]);
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
        // A reopened task that is still in the blocked column is blocked AGAIN,
        // not blocked since before it was closed.
        if (existing.status === "blocked") existing.blocked_since = ev.ts;
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
          // Machine-readable facts about the comment (a runtime session it
          // reports on, its phase). Only present when the writer set some.
          ...(ev.meta && typeof ev.meta === "object" ? { meta: { ...ev.meta } } : {}),
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
    agent: normalizeTaskAssignee(fields.agent),
    priority: normalizeTaskPriority(fields.priority),
    reminder_frequency: normalizeTaskReminderFrequency(fields.reminder_frequency),
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
/**
 * Who waits on whom, both directions, with the other side's state. Built once
 * per fold like childIndex: "blocks" is derived, never stored, so the two
 * directions cannot disagree.
 */
function dependencyIndex(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const blocks = new Map();
  for (const t of tasks) {
    for (const d of t.depends_on || []) {
      const list = blocks.get(d.task_id) || [];
      list.push({ task_id: t.id, title: t.title, state: t.state, status: t.status, reason: d.reason, condition: d.condition });
      blocks.set(d.task_id, list);
    }
  }
  return { byId, blocks };
}

/**
 * One dependency as a surface reads it. `satisfied` means the task it waits on
 * is CLOSED as done — that unblocks the next step, it does not approve it: the
 * coordinator still verifies the delivery. A dropped or missing target is not
 * satisfied either; it is named so somebody decides whether the wait still holds.
 */
function dependencyView(d, deps) {
  const target = deps?.byId.get(d.task_id) || null;
  return {
    ...d,
    title: target?.title ?? null,
    state: target?.state ?? "missing",
    status: target?.status ?? null,
    satisfied: target?.state === "done",
    ...(target?.state === "done" ? { satisfied_at: target.done_at || null } : {}),
  };
}

function row(task, idx, aliases, deps = null) {
  const kids = idx.get(task.id);
  const { comments, ...rest } = task;
  const dependsOn = (task.depends_on || []).map((d) => dependencyView(d, deps));
  return {
    ...rest,
    depends_on: dependsOn,
    open_dependencies: dependsOn.filter((d) => !d.satisfied).length,
    open_decisions: (task.decisions || []).filter((d) => d.state === "open").length,
    blocks: deps?.blocks.get(task.id) || [],
    comment_count: comments.length,
    subtask_count: kids?.total || 0,
    subtask_done: kids?.done || 0,
    // What on this card is asking for something (core/tasks/attention.js).
    // Computed HERE, where the thread is still in hand: `row` drops `comments`,
    // and every surface that wanted to know who spoke last was re-reading the
    // whole event log to find out — or, more often, not asking at all and
    // showing "3 comentarios".
    activity_at: activityAt(task),
    // A structured question for the owner counts the same as an @owner comment.
    awaits_owner: awaitsOwner(task, aliases)
      || (task.state === "open" && (task.decisions || []).some((d) => d.state === "open" && d.responsible === OWNER_ACTOR_ID)),
    blocked_by_owner: blockedByOwner(task),
    last_comment: commentPreview(task, aliases),
  };
}

/**
 * The order the owner asked for: what is new on top, what is stuck on them at
 * the bottom.
 *
 * "Las más actualizadas arriba […] y más abajo las que ya se trabaron por mí"
 * (2026-09-20). Three bands, then newest-activity inside each one:
 *
 *   1. waiting on the owner   — somebody asked them something and is waiting
 *   2. everything else        — moving on its own
 *   3. blocked on the owner   — owed, but not news
 *
 * Band 3 sinking is not a demotion: a task that has sat on the owner since
 * Tuesday is not what a list sorted by news should open with. It is collected
 * where what you owe belongs — the notification centre — and `blocked_by_owner`
 * is the same field that puts it there.
 */
function byAttention(a, b) {
  const band = (t) => (t.awaits_owner ? 0 : t.blocked_by_owner ? 2 : 1);
  const d = band(a) - band(b);
  if (d !== 0) return d;
  const at = (t) => t.activity_at || t.updated_at || t.created_at || "";
  const t = at(b).localeCompare(at(a));
  return t !== 0 ? t : String(b.id || "").localeCompare(String(a.id || ""));
}

/** List tasks with optional filters. */
export function listTasks(storagePath, opts = {}) {
  const events = readAllEvents(storagePath);
  const all = [...projectState(events).values()];
  const idx = childIndex(all);
  const deps = dependencyIndex(all);
  const aliases = ownerAliasesFrom(opts.owner_name || null);
  const tasks = all.map((t) => row(t, idx, aliases, deps));

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
  out.sort(opts.sort === "attention" ? byAttention : byNewest);
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

  // The merge re-sorts with the SAME comparator the per-project list used —
  // otherwise asking for attention order across projects silently returns
  // newest order, which is the shape the caller is least likely to check.
  tasks.sort(perProject.sort === "attention" ? byAttention : byNewest);
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
  const deps = dependencyIndex([...tasks.values()]);

  // The detail keeps its thread — it is the one screen that reads it.
  const full = (t) => ({ ...row(t, idx, undefined, deps), comments: t.comments.map((c) => ({ ...c })) });

  if (tasks.has(idOrPrefix)) return full(tasks.get(idOrPrefix));
  if (idOrPrefix.length < 3) return null;
  const matches = [...tasks.values()].filter((t) => t.id.startsWith(idOrPrefix));
  if (matches.length === 1) return full(matches[0]);
  return null;
}

/** Patch a task. Returns the projected task; null if id not found. */
export function patchTask(storagePath, idOrPrefix, patch, { by = null } = {}) {
  const existing = getTask(storagePath, idOrPrefix);
  if (!existing) return null;
  if (!patch || typeof patch !== "object") return existing;
  const normalized = { ...patch };
  if (Object.hasOwn(normalized, "agent")) normalized.agent = normalizeTaskAssignee(normalized.agent);
  if (Object.hasOwn(normalized, "priority")) normalized.priority = normalizeTaskPriority(normalized.priority);
  if (Object.hasOwn(normalized, "reminder_frequency")) {
    normalized.reminder_frequency = normalizeTaskReminderFrequency(normalized.reminder_frequency);
  }
  appendEvent(storagePath, {
    id: existing.id,
    ts: nowIso(),
    op: "update",
    patch: normalized,
    ...(by ? { by } : {}),
  });
  return getTask(storagePath, existing.id);
}

/**
 * Move an open task to a column. `statuses` is the vocabulary to validate
 * against — omit it and the four built-ins apply.
 */
export function setTaskStatus(storagePath, idOrPrefix, status, { statuses, by = null } = {}) {
  const existing = getTask(storagePath, idOrPrefix);
  if (!existing) return null;
  appendEvent(storagePath, {
    id: existing.id,
    ts: nowIso(),
    op: "update",
    patch: { status: normalizeStatus(status, statuses) },
    ...(by ? { by } : {}),
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
export function addComment(storagePath, idOrPrefix, { by = null, text = "", mentions = [], meta = null } = {}) {
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
    ...(meta && typeof meta === "object" ? { meta } : {}),
  });
  return getTask(storagePath, existing.id);
}

/**
 * Make one task wait on another in the SAME project. Refuses (throws) a
 * missing target, a self-dependency and anything that would close a cycle —
 * a silent cycle is two tasks each waiting for the other forever.
 * Returns the projected task, or null when the task itself does not exist.
 */
export function addDependency(storagePath, idOrPrefix, { on, reason = null, owner = null, condition = null, by = null } = {}) {
  const existing = getTask(storagePath, idOrPrefix);
  if (!existing) return null;
  const target = getTask(storagePath, String(on || ""));
  if (!target) throw new Error(`dependency target not found in this project: ${on}`);
  if (target.id === existing.id) throw new Error("a task cannot depend on itself");
  if (existing.depends_on.some((d) => d.task_id === target.id)) return existing;
  // Would target (transitively) wait on this task already?
  const all = projectState(readAllEvents(storagePath));
  const seen = new Set();
  const stack = [target.id];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === existing.id) throw new Error(`that would make a cycle: ${target.id} already waits on ${existing.id}`);
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const d of all.get(cur)?.depends_on || []) stack.push(d.task_id);
  }
  appendEvent(storagePath, {
    id: existing.id, ts: nowIso(), op: "depend", target: target.id,
    reason: reason || null, owner: owner || null, condition: condition || null, by,
  });
  return getTask(storagePath, existing.id);
}

/**
 * Lift a wait. The reason is required: a dependency removed without one is a
 * blockage that disappeared and nobody can say why.
 */
export function removeDependency(storagePath, idOrPrefix, { on, reason, by = null } = {}) {
  const existing = getTask(storagePath, idOrPrefix);
  if (!existing) return null;
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!why) throw new Error("removeDependency: reason required");
  const target = existing.depends_on.find((d) => d.task_id === on || (String(on || "").length >= 3 && d.task_id.startsWith(on)));
  if (!target) throw new Error(`${existing.id} does not depend on ${on}`);
  appendEvent(storagePath, { id: existing.id, ts: nowIso(), op: "undepend", target: target.task_id, reason: why, by });
  return getTask(storagePath, existing.id);
}

/**
 * Record a decision somebody owes. `responsible` is "owner" or an agent slug.
 * Returns `{ task, decision }`, or null when the task does not exist.
 */
export function askDecision(storagePath, idOrPrefix, {
  question, options = [], recommendation = null, responsible = OWNER_ACTOR_ID,
  blocking = null, can_continue = null, by = null,
} = {}) {
  const existing = getTask(storagePath, idOrPrefix);
  if (!existing) return null;
  const q = typeof question === "string" ? question.trim() : "";
  if (!q) throw new Error("askDecision: question required");
  const decision_id = makeShortId("d");
  appendEvent(storagePath, {
    id: existing.id, ts: nowIso(), op: "ask", decision_id, question: q,
    options: (Array.isArray(options) ? options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 8),
    recommendation: recommendation || null,
    responsible: responsible || OWNER_ACTOR_ID,
    blocking: blocking || null,
    can_continue: can_continue || null,
    by,
  });
  const task = getTask(storagePath, existing.id);
  return { task, decision: task.decisions.find((d) => d.id === decision_id) };
}

function openDecision(storagePath, idOrPrefix, decisionId) {
  const existing = getTask(storagePath, idOrPrefix);
  if (!existing) return { existing: null };
  const d = existing.decisions.find((x) => x.id === decisionId);
  if (!d) throw new Error(`decision not found on ${existing.id}: ${decisionId}`);
  if (d.state !== "open") throw new Error(`decision ${decisionId} is already ${d.state}`);
  return { existing, decision: d };
}

/**
 * Answer an open decision. Only its responsible party — or the owner, who can
 * always decide — may answer. Answering changes neither state nor column: a
 * resolved question is not an approved task.
 */
export function answerDecision(storagePath, idOrPrefix, decisionId, { answer, choice = null, by = null } = {}) {
  const { existing, decision } = openDecision(storagePath, idOrPrefix, decisionId);
  if (!existing) return null;
  const text = typeof answer === "string" ? answer.trim() : "";
  if (!text) throw new Error("answerDecision: answer required");
  if (by !== OWNER_ACTOR_ID && by !== decision.responsible) {
    throw new Error(`only ${decision.responsible} (or the owner) can answer decision ${decisionId}`);
  }
  appendEvent(storagePath, { id: existing.id, ts: nowIso(), op: "decide", decision_id: decisionId, answer: text, choice, by });
  const task = getTask(storagePath, existing.id);
  return { task, decision: task.decisions.find((d) => d.id === decisionId) };
}

/** The question no longer applies. Reason required, like a lifted dependency. */
export function withdrawDecision(storagePath, idOrPrefix, decisionId, { reason, by = null } = {}) {
  const { existing } = openDecision(storagePath, idOrPrefix, decisionId);
  if (!existing) return null;
  const why = typeof reason === "string" ? reason.trim() : "";
  if (!why) throw new Error("withdrawDecision: reason required");
  appendEvent(storagePath, { id: existing.id, ts: nowIso(), op: "withdraw", decision_id: decisionId, reason: why, by });
  return getTask(storagePath, existing.id);
}

/** What happened when the decider was told remotely. One receipt per attempt. */
export function recordDecisionNotice(storagePath, taskId, decisionId, { channel = null, status, error = null } = {}) {
  appendEvent(storagePath, {
    id: taskId, ts: nowIso(), op: "decision_notice", decision_id: decisionId,
    channel, status, ...(error ? { error: String(error).slice(0, 300) } : {}),
  });
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

/**
 * Counts for status displays — the ONE aggregator behind the panel's summary
 * route, `apx task summary` and the agent's `list_tasks {summary:true}`, so the
 * three can never disagree about how many tasks a project has.
 */
export function countTasks(storagePath, { owner_name = null } = {}) {
  const tasks = [...projectState(readAllEvents(storagePath)).values()];
  const today = new Date().toISOString().slice(0, 10);
  const open = tasks.filter((t) => t.state === "open");
  const aliases = ownerAliasesFrom(owner_name);
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
    attention: {
      awaits_owner: open.filter((t) => awaitsOwner(t, aliases)).length,
      blocked_by_owner: open.filter((t) => blockedByOwner(t)).length,
    },
  };
}
