// The nudge ledger — every unrequested message APX sent, and what the user
// thought of it.
//
// Path: ~/.apx/nudges.json
//
// Two reasons this is written down rather than kept in memory:
//   - a daily ceiling that resets on every daemon restart is not a ceiling;
//   - without a record of what was sent, "was that useful?" has nothing to
//     attach to, and the feedback loop is what stops the initiative from
//     decaying into noise the user mutes.
//
// Bounded on purpose: a file read on every push must not grow without limit.
import fs from "node:fs";
import path from "node:path";
import { NUDGES_PATH } from "#core/config/paths.js";

/** Entries kept. Roughly a year at three a day, minutes at pathological rates. */
const MAX_ENTRIES = 1000;

// A FUNCTION, not a shared constant: `{ ...EMPTY }` would copy the object but
// hand every caller the same `entries` array, so appends would accumulate in
// memory whatever the file said — a daily ceiling that quietly counted across
// wipes and restarts.
const empty = () => ({ version: 1, entries: [] });

export function readNudgeLedger() {
  try {
    const raw = JSON.parse(fs.readFileSync(NUDGES_PATH, "utf8"));
    if (!raw || typeof raw !== "object") return empty();
    return {
      version: raw.version || 1,
      entries: Array.isArray(raw.entries) ? raw.entries : [],
    };
  } catch {
    return empty();
  }
}

function writeNudgeLedger(ledger) {
  const entries = ledger.entries.slice(-MAX_ENTRIES);
  fs.mkdirSync(path.dirname(NUDGES_PATH), { recursive: true });
  fs.writeFileSync(NUDGES_PATH, JSON.stringify({ ...ledger, entries }, null, 2));
}

/**
 * Append a delivered nudge.
 *
 * Called AFTER the send succeeds: a message that never reached the user must
 * not spend their budget for the day.
 */
export function appendNudge(entry) {
  const ledger = readNudgeLedger();
  ledger.entries.push({
    id: entry.id,
    at: entry.at || new Date().toISOString(),
    kind: entry.kind || "unknown",
    project_id: entry.project_id ?? null,
    severity: entry.severity || "normal",
    channel: entry.channel || "telegram",
    chat_id: entry.chat_id != null ? String(entry.chat_id) : null,
    preview: String(entry.preview || "").slice(0, 200),
    bypassed_budget: entry.bypassed_budget === true,
    feedback: null,
  });
  writeNudgeLedger(ledger);
  return ledger.entries[ledger.entries.length - 1];
}

/**
 * Record what the user thought. Returns the updated entry, or null when the id
 * is unknown — a button pressed on a message older than the ledger window.
 */
export function setNudgeFeedback(nudgeId, { useful, note = "" } = {}) {
  const ledger = readNudgeLedger();
  const entry = ledger.entries.find((e) => e.id === nudgeId);
  if (!entry) return null;
  entry.feedback = {
    useful: useful === true,
    note: String(note || "").slice(0, 500),
    at: new Date().toISOString(),
  };
  writeNudgeLedger(ledger);
  return entry;
}

/** Entries sent on the same local calendar day as `date`. */
export function nudgesOnDay(date = new Date(), ledger = readNudgeLedger()) {
  const day = localDayKey(date);
  return ledger.entries.filter((e) => localDayKey(new Date(e.at)) === day);
}

/** Most recent entry matching a predicate, or null. */
export function lastNudge(predicate, ledger = readNudgeLedger()) {
  for (let i = ledger.entries.length - 1; i >= 0; i--) {
    if (predicate(ledger.entries[i])) return ledger.entries[i];
  }
  return null;
}

/** Newest first, optionally filtered. For the CLI and the panel. */
export function listNudges({ limit = 50, kind = "", project_id = "", with_feedback = null } = {}) {
  let rows = readNudgeLedger().entries.slice().reverse();
  if (kind) rows = rows.filter((e) => e.kind === kind);
  if (project_id) rows = rows.filter((e) => String(e.project_id) === String(project_id));
  if (with_feedback === true) rows = rows.filter((e) => e.feedback);
  if (with_feedback === false) rows = rows.filter((e) => !e.feedback);
  return rows.slice(0, Math.max(1, Number(limit) || 50));
}

/**
 * What the feedback adds up to. The point of collecting it is to be able to
 * answer "which kinds of interruption are worth sending".
 */
export function nudgeStats() {
  const entries = readNudgeLedger().entries;
  const byKind = {};
  for (const e of entries) {
    const k = (byKind[e.kind] ||= { kind: e.kind, sent: 0, useful: 0, noise: 0 });
    k.sent += 1;
    if (e.feedback?.useful === true) k.useful += 1;
    if (e.feedback?.useful === false) k.noise += 1;
  }
  return {
    total: entries.length,
    today: nudgesOnDay().length,
    rated: entries.filter((e) => e.feedback).length,
    by_kind: Object.values(byKind).sort((a, b) => b.sent - a.sent),
  };
}

/** Local calendar day — the user's day, not UTC's. */
function localDayKey(d) {
  if (Number.isNaN(d?.getTime?.())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Test-only: wipe the ledger. */
export function _resetNudgeLedger() {
  try { fs.rmSync(NUDGES_PATH, { force: true }); } catch { /* nothing to remove */ }
}
