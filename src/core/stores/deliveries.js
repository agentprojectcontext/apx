// The delivery queue — the "famoso delivery" made visible.
//
// When a routine run by a non-Roby agent leaves a message in the agent's own web
// chat, it also drops a DELIVERY here: a lightweight record that Manu has
// something waiting. This replaced the old a2a-message hack (an agent "chatting"
// with Roby cluttered the inbox and leaked the `super_agent` slug into the UI).
//
// A delivery is not a chat. It is a small, foldable event log you can look at to
// see what is piling up and what has been crossed off:
//
//   pending   — the agent left something; nobody has told Manu yet.
//   notified  — Roby reached Manu about it (immediately for a priority/anchor
//               delivery, or later from the sweep for an ordinary one).
//   answered  — Manu replied in the agent's chat (the delivery is done).
//   held      — the interruption budget deliberately withheld the notify.
//
// Append-only JSONL, one event per line; `listDeliveries` folds it to the
// current state per id. Appending never rewrites, so two writers (a routine run
// and the sweep) cannot race a file rewrite.
import fs from "node:fs";
import path from "node:path";
import { nowIso } from "#core/util/time.js";

const DELIVERIES_FILE = "deliveries.jsonl";

/** The one status a fold keeps per id, newest event wins. */
export const DELIVERY_STATUS = Object.freeze({
  PENDING: "pending",
  NOTIFIED: "notified",
  ANSWERED: "answered",
  HELD: "held",
});

function deliveriesPath(storagePath) {
  return path.join(storagePath, DELIVERIES_FILE);
}

function shortId(ts) {
  // Stable-ish, human-legible, and unique enough for a per-project queue: the
  // second-precision timestamp plus a short random suffix. crypto is a runtime
  // global; a failure just falls back to the timestamp alone.
  let suffix = "";
  try { suffix = crypto.randomUUID().slice(0, 6); } catch { suffix = String(Math.floor((Date.parse(ts) || 0) % 1e6)); }
  return `d_${suffix}`;
}

function appendEvent(storagePath, event) {
  if (!storagePath) return null;
  try {
    const file = deliveriesPath(storagePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(event) + "\n");
    return event;
  } catch {
    return null; // the queue is best-effort — losing a row must not fail the run
  }
}

/**
 * Record a new pending delivery. Returns its id (or null if it could not be
 * written) so the caller can mark it `notified`/`held` in the same run.
 */
export function recordDelivery(storagePath, { agent, agentName, routine, routineId, notify, priority = false, project_id = null }) {
  const ts = nowIso();
  const id = shortId(ts);
  const ok = appendEvent(storagePath, {
    id,
    ev: DELIVERY_STATUS.PENDING,
    ts,
    agent,
    agent_name: agentName || agent,
    routine: routine || "",
    routine_id: routineId || "",
    notify: notify || "",
    priority: !!priority,
    project_id,
  });
  return ok ? id : null;
}

/** Cross a delivery off (or move it along): notified / answered / held. */
export function markDelivery(storagePath, id, status, extra = {}) {
  if (!id) return false;
  return !!appendEvent(storagePath, { id, ev: status, ts: nowIso(), ...extra });
}

/**
 * The current queue, newest first. Folds the event log so each id appears once
 * with its latest status and the fields from its `pending` event. `status`
 * filters to one state; `limit` caps the result.
 */
export function listDeliveries(storagePath, { status, limit = 100 } = {}) {
  if (!storagePath) return [];
  let lines = [];
  try {
    lines = fs.readFileSync(deliveriesPath(storagePath), "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
  // Fold events per id. The `pending` event carries the descriptive fields;
  // every later event only moves the status. Events can arrive in any order, so
  // merge onto whatever is already there rather than overwrite.
  const byId = new Map();
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e?.id) continue;
    const prev = byId.get(e.id);
    if (e.ev === DELIVERY_STATUS.PENDING) {
      byId.set(e.id, {
        ...e,
        created_at: e.ts,
        status: prev?.status || DELIVERY_STATUS.PENDING,
        ...(prev?.updated_at ? { updated_at: prev.updated_at } : {}),
        ...(prev?.channel ? { channel: prev.channel } : {}),
      });
    } else {
      byId.set(e.id, {
        ...(prev || { id: e.id }),
        id: e.id,
        status: e.ev,
        updated_at: e.ts,
        ...(e.channel ? { channel: e.channel } : {}),
        ...(e.reason ? { reason: e.reason } : {}),
      });
    }
  }
  let out = [...byId.values()];
  if (status) out = out.filter((d) => d.status === status);
  out.sort((a, b) => String(b.created_at || b.ts || "").localeCompare(String(a.created_at || a.ts || "")));
  return out.slice(0, limit);
}
