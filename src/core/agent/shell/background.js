// A command the agent left running, and the promise to wake it when that ends.
//
// WHY THIS EXISTS. `run_shell` awaits its command: the turn is held until the
// command exits, and a timer kills it at 60 s by default and 600 s at the
// absolute most. That is right for `ls` and wrong for everything that takes
// real time — a render, a batch encode, a build, a training run. An agent asked
// to make thirteen reels had exactly two options, and both were bad: hold its
// turn open per reel and say nothing for twenty minutes, or take the SIGTERM at
// ten and report whatever the truncated output looked like. Manu, 2026-09-14,
// watching a chat where neither was happening: "no te veo ejecutar tools que
// estén haciendo reels".
//
// So this is `sendInBackground` (../a2a/background.js) for a process instead of
// a peer, and deliberately the same shape: the same store, the same fan-out
// wall, the same panel, the same wake-up. An agent that already knows how to
// leave work with another agent does not have to learn a second idea.
//
// THREE THINGS IT ADDS, all of which exist because the worker is a process:
//
//   1. THE OUTPUT IS THE ONLY PROGRESS THERE IS. A peer's turn reports when it
//      is done; a render prints as it goes. The tail of that output is written
//      back onto the record as it arrives (throttled) so the panel can show a
//      line that MOVES — which is the whole of what was asked for — and the full
//      stream goes to a log file beside the record, because 4 000 characters is
//      a progress indicator and not a debuggable record.
//   2. IT IS KILLABLE. `detached: true` makes the child a process-group leader,
//      so cancelling signals `-pid` and takes the whole tree with it. Without
//      the group, killing `sh -lc "ffmpeg …"` kills the shell and leaves ffmpeg
//      running: the panel would say stopped and the fans would say otherwise.
//   3. IT OUTLIVES US, and that is on purpose. A detached child survives a
//      daemon restart — `apx restart` happens here several times an hour, and
//      losing a twenty-minute render to one would be worse than the alternative.
//      What does NOT survive is our knowledge of it: the reconciler closes the
//      record `lost`, and the wake-up says exactly that rather than inventing an
//      outcome. Half-true is the most this can honestly promise, so it says so.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  openJob, readJob, updateJob, closeJob, countOpenJobs, jobLogPath,
  JOB_KINDS, MAX_OPEN_JOBS_PER_AGENT, DEFAULT_JOB_TIMEOUT_S, TERMINAL_STATUSES,
} from "#core/stores/background-jobs.js";
import { emitBackgroundJobEvent } from "#core/events/bus.js";

/** The longest a background command may run. Six hours: long enough for a batch
 *  render nobody wants to babysit, short enough that a hung process is reaped
 *  the same day it hangs. */
export const MAX_SHELL_JOB_TIMEOUT_S = 6 * 3600;

/** How much of the output rides on the record. Enough for a progress line and
 *  the last error, not enough to turn a job file into a log — the log file is
 *  the log. */
export const SHELL_TAIL_MAX = 4000;

/** How often the tail is written back while output is flowing. A render prints
 *  hundreds of lines a second; a write per line would be a write per line. */
const PROGRESS_MS = 2000;

/** How long a killed process gets to die politely before SIGKILL. */
const KILL_GRACE_MS = 5000;

/**
 * The children this daemon spawned, by job id.
 *
 * Cancelling kills through THIS map and never through the pid on the record,
 * and the difference matters: a job left by a previous daemon has a pid this
 * machine may have recycled onto something else entirely, and `kill(-pid)` on a
 * recycled group is how a stop button comes to kill somebody's editor. A job
 * this process does not hold is not cancellable — the reconciler closes it
 * instead.
 */
const live = new Map();

/** Keep the last `SHELL_TAIL_MAX` characters of whatever has been printed. */
function appendTail(tail, chunk) {
  const next = tail + chunk;
  return next.length > SHELL_TAIL_MAX ? next.slice(next.length - SHELL_TAIL_MAX) : next;
}

/** Signal a job's whole process group. Best-effort by construction: the group
 *  may have exited between the decision and the syscall. */
function signalGroup(pid, signal) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop a running shell job's process tree. Returns whether anything was signalled.
 *
 * The `abortFn` half of `cancelJob` for shell work — the counterpart of
 * `abortActiveTurn` for an a2a job. Closing the RECORD is not this function's
 * business; `cancelJob` does that, in the order its header sets out.
 */
export function killShellJob(job) {
  const entry = live.get(job?.id);
  if (!entry) return false;
  const sent = signalGroup(entry.pid, "SIGTERM");
  // The second signal is not optional in practice: ffmpeg and anything wrapping
  // it will finish the frame it is on, and some tools trap SIGTERM and keep
  // going. A stop button that leaves the work running is not a stop button.
  entry.killTimer = setTimeout(() => signalGroup(entry.pid, "SIGKILL"), KILL_GRACE_MS);
  entry.killTimer.unref?.();
  return sent;
}

/** Is this job's process still held by this daemon? */
export function shellJobIsLive(id) {
  return live.has(id);
}

/**
 * What the agent reads when the command ends.
 *
 * Same contract as the a2a wake-up (see ../a2a/background.js `wakeText`): it
 * names the job, recalls what was asked, states the outcome in words that
 * cannot be read as success, and says what to do next. The recap matters more
 * here than there — the agent is woken in a fresh turn and the command it ran
 * twenty minutes ago is not in its context any more.
 */
export function shellWakeText(job) {
  const where = job.cwd ? ` (in ${job.cwd})` : "";
  const recap = `\n\nWhat you ran${where}:\n\`\`\`\n${String(job.command || "").slice(0, 1200)}\n\`\`\``;
  const log = job.log_path ? `\n\nFull output: ${job.log_path}` : "";
  const tail = String(job.tail || job.result || "").trim();
  const output = tail ? `\n\nLast output:\n\`\`\`\n${tail.slice(-3000)}\n\`\`\`` : "";
  const head = `[background job ${job.id}] The command you left running has finished.`;

  if (job.status === "done") {
    return (
      `${head}${recap}\n\nIt exited 0.${output}${log}\n\n` +
      `Pick up where you left off and act on this. You are not waiting on anything any more — ` +
      `if this was the last step, say so; if it opens the next one, take it.`
    );
  }

  if (job.status === "cancelled") {
    return (
      `${head.replace("has finished", "was CANCELLED")}${recap}\n\n` +
      `Why: ${job.result || "the owner stopped it"}.${output}${log}\n\n` +
      `The process was killed and it did not finish. Nothing went wrong — somebody decided this ` +
      `should not run. Do NOT start it again and do NOT report it as done. Say plainly that it was ` +
      `cancelled, and ask what to do instead if you cannot continue without it.`
    );
  }

  const why = {
    failed: `it exited ${job.exit_code == null ? "non-zero" : job.exit_code}${job.result && job.exit_code == null ? `: ${job.result}` : ""}`,
    timed_out: `it ran past its ${job.timeout_s}s budget and was killed`,
    // The honest version of "lost" for a process: detached children outlive the
    // daemon, so the work may well have finished — we simply stopped watching,
    // and an agent told "it is gone" would redo work that is sitting on disk.
    lost: "the daemon restarted while it was running, so I stopped watching it. The process may have kept going and finished, or it may not have — I cannot tell you which",
  }[job.status] || `it ended as "${job.status}"`;

  return (
    `${head.replace("has finished", "did NOT finish cleanly")}${recap}\n\n` +
    `What happened: ${why}.${output}${log}\n\n` +
    `Do NOT report this as done. Check whatever it was supposed to produce before you say anything ` +
    `about it — the files on disk are the truth here — then decide whether to retry, do it another ` +
    `way, or tell whoever is waiting that it did not happen.`
  );
}

/**
 * Launch a command the caller does not wait for.
 *
 * Returns the moment the child is spawned. The process runs un-awaited; when it
 * exits the job is closed and a `background_job` end event is emitted, which is
 * what the daemon's wake-up listens for. Nothing here reaches into a turn: this
 * module opens a record and runs a process, and every consequence of the record
 * ending belongs to whoever is listening.
 *
 * @returns {{ok: true, job_id, …} | {error: string}}
 *   An error is RETURNED, not thrown — a tool handler's caller is a model, and a
 *   refusal it can read beats an exception it cannot.
 */
export function runShellInBackground({
  project,
  from,
  command,
  cwd,
  timeout_s = DEFAULT_JOB_TIMEOUT_S,
  wake = true,
  origin = null,
  spawnFn = spawn,
}) {
  if (!project) return { error: "background shell: no project" };
  if (!from) return { error: "background shell: no agent to wake" };
  if (!command) return { error: "background shell: command required" };

  const open = countOpenJobs({ project_id: project.id ?? null, from });
  if (open >= MAX_OPEN_JOBS_PER_AGENT) {
    return {
      error:
        `background shell: you already have ${open} jobs running (limit ${MAX_OPEN_JOBS_PER_AGENT}). ` +
        `Wait for one to finish before starting another — you will be woken as each one lands. ` +
        `If these are independent pieces of one batch, run them in the jobs you have rather than asking for a fourth.`,
    };
  }

  const ttl = Math.max(1, Math.min(Number(timeout_s) > 0 ? Number(timeout_s) : DEFAULT_JOB_TIMEOUT_S, MAX_SHELL_JOB_TIMEOUT_S));
  const job = openJob({
    project_id: project.id ?? null,
    kind: JOB_KINDS.SHELL,
    from,
    // The command IS the body: it is what the panel shows, what the wake-up
    // recalls, and the only description of this work that exists.
    body: command,
    command,
    cwd: cwd || null,
    wake: !!wake,
    timeout_s: ttl,
    origin,
  });

  const logPath = jobLogPath(job.id);
  let log = null;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    log = fs.createWriteStream(logPath, { flags: "a" });
    log.on("error", () => { log = null; });
  } catch {
    log = null; // a job without a log file is still a job
  }

  let child;
  try {
    child = spawnFn("sh", ["-lc", command], {
      cwd: cwd || undefined,
      env: process.env,
      // A process group of its own, so cancelling reaches the whole tree.
      detached: true,
    });
  } catch (e) {
    const settled = closeJob(job.id, { status: "failed", result: `could not start: ${e?.message || e}` });
    emitBackgroundJobEvent({ phase: "end", job: settled || job });
    return { error: `background shell: could not start the command — ${e?.message || e}` };
  }

  const entry = { pid: child.pid, child, killTimer: null };
  live.set(job.id, entry);

  let tail = "";
  let flushedAt = 0;
  let timedOut = false;

  const flush = (force = false) => {
    if (!force && Date.now() - flushedAt < PROGRESS_MS) return;
    flushedAt = Date.now();
    const updated = updateJob(job.id, { tail });
    if (updated) emitBackgroundJobEvent({ phase: "progress", job: updated });
  };

  const onChunk = (d) => {
    const text = d.toString();
    tail = appendTail(tail, text);
    try { log?.write(text); } catch { /* the log is a convenience, never the job */ }
    flush();
  };
  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);

  const started = updateJob(job.id, { pid: child.pid });
  emitBackgroundJobEvent({ phase: "start", job: started || job });

  const timer = setTimeout(() => {
    timedOut = true;
    signalGroup(child.pid, "SIGTERM");
    entry.killTimer = setTimeout(() => signalGroup(child.pid, "SIGKILL"), KILL_GRACE_MS);
    entry.killTimer.unref?.();
  }, ttl * 1000);
  timer.unref?.();

  child.on("error", (e) => { tail = appendTail(tail, `\n[apx] ${e?.message || e}\n`); });

  child.on("close", (code, signal) => {
    clearTimeout(timer);
    if (entry.killTimer) clearTimeout(entry.killTimer);
    live.delete(job.id);
    try { log?.end(); } catch { /* best-effort */ }
    updateJob(job.id, { tail });

    // Somebody already settled this — an owner's cancel closes the record
    // BEFORE the process dies (that is the order cancelJob's header sets out),
    // and the exit we are now handling is the consequence of that decision, not
    // a second outcome. Closing again would be a no-op; announcing again would
    // not, so neither happens.
    const current = readJob(job.id);
    if (!current || TERMINAL_STATUSES.includes(current.status)) return;

    const status = timedOut ? "timed_out" : code === 0 ? "done" : "failed";
    const result = timedOut
      ? `killed after ${ttl}s`
      : signal
        ? `killed by ${signal}`
        : `exit ${code}`;
    const settled = closeJob(job.id, { status, result, exit_code: code == null ? null : code });
    if (settled) emitBackgroundJobEvent({ phase: "end", job: settled });
  });

  // The parent must not wait on this child to exit before the daemon can.
  child.unref?.();

  return {
    ok: true,
    job_id: job.id,
    kind: JOB_KINDS.SHELL,
    pid: child.pid,
    command,
    cwd: cwd || null,
    log_path: logPath,
    wake: !!wake,
    timeout_s: ttl,
    status: "running",
    note: wake
      ? `Launched. Do NOT wait for it, do NOT poll it, and do NOT run it again — when it exits you will be ` +
        `woken in this chat with its exit code and the tail of its output. Say what you left running, ` +
        `then carry on with something else or close your turn.`
      : `Launched. It runs on its own and you will NOT be woken — nobody will read the result unless the ` +
        `owner opens the panel. Say so, or use wake_me next time.`,
  };
}
