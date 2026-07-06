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
import { listPendingCallbacks, deletePendingCallback, readSessionState } from "#core/stores/runtime-callbacks.js";

const GRACE_MS = 30_000;               // let the live in-process path win a fresh completion
const STALE_MS = 24 * 60 * 60 * 1000;  // drop IOUs for runs that never finished in a day

function deliverText(entry, state) {
  const who = entry.who || entry.runtime || "runtime";
  const result = String(state.result || "").trim();
  const isError = /error|⚠️/i.test(state.status) || /^(failed|error)/i.test(result);
  const head = isError
    ? `⚠️ La sesión de ${who} (\`${entry.session_id}\`) terminó con error${result ? `: ${result}` : ""}.`
    : `✅ Terminó la sesión de ${who} (\`${entry.session_id}\`).`;
  const text = !isError && result ? `${head}\n\n${result}` : head;
  return text.slice(0, 3800);
}

/** One reconciliation pass. Best-effort per entry; a failure keeps the IOU for
 *  the next tick rather than dropping the callback. */
export async function reconcilePendingCallbacks({ plugins, log }) {
  const pending = listPendingCallbacks();
  if (!pending.length) return;
  const telegram = plugins?.get?.("telegram");
  const now = Date.now();

  for (const entry of pending) {
    try {
      if (entry.channel !== "telegram") continue; // only telegram delivery for now
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

      if (!telegram) continue; // telegram plugin not up this boot — retry next tick
      await telegram.send({
        channel: entry.tg_channel || undefined,
        chat_id: entry.chat_id,
        text: deliverText(entry, state),
      });
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
export function startCallbackReconciler({ plugins, log, intervalMs = 30_000 }) {
  const tick = () => reconcilePendingCallbacks({ plugins, log }).catch(() => {});
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
