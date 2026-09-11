// Jobs whose promise nobody is holding any more.
//
// `sendInBackground` launches an a2a exchange un-awaited and wakes the sender
// when it lands. That works as long as the process holding the promise lives to
// see it land. Two ways it does not:
//
//   1. The daemon died mid-job — a crash, a pull, or `apx restart`, which is a
//      thing that happens here several times an hour. The WORK is gone with it
//      (core/stores/background-jobs.js says why it cannot be recovered), so the
//      only honest outcome is to tell the waiter that it never finished.
//   2. The job ran past its deadline and the arm that should have closed it
//      never did.
//
// Either way the failure mode without this file is the same one the whole
// feature exists to remove: an agent waiting forever for a result that is never
// coming, with nothing on any surface saying so.
//
// Runs once at boot — which is where case 1 is caught, because every job left by
// a previous daemon has a pid this machine no longer runs — and then on an
// interval for case 2. Same shape as ./callback-reconciler.js, which does this
// for detached `call_runtime` sessions.
import {
  listJobs, closeJob, ownerAlive, jobExpired, pruneJobs,
} from "#core/stores/background-jobs.js";
import { deliverWake } from "#core/agent/a2a/background.js";
import { emitBackgroundJobEvent } from "#core/events/bus.js";

/**
 * One reconciliation pass.
 *
 * Best-effort per job: a job that throws keeps its record so the next tick can
 * try again, rather than taking the sweep down with it.
 *
 * @returns {Promise<{closed: number, woken: number, pruned: number}>}
 */
export async function reconcileBackgroundJobs({
  projects, config, plugins, registries, log,
  // Injected in tests, the way `replyAsAgent` takes `runAgentTurnFn`: this
  // function's job is deciding WHICH jobs are dead and closing them, and that
  // is worth asserting without standing up an engine to answer the wake-up.
  deliverWakeFn = deliverWake,
} = {}) {
  const open = listJobs({ open_only: true });
  let closed = 0;
  let woken = 0;

  for (const job of open) {
    try {
      const alive = ownerAlive(job);
      const expired = jobExpired(job);
      // A live owner inside its budget is simply working. Leave it alone — this
      // sweep must never harvest a job that is still running.
      if (alive && !expired) continue;

      // A recycled pid can make a dead owner look alive; the deadline is what
      // catches that, which is why an expired job is closed regardless of what
      // `ownerAlive` claims.
      const status = alive ? "timed_out" : "lost";
      const reason = alive
        ? `ran past its ${job.timeout_s}s budget`
        : "the daemon holding it exited before it finished";

      const settled = closeJob(job.id, { status, result: reason });
      if (!settled) continue;
      closed++;
      // The same frame the live path sends when a job settles. A job harvested
      // here ended just as really as one that answered, and a panel still
      // showing it as running is the stale spinner this feature exists to kill.
      emitBackgroundJobEvent({ phase: "end", job: settled });
      log?.(`background-jobs: closed ${job.id} (${job.from} → ${job.to}) as ${status} — ${reason}`);

      if (!settled.wake) continue;
      const project = projects?.get?.(settled.project_id);
      if (!project) {
        log?.(`background-jobs: cannot wake ${settled.from} for ${job.id} — project ${settled.project_id} is gone`);
        continue;
      }
      const out = await deliverWakeFn(settled, {
        project,
        config: project.config || config,
        projects,
        plugins,
        registries,
      });
      if (out.delivered) {
        woken++;
        log?.(`background-jobs: woke ${settled.from} for ${job.id}`);
      } else if (out.reason !== "already delivered") {
        log?.(`background-jobs: wake for ${job.id} not delivered — ${out.reason}`);
      }
    } catch (e) {
      log?.(`background-jobs: pass failed for ${job.id}: ${e?.message || e}`);
      // Keep the record; next tick retries.
    }
  }

  let pruned = 0;
  try {
    pruned = pruneJobs({ days: 7 });
  } catch { /* pruning is housekeeping, never a reason to fail a pass */ }

  return { closed, woken, pruned };
}

/**
 * Start the reconciler: one pass now (recovering whatever a prior daemon left
 * behind), then every `intervalMs`. Returns { stop }.
 *
 * The timer is unref'd so it never holds the process open on its own — the same
 * treatment startCallbackReconciler gives its own.
 */
export function startBackgroundJobsReconciler({ projects, config, plugins, registries, log, intervalMs = 60_000 }) {
  const tick = () =>
    reconcileBackgroundJobs({ projects, config, plugins, registries, log })
      .catch((e) => log?.(`background-jobs: tick failed: ${e?.message || e}`));
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
