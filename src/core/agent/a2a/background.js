// Leaving work running, and being woken when it ends.
//
// `messagePeer` (./delegate.js) is one agent writing to another and AWAITING the
// answer. That is right when the answer is the next thing you need, and wrong
// when it is not: on 2026-09-11 the answer took ten minutes, and the sender had
// nothing to do for those ten minutes except be blocked — so it shelled out
// instead, got killed by run_shell's 60 s timeout over a message that had in
// fact been delivered, told the owner "sent ✅" off that failure, and closed its
// turn without ever seeing the reply.
//
// This module is the other half: launch the same exchange WITHOUT holding the
// sender's turn, and — when the peer finally answers — deliver that answer back
// to the sender as a new a2a message, which starts a fresh turn for it with the
// result in hand.
//
// THE WAKE-UP IS AN A2A IN REVERSE, and that is the whole design. There is no
// second turn engine here, no resumable run state, no new surface. `messagePeer`
// already runs the recipient's real tool loop, files both halves of the
// exchange, registers a watchable active turn, and hands the recipient the
// thread's own history — so a waiter woken this way reads its wake-up as the
// next message in a conversation it remembers, in the SAME thread the original
// request lives in. One place to look, for the owner and for both agents.
//
// WHY A FRESH TURN AND NOT A RESUMED ONE. Resuming needs the run's state on
// disk; `host/daemon/active-turns.js` states in its own header that turn state
// is in-memory and dies with the daemon, and `abortAllActiveTurns` spells out
// that it does not resume after a restart for exactly that reason. The cost of
// a fresh turn is that anything the agent held only in its working context is
// gone — which is why the tool's description tells the model to put what it
// will need into the message it sends, the same discipline `run_subagent`
// demands of its prompt.
import {
  openJob, readJob, closeJob, claimWake, countOpenJobs,
  MAX_OPEN_JOBS_PER_AGENT, DEFAULT_JOB_TIMEOUT_S, TERMINAL_STATUSES,
} from "#core/stores/background-jobs.js";
import { a2aThreadId } from "#core/stores/messages.js";
import { emitBackgroundJobEvent } from "#core/events/bus.js";
import { messagePeer } from "./delegate.js";

/**
 * How deep a chain of background hand-offs may go.
 *
 * Mirrors the wall `POST /projects/:pid/send` enforces on `_depth` for the HTTP
 * path. It is repeated rather than shared because the route's is a literal in a
 * hot file; consolidating the two into one a2a constant is worth doing and is
 * not worth doing inside this change.
 *
 * The count is only half the guard. The other half is structural and lives in
 * `deliverWake` below: a wake-up NEVER opens a job of its own, so a chain
 * cannot sustain itself on wake-ups alone regardless of depth.
 */
export const MAX_BACKGROUND_DEPTH = 3;

/**
 * The wake-up message.
 *
 * Written so the waiter cannot mistake it for the peer talking spontaneously,
 * and so a model reading it in a fresh context knows three things it would
 * otherwise have to guess: that this is the answer to something IT started,
 * what it had asked, and that the waiting is over so it should act rather than
 * wait again.
 *
 * The failure wording is deliberately blunt. The incident that produced this
 * module ended with an agent reporting success off a timeout — so a job that
 * did not produce an answer has to SAY it did not produce an answer, in the
 * same sentence as what to do about it.
 */
export function wakeText(job) {
  const asked = String(job.body || "").trim();
  const head = `[background job ${job.id}] The work you left running with ${job.to} has finished.`;
  const recap = asked ? `\n\nWhat you asked them:\n${asked.slice(0, 1200)}` : "";

  if (job.status === "done") {
    return (
      `${head}${recap}\n\nTheir answer:\n${String(job.result || "").slice(0, 6000)}\n\n` +
      `Pick up where you left off and act on this. You are not waiting on anything any more — ` +
      `if this closes the task, say so; if it opens the next step, take it.`
    );
  }

  // Cancelled is not a failure and must not read like one. An agent told "it
  // failed" goes looking for something to fix; an agent told "you were stopped"
  // asks what to do instead — and the second is the truth, so it is what gets
  // said. Retrying is explicitly off the table: somebody just decided this
  // should not run, and starting it again is the one reaction that overrules
  // them.
  if (job.status === "cancelled") {
    return (
      `${head.replace("has finished", "was CANCELLED")}${recap}\n\n` +
      `Why: ${job.result || "the owner stopped it"}.\n\n` +
      `There is no result, and nothing went wrong — somebody decided this should not run. ` +
      `Do NOT start it again and do NOT report it as done. Stop waiting on it, say plainly that it ` +
      `was cancelled, and ask what to do instead if you cannot continue without it.`
    );
  }

  const why = {
    failed: `it FAILED: ${job.result || "no reason recorded"}`,
    timed_out: `it ran past its ${job.timeout_s}s budget and was cut off`,
    lost: "the daemon restarted while it was running, so the work was lost and cannot be recovered",
  }[job.status] || `it ended as "${job.status}"`;

  return (
    `${head.replace("has finished", "did NOT produce an answer")}${recap}\n\n` +
    `What happened: ${why}.\n\n` +
    `There is no result to use. Do NOT report this as done, and do not claim you were answered. ` +
    `Decide whether to retry, to do it another way, or to tell whoever is waiting that it did not happen.`
  );
}

/**
 * Deliver a finished job's outcome to whoever is waiting on it.
 *
 * Claims first and sends second, never the other way round: a claim followed by
 * a failed send loses one wake-up, which is visible and recoverable; a send
 * followed by a failed claim wakes the agent twice, which makes it do the work
 * twice. See `claimWake`'s header for why the claim is a file and not a field.
 *
 * Never throws — every caller is a `.then()` or a reconciler tick, and an
 * un-awaited rejection here would take the daemon down.
 *
 * @returns {Promise<{delivered: boolean, reason?: string}>}
 */
export async function deliverWake(job, { project, config, projects, plugins, registries, messagePeerFn = messagePeer } = {}) {
  if (!job?.wake) return { delivered: false, reason: "job did not ask to be woken" };
  if (!project) return { delivered: false, reason: "no project to file the wake-up in" };
  if (!claimWake(job.id)) return { delivered: false, reason: "already delivered" };

  try {
    await messagePeerFn({
      project,
      // Reversed on purpose: the one who WORKED is now the one writing, so the
      // wake-up lands in the same thread as the request and reads as its reply.
      from: job.to,
      to: job.from,
      body: wakeText(job),
      config,
      projects,
      plugins,
      registries,
      // The chain keeps counting across the wake-up. Without this the woken
      // turn starts at zero and can hand the work straight back, which is the
      // ping-pong the depth wall exists to stop — and a wake-up is exactly
      // where it would restart, since it is a fresh turn either way.
      depth: (Number(job.depth) || 0) + 1,
    });
    return { delivered: true };
  } catch (e) {
    // The waiter did not wake. Say so where it can be seen rather than
    // swallowing it — the job record already holds the result, so nothing is
    // lost except the nudge, and the thread still carries the peer's answer.
    return { delivered: false, reason: e?.message || String(e) };
  }
}

/**
 * Stop a job somebody left running, and tell its waiter.
 *
 * THREE THINGS HAVE TO HAPPEN, in this order, and the order is the whole design:
 *
 *   1. The WORK stops. A background job's work is an ordinary a2a turn, keyed in
 *      the live-turn registry by its thread — so the same `abort` hook the Stop
 *      button pulls is what ends it. Without this, "cancel" would close a record
 *      while the peer kept burning tokens for another ten minutes: the panel
 *      would look right and the machine would be doing exactly what it was told
 *      not to.
 *   2. The RECORD closes as `cancelled` — not `failed`. Somebody decided this
 *      should not run; nothing went wrong.
 *   3. The WAITER hears it. This is the half that makes cancelling safe to
 *      offer: an agent that asked to be woken is, by construction, sitting in no
 *      turn at all. Cancel it silently and it waits for a result that is never
 *      coming, forever — the exact failure this whole feature was built to
 *      remove, reintroduced through its own stop button.
 *
 * `abortFn` is injected because core may not reach into the daemon's registry
 * (rule 8): the route passes `abortActiveTurn`, tests pass a spy.
 *
 * Never throws. Returns what happened, so a route can say which of the two
 * reasons it did nothing: no such job, or one that had already ended.
 */
export async function cancelJob(id, {
  reason = "",
  abortFn = null,
  project = null,
  config,
  projects,
  plugins,
  registries,
  messagePeerFn = messagePeer,
} = {}) {
  const job = readJob(id);
  if (!job) return { ok: false, reason: "no such job" };
  if (TERMINAL_STATUSES.includes(job.status)) {
    return { ok: false, reason: `job already ${job.status}`, job };
  }

  // 1. The work. Best-effort and reported, never fatal: a job whose turn this
  // daemon does not hold (it restarted, or the peer is a detached runtime) can
  // still be closed — the record is what the waiter is waiting on.
  let stopped = false;
  try {
    stopped = abortFn ? !!abortFn(job) : false;
  } catch {
    stopped = false;
  }

  // 2. The record. Said in the words the woken agent will read.
  const settled = closeJob(id, {
    status: "cancelled",
    result: reason || (stopped ? "the owner stopped it" : "the owner stopped it (its turn was no longer running)"),
  });
  if (!settled) return { ok: false, reason: "could not close the job", job };
  emitBackgroundJobEvent({ phase: "end", job: settled });

  // 3. The waiter. Claimed exactly once, like any other ending — a job the
  // reconciler and a cancel both reach must not wake anybody twice.
  let woken = { delivered: false, reason: "job did not ask to be woken" };
  if (settled.wake) {
    woken = await deliverWake(settled, { project, config, projects, plugins, registries, messagePeerFn });
  }
  return { ok: true, stopped, woken: woken.delivered, job: settled };
}

/**
 * Start an a2a exchange the sender does not wait for.
 *
 * Returns as soon as the job is open — the peer's turn runs un-awaited, and
 * when it lands the job is closed and (if asked) the sender is woken.
 *
 * @returns {{ok: true, job_id, thread, …} | {error: string, …}}
 *   An error is RETURNED, not thrown: this is reached from a tool handler, and a
 *   refusal the model can read and act on beats an exception it cannot.
 */
export function sendInBackground({
  project,
  from,
  to,
  body,
  wake = false,
  timeout_s = DEFAULT_JOB_TIMEOUT_S,
  depth = 0,
  config,
  projects,
  plugins,
  registries,
  messagePeerFn = messagePeer,
}) {
  if (!project) return { error: "background send: no project" };
  if (!from || !to) return { error: "background send: from and to are required" };

  if (depth >= MAX_BACKGROUND_DEPTH) {
    return {
      error:
        `background send: hand-off depth limit (${MAX_BACKGROUND_DEPTH}) reached. ` +
        `This chain of agents handing work to each other has gone as far as it may. Do the work directly, or answer with what you have.`,
    };
  }

  const open = countOpenJobs({ project_id: project.id ?? null, from });
  if (open >= MAX_OPEN_JOBS_PER_AGENT) {
    return {
      error:
        `background send: you already have ${open} jobs running (limit ${MAX_OPEN_JOBS_PER_AGENT}). ` +
        `Wait for one to come back before starting another — you will be woken when each finishes.`,
    };
  }

  const job = openJob({
    project_id: project.id ?? null,
    from,
    to,
    thread: a2aThreadId(from, to),
    body,
    wake,
    timeout_s,
    depth,
  });
  // Announced so a panel can show the agent working on something while its turn
  // carries on. Core emits and never listens (rule 8); the daemon's events-ws
  // bridge is what turns this into a frame.
  emitBackgroundJobEvent({ phase: "start", job });

  // Un-awaited on purpose — this is the whole point of the module. The promise
  // is safe detached because both arms settle the job and neither rethrows.
  Promise.resolve()
    .then(() => messagePeerFn({ project, from, to, body, config, projects, plugins, registries, depth }))
    .then(
      (result) => closeJob(job.id, { status: "done", result: result?.text || "" }),
      (e) => closeJob(job.id, { status: "failed", result: e?.message || String(e) }),
    )
    .then(async (settled) => {
      if (!settled) return;
      // Announced BEFORE the wake-up, so a panel stops showing the job as
      // running at the moment it stops running rather than at the moment the
      // woken agent finishes its own turn — which can be minutes later.
      emitBackgroundJobEvent({ phase: "end", job: settled });
      if (settled.wake) {
        await deliverWake(settled, { project, config, projects, plugins, registries, messagePeerFn });
      }
    })
    .catch(() => { /* settled above; nothing here may reach the process */ });

  return {
    ok: true,
    job_id: job.id,
    thread: job.thread,
    to: job.to,
    wake: job.wake,
    timeout_s: job.timeout_s,
    status: "running",
    note: wake
      ? `Left running. Do NOT wait for it and do NOT ask again — when ${to} answers you will be woken with the result as a new message on this thread. Carry on with something else, or close your turn.`
      : `Sent. ${to} is working on it; their answer lands on thread ${job.thread}. You will NOT be woken — say so if the owner is expecting the result.`,
  };
}
