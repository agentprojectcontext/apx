// Tasks (TODOs) per project.
//
// Append-only JSONL event log, one file per month under
//   ~/.apx/projects/<apxId>/tasks/YYYY-MM.jsonl
//
// Each line is a `{ id, ts, op, ... }` event. The current state of a task is
// the result of folding every event with that id in chronological order:
//
//   create — sets initial fields (title, body, tags, due, agent, source, meta)
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
}

function readAllEvents(storagePath) {
  const dir = tasksDir(storagePath);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
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
  return events;
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
          title: ev.title || "",
          body: ev.body || null,
          tags: Array.isArray(ev.tags) ? [...ev.tags] : [],
          due: ev.due || null,
          agent: ev.agent || null,
          source: ev.source || null,
          meta: ev.meta && typeof ev.meta === "object" ? { ...ev.meta } : {},
        });
        break;
      }
      case "update": {
        if (!existing) break;
        const patch = ev.patch && typeof ev.patch === "object" ? ev.patch : {};
        for (const k of Object.keys(patch)) {
          if (k === "id" || k === "state" || k === "created_at") continue;
          existing[k] = patch[k];
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
 * fields: { title (required), body?, tags?, due?, agent?, source?, meta? }
 */
export function createTask(storagePath, fields) {
  if (!fields || typeof fields !== "object") throw new Error("createTask: fields required");
  if (!fields.title || typeof fields.title !== "string") throw new Error("createTask: title required");
  const id = shortId();
  const ev = {
    id,
    ts: nowIso(),
    op: "create",
    title: fields.title.trim(),
    body: fields.body || null,
    tags: Array.isArray(fields.tags) ? fields.tags.filter((t) => typeof t === "string") : [],
    due: fields.due || null,
    agent: fields.agent || null,
    source: fields.source || null,
    meta: fields.meta && typeof fields.meta === "object" ? fields.meta : {},
  };
  appendEvent(storagePath, ev);
  return getTask(storagePath, id);
}

/** List tasks with optional filters. */
export function listTasks(storagePath, opts = {}) {
  const events = readAllEvents(storagePath);
  const tasks = [...projectState(events).values()];

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
  if (opts.due_before) {
    out = out.filter((t) => t.due && t.due <= opts.due_before);
  }
  if (opts.due_after) {
    out = out.filter((t) => t.due && t.due >= opts.due_after);
  }
  out.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  if (opts.limit && Number.isFinite(opts.limit)) {
    out = out.slice(0, opts.limit);
  }
  return out;
}

/** Get a single task by id or by id prefix (≥ 3 chars, must be unique). */
export function getTask(storagePath, idOrPrefix) {
  if (!idOrPrefix || typeof idOrPrefix !== "string") return null;
  const events = readAllEvents(storagePath);
  const tasks = projectState(events);
  if (tasks.has(idOrPrefix)) return tasks.get(idOrPrefix);
  if (idOrPrefix.length < 3) return null;
  const matches = [...tasks.values()].filter((t) => t.id.startsWith(idOrPrefix));
  if (matches.length === 1) return matches[0];
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
  return {
    open: tasks.filter((t) => t.state === "open").length,
    done: tasks.filter((t) => t.state === "done").length,
    dropped: tasks.filter((t) => t.state === "dropped").length,
    overdue: tasks.filter((t) => t.state === "open" && t.due && t.due < today).length,
    total: tasks.length,
  };
}
