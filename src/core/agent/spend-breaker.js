// The spend breaker: a ceiling on what unwatched work may spend in an hour.
//
// 2026-09-23, 08:00–08:53: ~230 a2a turns between agents, every one a full tool
// loop, spent the ChatGPT plan, then Gemini, then Ollama cloud. Each turn on its
// own was reasonable. What nothing had was a view of the WHOLE — so the only
// thing that stopped it was the accounts running dry. quota.js reacts to one
// account being spent; this reacts to the volume itself, before any account is.
//
// It counts engine calls made by turns nobody is watching (a2a, routines — see
// isAutonomousChannel), globally and per project, over a rolling hour. Past a
// limit, unwatched work pauses for `pause_min` and the owner is told once. A
// person in a chat is never paused: they are the one who can see the spend.
//
// In memory on purpose: it is about the last hour, and a restart is already a
// pause. `apx usage resume` (POST /api/usage/breaker/resume) lifts it by hand.
import { isAutonomousChannel } from "./quota.js";

// `unwatched` is the caller's answer when it has one (see quota.js
// isUnwatchedTurn: a comment turn one agent started for another is unwatched on
// the web channel; a delegation the owner waits on is watched on a2a).
const counts = (channel, unwatched) => (typeof unwatched === "boolean" ? unwatched : isAutonomousChannel(channel));

export const SPEND_DEFAULTS = Object.freeze({
  enabled: true,
  // Engine calls, not turns: a turn is one call per tool round. A busy normal
  // hour here is a few dozen; the incident was well over a thousand.
  calls_per_hour: 400,
  project_calls_per_hour: 250,
  pause_min: 30,
});

const WINDOW_MS = 60 * 60 * 1000;
let calls = []; // { t, project }
let paused = null; // { until, scope, project, count, limit, noticed }
let listener = null;

/** The limits in effect: `super_agent.spend_breaker` over the defaults. */
export function spendLimits(config) {
  const raw = config?.super_agent?.spend_breaker || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    enabled: raw.enabled !== false,
    calls_per_hour: num(raw.calls_per_hour, SPEND_DEFAULTS.calls_per_hour),
    project_calls_per_hour: num(raw.project_calls_per_hour, SPEND_DEFAULTS.project_calls_per_hour),
    pause_min: num(raw.pause_min, SPEND_DEFAULTS.pause_min),
  };
}

// A pause that ran out starts a fresh hour. Keeping the calls that tripped it
// would trip it again on the very next one.
function expire(now) {
  if (paused && paused.until <= now) {
    // Only the calls that tripped it: a project pause ending must not erase
    // what every other project spent in the same hour.
    calls = paused.scope === "global" ? [] : calls.filter((c) => c.project !== paused.project);
    paused = null;
  }
}

function prune(now) {
  const from = now - WINDOW_MS;
  if (calls.length && calls[0].t < from) calls = calls.filter((c) => c.t >= from);
}

/** Who gets told when the breaker trips. Wired by the daemon at boot. */
export function onSpendTrip(fn) {
  listener = typeof fn === "function" ? fn : null;
}

/**
 * Count one engine call. Only unwatched channels count; anything else is a
 * no-op. Trips the breaker when this call crosses a limit.
 */
export function noteEngineCall({ channel, unwatched, project = null, config = null, now = Date.now() } = {}) {
  if (!counts(channel, unwatched)) return;
  const limits = spendLimits(config);
  if (!limits.enabled) return;
  expire(now);
  prune(now);
  const key = project == null ? null : String(project);
  // A call the pause refuses spends nothing: not counted. Only THAT call — a
  // pause on one project must not stop the count for every other one.
  if (paused && (paused.scope === "global" || paused.project === key)) return;
  calls.push({ t: now, project: key });

  const total = calls.length;
  const forProject = key == null ? 0 : calls.filter((c) => c.project === key).length;
  let trip = null;
  // A global trip outranks a project pause already in place; a second project
  // does not replace the first (one notice at a time).
  if (paused && paused.scope === "global") return;
  if (total > limits.calls_per_hour) trip = { scope: "global", project: null, count: total, limit: limits.calls_per_hour };
  else if (key != null && forProject > limits.project_calls_per_hour) {
    trip = { scope: "project", project: key, count: forProject, limit: limits.project_calls_per_hour };
  }
  if (!trip) return;
  if (paused && trip.scope === "project") return;
  paused = { ...trip, until: now + limits.pause_min * 60 * 1000, since: now, noticed: false };
  if (listener) {
    try {
      Promise.resolve(listener({ ...paused })).catch(() => {});
    } catch { /* a notifier must never break the call that tripped it */ }
  }
}

/**
 * The pause that applies to a turn on `channel` in `project`, or null. A turn
 * with a person in it is never paused.
 */
export function spendPause({ channel, unwatched, project = null, now = Date.now() } = {}) {
  if (!counts(channel, unwatched)) return null;
  expire(now);
  if (!paused) return null;
  if (paused.scope === "project" && String(project ?? "") !== paused.project) return null;
  return { ...paused };
}

/** The error a paused turn stops with. */
export function spendPauseError(p) {
  const at = new Date(p.until).toISOString().slice(11, 16);
  const where = p.scope === "project" ? `project ${p.project}` : "all projects";
  const err = new Error(
    `spend breaker: ${p.count} model calls by unwatched work in the last hour (${where}, limit ${p.limit}). ` +
    `Background work is paused until ${at} UTC; a person's own turns are not affected.`,
  );
  err.code = "SPEND_PAUSED";
  err.retryable = false;
  err.pause = p;
  return err;
}

/** True once per trip: the caller that gets it tells the owner. */
export function claimSpendNotice() {
  if (!paused || paused.noticed) return false;
  paused.noticed = true;
  return true;
}

/** Lift the pause by hand. The count restarts too, or it would trip again at once. */
export function resumeSpend() {
  const was = paused;
  paused = null;
  calls = [];
  return was;
}

/** What the breaker sees right now. */
export function spendState({ config = null, now = Date.now() } = {}) {
  prune(now);
  const byProject = {};
  for (const c of calls) if (c.project != null) byProject[c.project] = (byProject[c.project] || 0) + 1;
  const active = paused && paused.until > now ? { ...paused } : null;
  return { limits: spendLimits(config), calls_last_hour: calls.length, by_project: byProject, paused: active };
}

/** Test seam. */
export function _resetSpendBreaker() {
  calls = [];
  paused = null;
  listener = null;
}
