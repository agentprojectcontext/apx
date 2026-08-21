// Signals — deterministic detection of things worth noticing.
//
// THE SPLIT THIS FILE EXISTS FOR: detection is cheap and mechanical; judgement
// is expensive and contextual. Mixing them means paying a language model every
// five minutes to conclude that nothing is happening. Everything here is a
// pure function over stored state — no model, no network, no clock beyond the
// `now` you pass in — so a watch routine that finds nothing costs nothing, and
// every rule below is testable with synthetic state.
//
// Thresholds are PARAMETERS, never constants. "Stale after 7 days" is a
// judgement about how someone works, and judgements belong to the profile.
//
// A signal is:
//   { type, project_id, project_name, severity, subject, detected_at, payload }
//
// `subject` is a one-line human phrasing — the detector already knows exactly
// what it found, and making the model re-derive it from payload fields is how
// summaries drift from the data they claim to describe.
import { listTasks } from "#core/stores/tasks.js";
import { listCommitments } from "#core/stores/commitments.js";
import { readProjectMessages } from "#core/stores/messages.js";
import { nowIso } from "#core/util/time.js";

/** Every detector, keyed by the type it emits. */
export const SIGNAL_TYPES = Object.freeze([
  "overdue_task",
  "blocked_task",
  "stale_project",
  "commitment_due",
  "overdue_commitment",
  "a2a_message",
]);

/** Defaults chosen to be quiet. A watcher that cries on day one gets turned off. */
export const DEFAULT_THRESHOLDS = Object.freeze({
  blocked_hours: 48,
  stale_project_days: 7,
  commitment_lead_hours: 48,
  /** Detectors to run. Empty = all of them. */
  types: [],
});

// ---------------------------------------------------------------------------
// detectors — each takes (project, opts) and returns Signal[]
// ---------------------------------------------------------------------------

/** A task whose due date has passed and which nobody closed. */
function detectOverdueTasks(project, { now }) {
  const today = now.slice(0, 10);
  return listTasks(project.storagePath, { state: "open" })
    .filter((t) => t.due && t.due < today)
    .map((t) =>
      signal(project, {
        type: "overdue_task",
        // A task one day late and one three weeks late are not the same event.
        severity: daysBetween(t.due, today) >= 7 ? "high" : "normal",
        subject: `"${t.title}" was due ${t.due}`,
        payload: { task_id: t.id, title: t.title, due: t.due, days_late: daysBetween(t.due, today) },
      }),
    );
}

/**
 * A task sitting in `blocked` long enough that nobody is coming back to it.
 *
 * Uses updated_at, not created_at: a task blocked this morning is a normal
 * working state, and flagging it would train the user to ignore the watcher.
 */
function detectBlockedTasks(project, { now, blocked_hours }) {
  const cutoff = new Date(Date.parse(now) - blocked_hours * 3_600_000).toISOString();
  return listTasks(project.storagePath, { state: "open", status: "blocked" })
    .filter((t) => (t.updated_at || t.created_at || "") < cutoff)
    .map((t) =>
      signal(project, {
        type: "blocked_task",
        severity: "normal",
        subject: `"${t.title}" has been blocked since ${(t.updated_at || t.created_at || "").slice(0, 10)}`,
        payload: { task_id: t.id, title: t.title, since: t.updated_at || t.created_at },
      }),
    );
}

/**
 * A project nobody has touched.
 *
 * WHAT "ACTIVITY" MEANS HERE: the newest task or commitment event in the
 * project's store. APX has no single per-project activity timestamp, and
 * folding every conversation on a five-minute tick would defeat the point of a
 * cheap detector. So this measures what it can actually see, and the phrasing
 * says so — "no task or commitment activity", not "nothing happened". A caller
 * with a better timestamp can pass `last_activity_at` and it wins.
 *
 * Claiming more than the data supports is the failure mode that kills trust in
 * a watcher: one confident "you have abandoned this" about a project the user
 * worked on all week, and they stop believing the rest.
 *
 * Deliberately ONE signal per project rather than per silent item — the point
 * is "you have forgotten about this", and saying it once is the whole message.
 *
 * A project with nothing recorded at all is skipped: a freshly registered
 * project is not neglected, and greeting someone with "this is stale" the day
 * they add it is exactly what gets a watcher muted.
 */
function detectStaleProject(project, { now, stale_project_days }) {
  const last = project.last_activity_at || lastRecordedActivity(project.storagePath);
  if (!last) return [];
  const days = daysBetween(last.slice(0, 10), now.slice(0, 10));
  if (days < stale_project_days) return [];
  const measured = project.last_activity_at ? "activity" : "task or commitment activity";
  return [
    signal(project, {
      type: "stale_project",
      severity: days >= stale_project_days * 3 ? "normal" : "low",
      subject: `no ${measured} on ${project.name || project.path || "this project"} for ${days} days`,
      payload: { days, last_activity_at: last, measured },
    }),
  ];
}

/** Newest task or commitment timestamp in a project store, or "" when empty. */
function lastRecordedActivity(storagePath) {
  let newest = "";
  const bump = (v) => { if (v && v > newest) newest = v; };
  try {
    for (const t of listTasks(storagePath, { state: "all" })) bump(t.updated_at || t.created_at);
  } catch { /* unreadable → treated as no evidence, not as staleness */ }
  try {
    for (const c of listCommitments(storagePath, { state: "all" })) bump(c.updated_at || c.created_at);
  } catch { /* same */ }
  return newest;
}

/** A promise coming due inside the lead window — still time to keep it. */
function detectCommitmentsDue(project, { now, commitment_lead_hours }) {
  const horizon = new Date(Date.parse(now) + commitment_lead_hours * 3_600_000).toISOString();
  return listCommitments(project.storagePath, { state: "open" })
    .filter((c) => c.due && c.due >= now && c.due <= horizon)
    .map((c) =>
      signal(project, {
        type: "commitment_due",
        // Higher than an equivalent task on purpose: someone is waiting, and a
        // warning that arrives in time is worth more than one that arrives after.
        severity: "high",
        subject: `you promised ${c.counterparty}: ${c.body} — due ${c.due.slice(0, 10)}`,
        payload: { commitment_id: c.id, counterparty: c.counterparty, due: c.due, body: c.body },
      }),
    );
}

/** A promise already past its date and still open. The costliest thing here. */
function detectOverdueCommitments(project, { now }) {
  return listCommitments(project.storagePath, { state: "open", overdue: true, now })
    .map((c) =>
      signal(project, {
        type: "overdue_commitment",
        severity: "critical",
        subject: `you owe ${c.counterparty}: ${c.body} — was due ${c.due.slice(0, 10)}`,
        payload: {
          commitment_id: c.id, counterparty: c.counterparty, due: c.due, body: c.body,
          days_late: daysBetween(c.due.slice(0, 10), now.slice(0, 10)),
        },
      }),
    );
}

/**
 * An agent-to-agent message that landed for this project since the last sweep.
 *
 * This is the seam that lets a2a "reach" {{owner_name}}: an a2a turn never pings
 * the owner directly (buildA2AReplySystem), it lands in the project's `a2a`
 * ledger channel. The watch picks the recent inbound ones up as signals, and —
 * because the watch now delivers to the profile's channel — the owner hears the
 * ones Roby judges worth it, timed and batched, instead of a raw ping per message.
 *
 * Only DIRECTION "in" (something another agent sent into this project), and only
 * since `a2a_since` (the watch's last run), so a message is surfaced once, not
 * re-raised every two hours. A promise buried in an a2a message is already
 * captured as a commitment by the a2a triage, so it resurfaces through the
 * commitment detectors — this detector is for everything that is not a promise.
 */
function detectA2A(project, { now, a2a_since }) {
  // No last run yet → a bounded window, so a first sweep does not dump history.
  const since = a2a_since || new Date(Date.parse(now) - 6 * 3_600_000).toISOString();
  let msgs = [];
  try {
    msgs = readProjectMessages(project.storagePath, { channel: "a2a", since, limit: 50 });
  } catch {
    return []; // unreadable ledger → no evidence, surfaced as a skip by the caller
  }
  return msgs
    .filter((m) => m.direction === "in" && (m.body || "").trim())
    .map((m) =>
      signal(project, {
        type: "a2a_message",
        severity: "normal",
        subject: `${m.author || "another agent"} sent (a2a): ${firstLine(m.body)}`,
        payload: { from: m.author, ts: m.ts, body: m.body },
      }),
    );
}

const DETECTORS = {
  overdue_task: detectOverdueTasks,
  blocked_task: detectBlockedTasks,
  stale_project: detectStaleProject,
  commitment_due: detectCommitmentsDue,
  overdue_commitment: detectOverdueCommitments,
  a2a_message: detectA2A,
};

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Run the configured detectors over the given projects.
 *
 * @param {{id, name?, path?, storagePath, last_activity_at?}[]} projects
 * @param {object} opts  thresholds + `types` + `now` (ISO, injectable for tests)
 * @returns {{ signals: object[], skipped: {id, error}[] }}
 */
export function detectSignals(projects, opts = {}) {
  const cfg = { ...DEFAULT_THRESHOLDS, ...opts, now: opts.now || nowIso() };
  const wanted = Array.isArray(cfg.types) && cfg.types.length
    ? cfg.types.filter((t) => t in DETECTORS)
    : SIGNAL_TYPES;

  const signals = [];
  const skipped = [];

  for (const project of projects || []) {
    if (!project?.storagePath) continue;
    for (const type of wanted) {
      try {
        signals.push(...DETECTORS[type](project, cfg));
      } catch (e) {
        // One unreadable log must not blank the whole sweep — and must not be
        // silent either, or the watcher reports "all clear" when it is blind.
        skipped.push({ id: project.id, type, error: e?.message || String(e) });
      }
    }
  }

  signals.sort(bySeverityThenDate);
  return { signals, skipped };
}

const SEVERITY_RANK = { critical: 0, high: 1, normal: 2, low: 3 };

function bySeverityThenDate(a, b) {
  const s = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
  if (s !== 0) return s;
  return String(a.subject).localeCompare(String(b.subject));
}

/**
 * Render signals as the block a routine hands the model.
 *
 * Pre-rendered rather than passed as JSON because the model's job here is
 * judgement — "is any of this worth interrupting for?" — not parsing.
 */
export function formatSignals(signals) {
  if (!signals?.length) return "";
  const lines = signals.map(
    (s) => `- [${s.severity}] ${s.project_name ? `${s.project_name}: ` : ""}${s.subject}`,
  );
  return lines.join("\n");
}

/** The highest severity present, for the interruption budget. */
export function peakSeverity(signals) {
  let best = "low";
  for (const s of signals || []) {
    if ((SEVERITY_RANK[s.severity] ?? 9) < (SEVERITY_RANK[best] ?? 9)) best = s.severity;
  }
  return signals?.length ? best : "low";
}

/** Thresholds from a profile's config, falling back to the defaults. */
export function thresholdsFromConfig(profileConfig = {}) {
  const pick = (key, fallback) => {
    const v = Number.parseInt(profileConfig[key], 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    blocked_hours: pick("blocked_task_hours", DEFAULT_THRESHOLDS.blocked_hours),
    stale_project_days: pick("stale_project_days", DEFAULT_THRESHOLDS.stale_project_days),
    commitment_lead_hours: pick("commitment_lead_hours", DEFAULT_THRESHOLDS.commitment_lead_hours),
  };
}

// ---------------------------------------------------------------------------

function signal(project, fields) {
  return {
    project_id: project.id ?? null,
    project_name: project.name || project.path || "",
    detected_at: nowIso(),
    ...fields,
  };
}

/** First non-empty line of a body, trimmed to a signal-sized preview. */
function firstLine(body) {
  const line = String(body || "").split("\n").map((s) => s.trim()).find(Boolean) || "";
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}

/** Whole days between two YYYY-MM-DD strings. Negative when `to` precedes `from`. */
function daysBetween(from, to) {
  const a = Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}
