// A runtime session launched from a task reports back to THAT task.
//
// A coordinator summoned by a comment can delegate to Claude Code / Codex in the
// background and answer "I'll tell you when it's done". Before this, the result
// landed in the web day thread with no task id, the durable IOU only knew
// Telegram, and the task thread never heard back — the owner became the poller.
//
// The origin is TYPED and comes from the turn's context (channelMeta.task),
// never from tool arguments: a model must not be able to aim a result at a task
// it was not asked about. Delivery is three steps, recorded separately on the
// IOU so a crash resumes instead of repeating:
//
//   1. result comment on the task — idempotent per session (comment meta)
//   2. coordinator summoned to read it — at most once per session
//   3. IOU dropped
//
// The coordinator's follow-up turn runs under its own permissions and the
// thread's hourly cap; the callback authorizes nothing new.
import { addComment, getTask } from "#core/stores/tasks.js";

/** Longest result a comment carries; the full output stays on the session. */
const RESULT_MAX = 4000;

/** A usable origin, or null. */
export function taskOriginFrom(channelMeta) {
  const t = channelMeta?.task;
  if (!t || typeof t !== "object" || !t.task_id || t.project_id === undefined || t.project_id === null) return null;
  return {
    project_id: t.project_id,
    task_id: String(t.task_id),
    coordinator: t.coordinator ? String(t.coordinator) : null,
  };
}

/** Has this session already reported a phase on the task? */
function hasPhase(task, sessionId, phases) {
  return (task?.comments || []).some(
    (c) => c.meta?.apc_session === sessionId && phases.includes(c.meta?.runtime_phase),
  );
}

/** "Started", on the task — the link between the card and the session. */
export function postTaskRuntimeLaunch({ storagePath, origin, runtime, sessionId, cwd, sessionPath = null }) {
  const task = getTask(storagePath, origin.task_id);
  if (!task || hasPhase(task, sessionId, ["launched"])) return false;
  const by = origin.coordinator ? ` por @${origin.coordinator}` : "";
  addComment(storagePath, task.id, {
    by: runtime,
    text: `🚀 Sesión de ${runtime} lanzada en segundo plano${by} (\`${sessionId}\`)${cwd ? `\n📁 ${cwd}` : ""}`,
    // Not a summon: the launcher is the one who wrote it down.
    mentions: [],
    // `session_path` is how the task finds the record again even when the run
    // lived in another project's storage (core/tasks/execution.js).
    meta: { apc_session: sessionId, session_path: sessionPath, runtime, runtime_phase: "launched", coordinator: origin.coordinator },
  });
  return true;
}

/**
 * The result (or failure) as ONE comment on the task, addressed to the
 * coordinator. Returns `{ posted, duplicate, missing }`.
 */
export function postTaskRuntimeResult({ storagePath, origin, runtime, sessionId, ok, text, error, address = true, sessionPath = null }) {
  const task = getTask(storagePath, origin.task_id);
  if (!task) return { posted: false, duplicate: false, missing: true };
  if (hasPhase(task, sessionId, ["done", "failed"])) return { posted: false, duplicate: true, missing: false };
  const who = address && origin.coordinator ? origin.coordinator : null;
  const body = String(text || "").trim().slice(0, RESULT_MAX);
  const head = ok
    ? `✅ Terminó la sesión de ${runtime} (\`${sessionId}\`).`
    : `⚠️ La sesión de ${runtime} (\`${sessionId}\`) no terminó bien: ${error || "sin detalle"}.`;
  const tail = who
    ? ok
      ? `\n\n@${who} revisá el resultado y decidí el próximo paso.`
      : `\n\n@${who} revisá la causa y decidí si relanzar, corregir o pedir ayuda.`
    : "";
  addComment(storagePath, task.id, {
    by: runtime,
    text: `${head}${body ? `\n\n${body}` : ""}${tail}`,
    mentions: who ? [who] : [],
    meta: {
      apc_session: sessionId,
      session_path: sessionPath,
      runtime,
      runtime_phase: ok ? "done" : "failed",
      coordinator: origin.coordinator,
      ...(ok ? {} : { error: String(error || "").slice(0, 500) }),
    },
  });
  return { posted: true, duplicate: false, missing: false };
}

/**
 * Steps 1 and 2. `summon(mentions)` is the caller's bound
 * summonFromAgentComment (injected: comment-turn imports the tool registry,
 * which imports call_runtime, which imports this). `progress` is the IOU's
 * recorded state; the return value is what to write back to it.
 *
 * @returns {{ done: boolean, missing?: boolean, state: object }}
 */
export function deliverRuntimeResultToTask({ storagePath, origin, runtime, sessionId, ok, text, error, summon, progress = {}, sessionPath = null }) {
  const state = { ...progress };
  if (!state.result_posted_at) {
    const r = postTaskRuntimeResult({ storagePath, origin, runtime, sessionId, ok, text, error, sessionPath });
    if (r.missing) return { done: true, missing: true, state: { ...state, delivery_error: "task not found" } };
    state.result_posted_at = new Date().toISOString();
  }
  if (!origin.coordinator || state.coordinator_notified_at) return { done: true, state };
  const s = summon ? summon([origin.coordinator]) : { summoned: [], skipped: "no_summoner" };
  if (s?.summoned?.length) return { done: true, state: { ...state, coordinator_notified_at: new Date().toISOString() } };
  // A cascade still running on this thread, or the hourly cap: the comment is
  // there either way; try the summon again later instead of dropping it.
  return { done: false, state: { ...state, coordinator_skipped: s?.skipped || "unknown" } };
}
