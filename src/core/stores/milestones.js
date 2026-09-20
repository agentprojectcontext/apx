// Milestones per project — the steps a piece of work actually went through.
//
// WHAT THIS IS FOR. A chat where something real got built is a chat you cannot
// follow afterwards: forty turns, two hundred tool calls, and the answer to
// "where did the reel end up" buried somewhere in the middle. What a person
// wants back is not the transcript and not a prose summary of it — it is the
// SHAPE of the work: asked → analysed → rendered → delivered. Four lines for
// four hours.
//
// A MILESTONE IS DECLARED, NOT INFERRED. The honest way to get "the reel was
// analysed" is not to read two hundred tool rows afterwards and guess — that is
// a summarisation problem, it costs a model call per view, and two people
// opening the same chat get two different stories. It is for the agent to SAY
// so, at the moment the shape of the work changes, the same way it already
// records a commitment. One row in a JSONL, no model, and the record says what
// the agent believed it was doing rather than what a summariser guessed later.
//
// The floor under it is `core/milestones/derive.js`, which turns the turns
// themselves into steps with no model and no declaration at all. That is what
// makes this safe to depend on: a chat where the agent never declared anything
// still has a readable spine, so a forgotten `mark_milestone` costs detail and
// never the whole view.
//
// WHY A STORE AND NOT THE LEDGER. Anything written into a project's message
// JSONL comes back as a conversation turn on the next prompt build — that is
// how a2a tool rows once ate most of an agent's context. A milestone is a
// record ABOUT the conversation, so it lives beside it (tasks and commitments
// already do exactly this) and nothing replays it as something somebody said.
//
// On disk, append-only, one file per month:
//   ~/.apx/projects/<apxId>/milestones/YYYY-MM.jsonl
//
// Events:
//   start   — the step began (title, track?, channel, conversation_id, …)
//   update  — shallow-merge patch (retitle, add detail)
//   done    — it finished, and it worked
//   failed  — it finished, and it did not. Recorded, never hidden: a timeline
//             that only shows what succeeded cannot answer the one question it
//             exists for, which is what got left half-done.
//   drop    — filed by mistake. Not `failed`: nothing was ever attempted, so
//             counting it as a failure poisons the only number here worth
//             reading.
//
// State: "open" → "done" | "failed" | "dropped".
import fs from "node:fs";
import path from "node:path";
import { nowIso } from "../util/time.js";
import { shortId as makeShortId } from "../util/ids.js";

export const MILESTONE_STATES = Object.freeze(["open", "done", "failed", "dropped"]);

/** The terminal states, and the op that reaches each. Exported because the tool
 *  handler and the API both need to say "is this a closing word" without
 *  re-listing them and drifting. */
export const MILESTONE_CLOSING_OPS = Object.freeze({
  done: "done",
  failed: "failed",
  dropped: "drop",
});

/** How long a title may be. A milestone is a line in a rail, not a paragraph —
 *  past this it stops being scannable, which is the entire point of it. */
export const MILESTONE_TITLE_MAX = 120;

function milestonesDir(storagePath) {
  return path.join(storagePath, "milestones");
}

function monthlyFile(storagePath, date = new Date()) {
  const ym = date.toISOString().slice(0, 7); // YYYY-MM
  return path.join(milestonesDir(storagePath), `${ym}.jsonl`);
}

function shortId() {
  return makeShortId("m");
}

function appendEvent(storagePath, event) {
  const file = monthlyFile(storagePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(event) + "\n");
}

function readAllEvents(storagePath) {
  const dir = milestonesDir(storagePath);
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
      case "start": {
        if (existing) break; // duplicate start — keep the first
        rows.set(ev.id, {
          id: ev.id,
          state: "open",
          title: ev.title || "",
          track: ev.track || null,
          detail: ev.detail || null,
          started_at: ev.ts,
          updated_at: ev.ts,
          closed_at: null,
          note: null,
          channel: ev.channel || null,
          conversation_id: ev.conversation_id || null,
          thread_id: ev.thread_id || null,
          agent: ev.agent || null,
          created_by: ev.created_by || null,
          meta: ev.meta && typeof ev.meta === "object" ? { ...ev.meta } : {},
        });
        break;
      }
      case "update": {
        if (!existing) break;
        const patch = ev.patch && typeof ev.patch === "object" ? ev.patch : {};
        for (const k of Object.keys(patch)) {
          // The projection owns these: a patch that could rewrite the id or
          // back-date the start turns the log into something you cannot trust.
          if (k === "id" || k === "state" || k === "started_at" || k === "closed_at") continue;
          existing[k] = patch[k];
        }
        existing.updated_at = ev.ts;
        break;
      }
      case "done":
      case "failed":
      case "drop": {
        if (!existing) break;
        existing.state = ev.op === "drop" ? "dropped" : ev.op;
        existing.closed_at = ev.ts;
        existing.updated_at = ev.ts;
        if (ev.note) existing.note = ev.note;
        break;
      }
      default:
        break;
    }
  }
  return rows;
}

/**
 * Oldest first. A timeline reads forward — this is the one list here that is
 * NOT newest-first, and deliberately so.
 *
 * NO TIEBREAK ON ID, on purpose. Timestamps here have one-second resolution
 * (core/util/time.js), and an agent declaring three steps as it finishes a turn
 * writes all three inside the same second — so the tiebreak decides the order
 * the reader sees. An id tiebreak sorted them by a random suffix, which shuffled
 * the steps of exactly the fast turns this feature exists to explain.
 *
 * Comparing only the timestamp leaves ties to `sort`'s stability, and the array
 * being sorted comes out of the fold in append order. The log IS the order
 * things happened; nothing else needs to reconstruct it.
 */
function byOldest(a, b) {
  return (a.started_at || "").localeCompare(b.started_at || "");
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Open a milestone.
 *
 * `state` may be terminal on the way in: a step is very often recorded once it
 * is already over ("the material was analysed"), and forcing two calls for that
 * would mean half of them are never closed. Terminal states append the closing
 * event immediately, so the log still reads start-then-close and the fold above
 * needs no special case.
 *
 * fields: { title (required), track?, detail?, state?, note?, channel?,
 *           conversation_id?, thread_id?, agent?, created_by?, meta? }
 */
export function startMilestone(storagePath, fields) {
  if (!fields || typeof fields !== "object") throw new Error("startMilestone: fields required");
  const title = typeof fields.title === "string" ? fields.title.trim() : "";
  if (!title) throw new Error("startMilestone: title required");

  const state = fields.state || "open";
  if (!MILESTONE_STATES.includes(state)) {
    throw new Error(`startMilestone: unknown state "${state}" (use ${MILESTONE_STATES.join("|")})`);
  }

  const id = shortId();
  const ts = nowIso();
  appendEvent(storagePath, {
    id,
    ts,
    op: "start",
    title: title.slice(0, MILESTONE_TITLE_MAX),
    track: fields.track ? String(fields.track).trim().slice(0, MILESTONE_TITLE_MAX) : null,
    detail: fields.detail ? String(fields.detail) : null,
    channel: fields.channel || null,
    conversation_id: fields.conversation_id || null,
    thread_id: fields.thread_id || null,
    agent: fields.agent || null,
    created_by: fields.created_by || null,
    meta: fields.meta && typeof fields.meta === "object" ? fields.meta : {},
  });

  if (state !== "open") {
    appendEvent(storagePath, {
      id,
      ts,
      op: MILESTONE_CLOSING_OPS[state],
      note: fields.note || null,
    });
  }
  return getMilestone(storagePath, id);
}

/** Close one. `state` is the outcome, not a status: done | failed | dropped. */
export function closeMilestone(storagePath, idOrPrefix, state, note = null) {
  if (!MILESTONE_CLOSING_OPS[state]) {
    throw new Error(`closeMilestone: unknown state "${state}" (use done|failed|dropped)`);
  }
  const row = getMilestone(storagePath, idOrPrefix);
  if (!row) return null;
  appendEvent(storagePath, { id: row.id, ts: nowIso(), op: MILESTONE_CLOSING_OPS[state], note });
  return getMilestone(storagePath, row.id);
}

/** Shallow-merge a patch (retitle, add detail, move track). */
export function updateMilestone(storagePath, idOrPrefix, patch) {
  const row = getMilestone(storagePath, idOrPrefix);
  if (!row) return null;
  appendEvent(storagePath, { id: row.id, ts: nowIso(), op: "update", patch: patch || {} });
  return getMilestone(storagePath, row.id);
}

/**
 * One milestone by id, or by a >=3-character unique prefix — the same
 * affordance tasks and commitments give, because an id read off a list is
 * retyped by hand as often as it is copied.
 */
export function getMilestone(storagePath, idOrPrefix) {
  const wanted = String(idOrPrefix || "").trim();
  if (!wanted) return null;
  const rows = projectState(readAllEvents(storagePath));
  if (rows.has(wanted)) return rows.get(wanted);
  if (wanted.length < 3) return null;
  const hits = [...rows.values()].filter((r) => r.id.startsWith(wanted));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * List milestones, oldest first.
 *
 * @param {string} storagePath
 * @param {object} [filter]
 * @param {string|string[]} [filter.state]            one state or several
 * @param {string} [filter.conversation_id]           only this chat
 * @param {string} [filter.thread_id]                 only this ledger thread
 * @param {string} [filter.channel]
 * @param {string} [filter.agent]
 * @param {string} [filter.track]
 * @param {string} [filter.since]                     ISO lower bound on started_at
 * @param {number} [filter.limit]                     keep the newest N
 */
export function listMilestones(storagePath, filter = {}) {
  const states = filter.state
    ? new Set(Array.isArray(filter.state) ? filter.state : [filter.state])
    : null;
  let rows = [...projectState(readAllEvents(storagePath)).values()];

  if (states) rows = rows.filter((r) => states.has(r.state));
  if (filter.conversation_id) rows = rows.filter((r) => r.conversation_id === filter.conversation_id);
  if (filter.thread_id) rows = rows.filter((r) => r.thread_id === filter.thread_id);
  if (filter.channel) rows = rows.filter((r) => r.channel === filter.channel);
  if (filter.agent) rows = rows.filter((r) => r.agent === filter.agent);
  if (filter.track) rows = rows.filter((r) => r.track === filter.track);
  if (filter.since) rows = rows.filter((r) => (r.started_at || "") >= filter.since);

  rows.sort(byOldest);
  const limit = Number(filter.limit);
  return Number.isFinite(limit) && limit > 0 ? rows.slice(-limit) : rows;
}

/**
 * The counts a header can show without reading the rows.
 *
 * `open` and `failed` are the two that earn the summary line. A rail that only
 * counted total steps would be decoration; these two are the ones that mean
 * somebody still has to do something.
 */
export function milestoneStats(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    open: list.filter((r) => r.state === "open").length,
    done: list.filter((r) => r.state === "done").length,
    failed: list.filter((r) => r.state === "failed").length,
    dropped: list.filter((r) => r.state === "dropped").length,
  };
}
