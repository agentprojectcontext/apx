// Durable delivery of background-runtime callbacks.
//
// Pairs with core/stores/runtime-callbacks.js: call_runtime drops a pending
// "IOU" when it launches a runtime detached, and deletes it the moment the
// in-process fast path delivers. Whatever IOUs survive belong to runs whose
// spawning daemon died before delivering (crash, pull, or a task that restarted
// the daemon). This reconciler — run once at boot and on an interval — delivers
// those late, keying on the runtime SESSION being finished rather than on any
// in-memory promise. That's what makes the callback survive a restart, and also
// absorbs the "proactive" close: it doesn't care whether the daemon's own await
// or the runtime's `apx session close` marked the session done.
//
// Recovery delivery is a plain channel send of the session's recorded result
// (after a restart the full stdout is gone — only the one-line result the
// session close captured remains). The rich A2A relay (Roby re-voicing the
// result) stays the job of the live in-process path.
import {
  listPendingCallbacks,
  deletePendingCallback,
  readSessionState,
  updatePendingCallback,
} from "#core/stores/runtime-callbacks.js";
import { deliverRuntimeResultToTask } from "#core/tasks/runtime-return.js";
import { summonFromAgentComment } from "#core/tasks/comment-turn.js";
import { readConfig } from "#core/config/index.js";
import { canNudge, recordNudge } from "#core/nudge/index.js";

const GRACE_MS = 30_000;               // let the live in-process path win a fresh completion
const STALE_MS = 24 * 60 * 60 * 1000;  // drop IOUs for runs that never finished in a day

function sessionFailed(state) {
  const result = String(state.result || "").trim();
  return /error|⚠️/i.test(state.status) || /^(failed|error)/i.test(result);
}

function deliverText(entry, state) {
  const who = entry.who || entry.runtime || "runtime";
  const result = String(state.result || "").trim();
  const isError = sessionFailed(state);
  const head = isError
    ? `⚠️ La sesión de ${who} (\`${entry.session_id}\`) terminó con error${result ? `: ${result}` : ""}.`
    : `✅ Terminó la sesión de ${who} (\`${entry.session_id}\`).`;
  const text = !isError && result ? `${head}\n\n${result}` : head;
  return text.slice(0, 3800);
}

/**
 * A task-origin IOU (core/tasks/runtime-return.js): the result comment and the
 * coordinator summon, each done at most once — the IOU records which already
 * happened. A project or task that no longer exists is logged and dropped; the
 * result is still on the session record and its room.
 */
function reconcileTaskEntry(entry, state, { projects, plugins, registries, config, log, now, summon }) {
  const p = projects?.get?.(entry.project_id);
  if (!p?.storagePath) {
    log?.(`callback-reconciler: task return for ${entry.session_id} dropped — project ${entry.project_id} is gone`);
    deletePendingCallback(entry.session_id);
    return;
  }
  const failed = sessionFailed(state);
  const result = String(state.result || "").trim();
  const out = deliverRuntimeResultToTask({
    storagePath: p.storagePath,
    origin: { project_id: entry.project_id, task_id: entry.task_id, coordinator: entry.coordinator || null },
    runtime: entry.runtime || "runtime",
    sessionId: entry.session_id,
    ok: !failed,
    text: failed ? "" : result,
    error: failed ? result.replace(/^failed:\s*/i, "") || "sin detalle" : null,
    summon: (mentions) => summon({
      p, taskId: entry.task_id, mentions, author: entry.runtime || "runtime",
      projects, plugins, registries, config,
    }),
    progress: entry,
  });
  if (out.missing) log?.(`callback-reconciler: task ${entry.task_id} is gone; result of ${entry.session_id} stays on the session`);
  const age = now - Date.parse(entry.created || "");
  if (out.done || (Number.isFinite(age) && age > STALE_MS)) {
    deletePendingCallback(entry.session_id);
    if (out.done) log?.(`callback-reconciler: returned ${entry.session_id} to task ${entry.task_id}`);
  } else {
    updatePendingCallback(entry.session_id, out.state);
  }
}

/** One reconciliation pass. Best-effort per entry; a failure keeps the IOU for
 *  the next tick rather than dropping the callback. */
export async function reconcilePendingCallbacks({
  plugins, log, projects = null, registries = null, config = null,
  summon = summonFromAgentComment,
}) {
  const pending = listPendingCallbacks();
  if (!pending.length) return;
  const telegram = plugins?.get?.("telegram");
  const now = Date.now();

  for (const entry of pending) {
    try {
      if (entry.channel !== "telegram" && entry.channel !== "task") continue;
      const state = readSessionState(entry.session_path);

      if (!state.exists) {
        deletePendingCallback(entry.session_id); // session file gone → orphan IOU
        continue;
      }
      if (!state.done) {
        const age = now - Date.parse(entry.created || "");
        if (Number.isFinite(age) && age > STALE_MS) {
          log?.(`callback-reconciler: dropping stale pending ${entry.session_id} (never completed)`);
          deletePendingCallback(entry.session_id);
        }
        continue; // still running — check again next tick
      }

      // Finished. Give the live in-process path a grace window to win the
      // normal (no-restart) case, so we don't double-deliver.
      const compAge = now - Date.parse(state.completed || "");
      if (Number.isFinite(compAge) && compAge < GRACE_MS) continue;

      if (entry.channel === "task") {
        reconcileTaskEntry(entry, state, { projects, plugins, registries, config: config || readConfig(), log, now, summon });
        continue;
      }

      if (!telegram) continue; // telegram plugin not up this boot — retry next tick

      // PUSH PATH 4 OF 4. Declared SOLICITED, and that is a judgement worth
      // stating: the user launched this runtime and is waiting for its result.
      // Arriving late does not make it an interruption, and holding it back
      // for quiet hours would mean losing an answer they asked for. It still
      // passes through the gate so the audit is real and so a future policy
      // can reach it without hunting for a fifth path nobody remembered.
      const gate = canNudge(
        { kind: "session_result", severity: "normal", unsolicited: false, channel: "telegram" },
        readConfig(),
      );
      if (!gate.allowed) continue; // never today; retry next tick if it ever is

      await telegram.send({
        channel: entry.tg_channel || undefined,
        chat_id: entry.chat_id,
        text: deliverText(entry, state),
      });
      recordNudge(gate, { chat_id: entry.chat_id });
      deletePendingCallback(entry.session_id);
      log?.(`callback-reconciler: delivered late callback for ${entry.session_id} → chat ${entry.chat_id}`);
    } catch (e) {
      log?.(`callback-reconciler: delivery failed for ${entry.session_id}: ${e.message}`);
      // keep the IOU; next tick retries
    }
  }
}

/** Start the reconciler: one pass at boot (recovers anything a prior daemon
 *  left behind), then every `intervalMs`. Returns { stop }. */
export function startCallbackReconciler({ plugins, log, projects = null, registries = null, config = null, intervalMs = 30_000 }) {
  const tick = () => reconcilePendingCallbacks({ plugins, log, projects, registries, config }).catch(() => {});
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
