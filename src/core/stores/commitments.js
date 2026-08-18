// Commitments per project.
//
// Append-only JSONL event log, one file per month under
//   ~/.apx/projects/<apxId>/commitments/YYYY-MM.jsonl
//
// A TASK is something to do. A COMMITMENT is something PROMISED TO A PERSON:
// it has a counterparty, a date you gave them, and the channel you said it on.
// Breaking one costs trust, not just throughput, and that is why it is a type
// and not a tag.
//
// The tag version is tempting and wrong. The day you want "everything I owe
// Ana" you would be substring-matching your way through task titles, and
// "kept" versus "renegotiated" — the distinction that tells you whether a
// relationship is fine — has nowhere to live at all.
//
// Events:
//   create        — the promise (counterparty, body, due, origin_channel, …)
//   update        — shallow-merge patch
//   kept          — delivered
//   missed        — the date passed without delivery. Recorded, not hidden:
//                   a system that quietly drops what you failed to do cannot
//                   tell you that you keep failing the same person.
//   renegotiate   — a NEW date, agreed with them. Distinct from missing:
//                   moving a date with someone is not the same as letting it
//                   slide, and the history keeps both.
//   drop          — filed by mistake. NOT the same as `missed`: nobody was
//                   ever waiting, so counting it as a broken promise would
//                   poison the only number that matters here. The events stay
//                   on disk; the row leaves the lists.
//
// State: "open" → "kept" | "missed" | "dropped" → (renegotiate reopens as
// "open" with a new due, keeping the previous date in `history`).
import fs from "node:fs";
import path from "node:path";
import { nowIso } from "../util/time.js";
import { shortId as makeShortId } from "../util/ids.js";

export const COMMITMENT_STATES = Object.freeze(["open", "kept", "missed", "dropped"]);

function commitmentsDir(storagePath) {
  return path.join(storagePath, "commitments");
}

function monthlyFile(storagePath, date = new Date()) {
  const ym = date.toISOString().slice(0, 7); // YYYY-MM
  return path.join(commitmentsDir(storagePath), `${ym}.jsonl`);
}

function shortId() {
  return makeShortId("c");
}

function appendEvent(storagePath, event) {
  const file = monthlyFile(storagePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(event) + "\n");
}

function readAllEvents(storagePath) {
  const dir = commitmentsDir(storagePath);
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
        // One bad write must not blank the projection.
      }
    }
  }
  events.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  return events;
}

function projectState(events) {
  const rows = new Map();
  for (const ev of events) {
    const existing = rows.get(ev.id);
    switch (ev.op) {
      case "create": {
        if (existing) break; // duplicate create — keep the first
        rows.set(ev.id, {
          id: ev.id,
          created_at: ev.ts,
          updated_at: ev.ts,
          state: "open",
          counterparty: ev.counterparty || "",
          body: ev.body || "",
          promised_at: ev.promised_at || ev.ts,
          due: ev.due || null,
          origin_channel: ev.origin_channel || null,
          origin_message_ref: ev.origin_message_ref || null,
          created_by: ev.created_by || null,
          // Every date this promise has ever had. Renegotiating twice is a
          // fact about the relationship, and it is only visible if kept.
          history: [],
          meta: ev.meta && typeof ev.meta === "object" ? { ...ev.meta } : {},
        });
        break;
      }
      case "update": {
        if (!existing) break;
        const patch = ev.patch && typeof ev.patch === "object" ? ev.patch : {};
        for (const k of Object.keys(patch)) {
          if (k === "id" || k === "state" || k === "created_at" || k === "history") continue;
          existing[k] = patch[k];
        }
        existing.updated_at = ev.ts;
        break;
      }
      case "kept": {
        if (!existing) break;
        existing.state = "kept";
        existing.closed_at = ev.ts;
        existing.note = ev.note || existing.note || null;
        existing.updated_at = ev.ts;
        break;
      }
      case "missed": {
        if (!existing) break;
        existing.state = "missed";
        existing.closed_at = ev.ts;
        existing.note = ev.note || existing.note || null;
        existing.updated_at = ev.ts;
        break;
      }
      case "drop": {
        if (!existing) break;
        existing.state = "dropped";
        existing.closed_at = ev.ts;
        existing.note = ev.note || existing.note || null;
        existing.updated_at = ev.ts;
        break;
      }
      case "renegotiate": {
        if (!existing) break;
        existing.history.push({
          due: existing.due,
          moved_at: ev.ts,
          note: ev.note || null,
        });
        existing.due = ev.due || existing.due;
        // Back to open: a renegotiated promise is a live promise with a new
        // date, not a closed one. "renegotiated" as a resting state would hide
        // it from every "what do I owe people" view.
        existing.state = "open";
        existing.renegotiated_count = (existing.renegotiated_count || 0) + 1;
        existing.updated_at = ev.ts;
        break;
      }
      default:
        break;
    }
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Record a promise.
 * fields: { counterparty (required), body (required), due?, promised_at?,
 *           origin_channel?, origin_message_ref?, created_by?, meta? }
 */
export function createCommitment(storagePath, fields) {
  if (!fields || typeof fields !== "object") throw new Error("createCommitment: fields required");
  if (!fields.counterparty || typeof fields.counterparty !== "string") {
    // The counterparty IS the type. Without it this is a task.
    throw new Error("createCommitment: counterparty required");
  }
  if (!fields.body || typeof fields.body !== "string") {
    throw new Error("createCommitment: body required");
  }
  const id = shortId();
  appendEvent(storagePath, {
    id,
    ts: nowIso(),
    op: "create",
    counterparty: fields.counterparty.trim(),
    body: fields.body.trim(),
    promised_at: fields.promised_at || nowIso(),
    due: fields.due || null,
    origin_channel: fields.origin_channel || null,
    origin_message_ref: fields.origin_message_ref || null,
    created_by: fields.created_by || null,
    meta: fields.meta && typeof fields.meta === "object" ? fields.meta : {},
  });
  return getCommitment(storagePath, id);
}

/** Newest first, id as tiebreak — same reasoning as tasks.js byNewest. */
function byNewest(a, b) {
  const t = (b.created_at || "").localeCompare(a.created_at || "");
  return t !== 0 ? t : String(b.id || "").localeCompare(String(a.id || ""));
}

/** Soonest deadline first; undated last. The order the anchors want. */
function byDue(a, b) {
  if (!a.due && !b.due) return byNewest(a, b);
  if (!a.due) return 1;
  if (!b.due) return -1;
  const d = a.due.localeCompare(b.due);
  return d !== 0 ? d : byNewest(a, b);
}

/**
 * List commitments.
 *
 * opts: { state, counterparty, due_before, due_after, overdue, updated_since,
 *         sort: "due"|"newest", limit }
 * Default state is "open" — the useful question is what you still owe.
 */
export function listCommitments(storagePath, opts = {}) {
  let out = [...projectState(readAllEvents(storagePath)).values()];

  if (opts.state && opts.state !== "all") {
    out = out.filter((c) => c.state === opts.state);
  } else if (!opts.state) {
    out = out.filter((c) => c.state === "open");
  }
  if (opts.counterparty) {
    // Case-insensitive substring: counterparty is free text, not a CRM key,
    // so "ana" must find "Ana Pérez" or the field is unusable.
    const needle = String(opts.counterparty).toLowerCase();
    out = out.filter((c) => String(c.counterparty).toLowerCase().includes(needle));
  }
  if (opts.due_before) out = out.filter((c) => c.due && c.due <= opts.due_before);
  if (opts.due_after) out = out.filter((c) => c.due && c.due >= opts.due_after);
  if (opts.overdue) {
    const now = opts.now || nowIso();
    out = out.filter((c) => c.state === "open" && c.due && c.due < now);
  }
  if (opts.updated_since) {
    out = out.filter((c) => (c.updated_at || c.created_at || "") >= opts.updated_since);
  }

  out.sort(opts.sort === "newest" ? byNewest : byDue);
  if (opts.limit && Number.isFinite(opts.limit)) out = out.slice(0, opts.limit);
  return out;
}

/**
 * The same query folded across registered projects. Mirrors
 * listTasksAcrossProjects — a chief of staff lives in the cross-project layer,
 * and a promise made in a meeting rarely knows which repo it belongs to.
 *
 * A project whose log is unreadable is SKIPPED, not fatal.
 */
export function listCommitmentsAcrossProjects(projects, opts = {}) {
  const { limit, ...perProject } = opts || {};
  const commitments = [];
  const skipped = [];

  for (const entry of projects || []) {
    if (!entry?.storagePath) continue;
    try {
      for (const c of listCommitments(entry.storagePath, perProject)) {
        commitments.push({
          ...c,
          project_id: entry.id,
          project_name: entry.name || entry.path || String(entry.id),
        });
      }
    } catch (e) {
      skipped.push({ id: entry.id, error: e?.message || String(e) });
    }
  }

  commitments.sort(opts.sort === "newest" ? byNewest : byDue);
  return {
    commitments: Number.isFinite(limit) && limit > 0 ? commitments.slice(0, limit) : commitments,
    skipped,
  };
}

/** Get one by id or unique id prefix (≥ 3 chars). */
export function getCommitment(storagePath, idOrPrefix) {
  if (!idOrPrefix || typeof idOrPrefix !== "string") return null;
  const rows = projectState(readAllEvents(storagePath));
  if (rows.has(idOrPrefix)) return rows.get(idOrPrefix);
  if (idOrPrefix.length < 3) return null;
  const matches = [...rows.values()].filter((c) => c.id.startsWith(idOrPrefix));
  return matches.length === 1 ? matches[0] : null;
}

export function patchCommitment(storagePath, idOrPrefix, patch) {
  const existing = getCommitment(storagePath, idOrPrefix);
  if (!existing) return null;
  if (!patch || typeof patch !== "object") return existing;
  appendEvent(storagePath, { id: existing.id, ts: nowIso(), op: "update", patch });
  return getCommitment(storagePath, existing.id);
}

/** Delivered. */
export function keepCommitment(storagePath, idOrPrefix, note = null) {
  return close(storagePath, idOrPrefix, "kept", note);
}

/** The date passed and it did not happen. */
export function missCommitment(storagePath, idOrPrefix, note = null) {
  return close(storagePath, idOrPrefix, "missed", note);
}

/**
 * Filed by mistake — take it off the board without calling it broken.
 *
 * Deliberately not `missed`: "you failed Ana" and "this was never a promise"
 * are different facts, and the second one must not show up in the first one's
 * count. The log keeps every event either way.
 */
export function dropCommitment(storagePath, idOrPrefix, note = null) {
  return close(storagePath, idOrPrefix, "drop", note);
}

function close(storagePath, idOrPrefix, op, note) {
  const existing = getCommitment(storagePath, idOrPrefix);
  if (!existing) return null;
  appendEvent(storagePath, { id: existing.id, ts: nowIso(), op, note: note || null });
  return getCommitment(storagePath, existing.id);
}

/**
 * A new date, agreed with them. Requires the new date: "renegotiated, no idea
 * until when" is how a promise disappears.
 */
export function renegotiateCommitment(storagePath, idOrPrefix, due, note = null) {
  if (!due) throw new Error("renegotiateCommitment: a new due date is required");
  const existing = getCommitment(storagePath, idOrPrefix);
  if (!existing) return null;
  appendEvent(storagePath, {
    id: existing.id, ts: nowIso(), op: "renegotiate", due, note: note || null,
  });
  return getCommitment(storagePath, existing.id);
}

/** Counts for status displays and anchors. */
export function countCommitments(storagePath, now = nowIso()) {
  const rows = [...projectState(readAllEvents(storagePath)).values()];
  const open = rows.filter((c) => c.state === "open");
  return {
    open: open.length,
    kept: rows.filter((c) => c.state === "kept").length,
    missed: rows.filter((c) => c.state === "missed").length,
    dropped: rows.filter((c) => c.state === "dropped").length,
    overdue: open.filter((c) => c.due && c.due < now).length,
    total: rows.length,
  };
}
