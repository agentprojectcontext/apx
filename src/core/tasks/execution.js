// What is ACTUALLY happening on a task, separate from the column it sits in.
//
// `status: running` is a workflow label — someone (or some agent) put the card
// there. It has never certified that a process is alive, and a card left in
// "running" after its session ended read exactly like one being worked. This
// derives the execution view from evidence only:
//
//   · a runtime session linked to the task: a comment that names it with its
//     file (core/tasks/runtime-return.js writes `apc_session` + `session_path`),
//     so a session that ran in ANOTHER project's storage is still found
//   · an agent turn running on the thread right now (cascades.js)
//   · the last thing that happened (comment, session start, session end)
//
// and says "not verified" when the column claims work and nothing proves it.
// No progress percentages, no heartbeat-as-progress, and nothing here closes,
// approves or moves a task: exit 0 is not a functional approval.
import { readRuntimeSessionHead } from "#core/stores/runtime-sessions.js";
import { isTaskCascadeRunning } from "#core/tasks/cascades.js";
import { awaitsOwner, blockedByOwner, ownerAliasesFrom } from "#core/tasks/attention.js";
import { OWNER_ACTOR_ID } from "#core/constants/actors.js";

const RESULT_PREVIEW = 280;
const TEXT_PREVIEW = 160;

/**
 * The sessions this task's comments name, read by path and without blocking —
 * only those files, never a scan of every agent's history (this runs on a
 * polled request path). Newest first.
 */
export async function loadTaskSessions(task, read = readRuntimeSessionHead) {
  const paths = new Set();
  for (const c of task?.comments || []) if (c.meta?.apc_session && c.meta?.session_path) paths.add(c.meta.session_path);
  const rows = (await Promise.all([...paths].map((p) => read(p).catch(() => null)))).filter(Boolean);
  return rows.sort((a, b) => String(b.started || "").localeCompare(String(a.started || "")));
}

function sessionState(s) {
  if (!s) return "none";
  if (s.done) return s.failed ? "failed" : "finished";
  return s.abandoned ? "abandoned" : "running";
}

function sessionView(s) {
  if (!s) return null;
  return {
    id: s.id,
    runtime: s.runtime || null,
    agent: s.agent || null,
    started_at: s.started || null,
    finished_at: s.completed || null,
    ...(s.result ? { result: String(s.result).slice(0, RESULT_PREVIEW) } : {}),
  };
}

function lastActivity(task, session) {
  const events = [];
  const last = (task?.comments || []).at(-1);
  if (last) events.push({ at: last.ts, by: last.by || null, kind: "comment", text: String(last.text || "").slice(0, TEXT_PREVIEW) });
  if (session?.started) events.push({ at: session.started, by: session.runtime || null, kind: "session_started", text: null });
  if (session?.completed) events.push({ at: session.completed, by: session.runtime || null, kind: "session_finished", text: null });
  events.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return events[0] || null;
}

function waitingOn(task, ownerName) {
  if (task.state !== "open") return null;
  if ((task.decisions || []).some((d) => d.state === "open" && d.responsible === OWNER_ACTOR_ID)) return "owner_decision";
  if (awaitsOwner(task, ownerAliasesFrom(ownerName))) return "owner_reply";
  if (blockedByOwner(task)) return "owner";
  if (task.open_dependencies) return "dependency";
  if (task.status === "blocked") return "blocked";
  return null;
}

/**
 * The execution view of one task.
 *
 * @param {object} task         a full task (getTask), comments included
 * @param {object} opts
 * @param {string} opts.storagePath
 * @param {object[]} [opts.sessions]     from loadTaskSessions(task)
 * @param {boolean} [opts.agentWorking]  override the live-cascade lookup (tests)
 * @param {string|null} [opts.ownerName]  identity.json owner_name, for @mentions
 */
export function taskExecution(task, { storagePath, sessions = [], agentWorking, ownerName = null } = {}) {
  const latest = sessions[0] || null;
  const state = sessionState(latest);
  const working = agentWorking ?? isTaskCascadeRunning(storagePath, task.id);
  const live = working || state === "running";

  // The verdict is about EVIDENCE. "working" needs something alive; a column
  // that says running without it is reported as unverified, not as work.
  let verdict;
  if (task.state !== "open") verdict = "closed";
  else if (live) verdict = "working";
  else if (task.status === "running") verdict = "not_verified";
  else if (state === "finished" || state === "failed" || state === "abandoned") verdict = "ended";
  else verdict = "idle";

  return {
    verdict,
    workflow: {
      status: task.status,
      changed_at: task.status_changed_at || null,
      changed_by: task.status_changed_by || null,
    },
    agent_working: !!working,
    runtime: { state, session: sessionView(latest), count: sessions.length },
    last_activity: lastActivity(task, latest),
    waiting_on: waitingOn(task, ownerName),
  };
}
