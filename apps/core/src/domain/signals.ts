// The watcher's signals: plain facts read from the store with no model — a task past its due date, one waiting on the
// owner for days, a commitment about to fall due or already late, a project with open work and no movement, a task set
// up so it cannot move (see `brokenTask`). A watch routine calls its agent only when one of them is new, and the agent
// decides whether it is worth interrupting for.
import type { Task } from "@apx/protocol";
import type { Store } from "./store.ts";

/** Fixed thresholds; the rest come from the running profile (waiting hours, a commitment's lead, a quiet project). */
export const WATCH = {
  /** A task this many days late is serious. */
  lateDays: 7,
  /** The same signal is told again only after this long. */
  repeatHours: 24,
};

export type SignalKind =
  | "overdue_task"
  | "waiting_owner"
  | "commitment_due"
  | "overdue_commitment"
  | "stale_project"
  | "broken_task";
export type Severity = "low" | "normal" | "high" | "critical";
export type Signal = {
  /** Stable across runs ("overdue_task:tsk_…"): how a signal already told is recognized. */
  key: string;
  kind: SignalKind;
  severity: Severity;
  /** The project's name, or none for the owner's global work. */
  project?: string;
  subject: string;
};

const RANK: Record<Severity, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_OPEN = 500;

const isCommitment = (t: Task) => t.kind === "commitment" || Boolean(t.person_id);

/** Every signal in a project (or, without one, across all of them and the global work), most serious first. */
export function watchSignals(store: Store, o: { projectId?: string | undefined; now: Date }): Signal[] {
  const now = o.now.getTime();
  // The running profile's thresholds, when it has them; these defaults otherwise.
  const v = store.settings.read("profile").values;
  const num = (x: unknown, d: number) => (typeof x === "number" && x > 0 ? x : d);
  const lim = {
    waitingHours: num(v.waiting_hours, 48),
    commitmentLeadHours: num(v.commitment_lead_hours, 48),
    staleDays: num(v.stale_project_days, 7),
    lateDays: WATCH.lateDays,
  };
  const names = new Map(store.projects.list().map((p) => [p.id, p.name]));
  const scope = o.projectId ? [o.projectId] : undefined;
  const open = store.tasks.list({ ...(scope ? { projects: scope } : {}), state: "open", limit: MAX_OPEN });
  const where = (t: Task) => (t.project_id ? { project: names.get(t.project_id) ?? t.project_id } : {});
  const out: Signal[] = [];

  for (const t of open) {
    const due = t.due_at ? Date.parse(t.due_at) : Number.NaN;
    if (isCommitment(t) && !Number.isNaN(due)) {
      const who = t.person_name
        ? ` (${t.owed_by === "person" ? `${t.person_name} owes it` : `owed to ${t.person_name}`})`
        : "";
      if (due < now)
        out.push({
          key: `overdue_commitment:${t.id}`,
          kind: "overdue_commitment",
          severity: "critical",
          ...where(t),
          subject: `Commitment late: ${t.title}${who}`,
        });
      else if (due - now <= lim.commitmentLeadHours * HOUR)
        out.push({
          key: `commitment_due:${t.id}`,
          kind: "commitment_due",
          severity: "high",
          ...where(t),
          subject: `Commitment due ${t.due_at}: ${t.title}${who}`,
        });
      continue;
    }
    if (!Number.isNaN(due) && due < now) {
      const late = Math.floor((now - due) / DAY);
      out.push({
        key: `overdue_task:${t.id}`,
        kind: "overdue_task",
        severity: late >= lim.lateDays ? "high" : "normal",
        ...where(t),
        subject: `Overdue${late ? ` by ${late} day${late === 1 ? "" : "s"}` : ""}: ${t.title}`,
      });
    }
    if (t.awaits_owner && now - Date.parse(t.activity_at) >= lim.waitingHours * HOUR)
      out.push({
        key: `waiting_owner:${t.id}`,
        kind: "waiting_owner",
        severity: "normal",
        ...where(t),
        subject: `Waiting on the owner since ${t.activity_at}: ${t.title}`,
      });
  }

  const ids = new Set(open.map((t) => t.id));
  for (const t of open) {
    const broken = brokenTask(store, t, now, ids);
    if (broken)
      out.push({
        key: `broken_task:${broken.why}:${t.id}`,
        kind: "broken_task",
        severity: broken.severity,
        ...where(t),
        subject: `${broken.subject}: ${t.title}`,
      });
  }

  // A project goes quiet only while it has open work: an idle finished project is not news.
  const withWork = new Set(open.flatMap((t) => (t.project_id ? [t.project_id] : [])));
  const last = store.projects.lastActivity();
  for (const id of withWork) {
    const at = last.get(id);
    if (!at) continue;
    const days = Math.floor((now - Date.parse(at)) / DAY);
    if (days < lim.staleDays) continue;
    out.push({
      key: `stale_project:${id}`,
      kind: "stale_project",
      severity: days >= lim.staleDays * 3 ? "normal" : "low",
      project: names.get(id) ?? id,
      subject: `No movement for ${days} days, with open tasks`,
    });
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.subject.localeCompare(b.subject));
}

/** The signals not told in the last `repeatHours`, and the record to keep with them added (old ones pruned). */
export function freshSignals(
  signals: Signal[],
  seen: Record<string, string>,
  now: Date,
): { fresh: Signal[]; seen: Record<string, string> } {
  const at = now.getTime();
  const kept = Object.fromEntries(Object.entries(seen).filter(([, when]) => at - Date.parse(when) < 7 * DAY));
  const fresh = signals.filter((s) => !kept[s.key] || at - Date.parse(kept[s.key] ?? "") >= WATCH.repeatHours * HOUR);
  for (const s of fresh) kept[s.key] = now.toISOString();
  return { fresh, seen: kept };
}

/** The signals as lines for the agent: "- [high] Acme: Overdue by 3 days: Send the invoice". */
export const signalLines = (signals: Signal[]) =>
  signals.map((s) => `- [${s.severity}] ${s.project ? `${s.project}: ` : ""}${s.subject}`).join("\n");

/** In progress with nothing run on it for this long is no longer a stall (task-stall.ts): the owner should see it. */
const IDLE_DOING_DAYS = 2;
/** A start this far in the past that never began did not start by itself. */
const MISSED_START_HOURS = 1;

/**
 * What keeps an open task from moving, read from the store: an agent that is gone, nothing to start from, in progress
 * with nobody on it or idle for days, a reviewer that is gone, a start that never came, a parent already closed.
 */
function brokenTask(
  store: Store,
  t: Task,
  now: number,
  open: ReadonlySet<string>,
): { why: string; severity: Severity; subject: string } | undefined {
  if (isCommitment(t) || t.awaits_owner || t.proposed) return undefined;
  const agent = t.assignee ? store.agents.get(t.assignee) : undefined;
  if (t.assignee && !agent)
    return { why: "agent_gone", severity: "high", subject: "Assigned to an agent that no longer exists" };
  const chats = store.threads.byTask(t.id);
  if (agent && !t.description.trim() && !chats.length)
    return { why: "no_description", severity: "normal", subject: "Assigned with no description, so it never starts" };
  if (t.status === "doing" && !agent)
    return { why: "doing_nobody", severity: "normal", subject: "In progress with nobody on it" };
  if (t.status === "review" && t.reviewer && !store.agents.get(t.reviewer))
    return { why: "reviewer_gone", severity: "normal", subject: "In review by an agent that no longer exists" };
  if (agent && t.start_at && !chats.length && now - Date.parse(t.start_at) >= MISSED_START_HOURS * HOUR)
    return { why: "missed_start", severity: "normal", subject: `Its start (${t.start_at}) passed and it never began` };
  if (t.status === "doing" && chats.length) {
    const ended = chats
      .flatMap((c) => store.runs.list(c.id, 1))
      .map((r) => r.ended_at ?? "")
      .sort()
      .at(-1);
    const idle = ended ? Math.floor((now - Date.parse(ended)) / DAY) : 0;
    if (idle >= IDLE_DOING_DAYS && !store.threads.busy(chats.map((c) => c.id)))
      return { why: "idle", severity: "normal", subject: `In progress, but nothing has run on it for ${idle} days` };
  }
  if (t.parent_id && !open.has(t.parent_id) && store.tasks.get(t.parent_id)?.state !== "open")
    return { why: "parent_closed", severity: "low", subject: "Still open under a task already closed" };
  return undefined;
}
