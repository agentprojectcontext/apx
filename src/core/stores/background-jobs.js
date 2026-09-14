// Work an agent left running, and the promise to wake it when that work ends.
//
// WHY THIS EXISTS. `send_to_agent` reaches another agent without shelling out,
// but it still AWAITS the answer: the sender's turn is held for however long the
// peer takes. On 2026-09-11 that peer took ten minutes, and the sender — which
// had shelled out to `apx send --deliver`, whose 60 s run_shell timeout killed
// it first — reported "message sent ✅" off a SIGTERM, then closed its turn
// without ever seeing the reply that landed on the thread nine minutes later.
// Both halves of that are the same missing piece: there is no way to say "I left
// this running, wake me when it's done".
//
// A job is that sentence, on disk. It records who is WAITING, who is WORKING,
// what was asked, and whether the waiter wants to be woken. The work itself is
// an in-process promise (see core/agent/a2a/delegate.js); this store is the part
// that survives it.
//
// DURABILITY, and its honest limit. If the daemon dies mid-job the WORK is gone
// — `host/daemon/active-turns.js` says so in its own header, and no record here
// changes that. What the record buys is that the waiter is not left waiting
// forever: the reconciler (host/daemon/background-jobs-reconciler.js) finds the
// job at the next boot, closes it `lost`, and wakes the waiter with the truth.
// That is a strictly better outcome than the silence it replaces, and it is the
// only one available — inventing a result would be the lie the incident was
// made of.
//
// TWO KINDS OF WORK, ONE RECORD. A job started life as "I asked another agent
// and I am not waiting" (`kind: "a2a"`). A long COMMAND is the same sentence
// with a different worker — a render, a build, a batch of reels — and it failed
// the same way: `run_shell` is synchronous and capped at 600 s, so an agent with
// a twelve-minute render either held its turn open for it or got a SIGTERM and
// reported whatever the truncated output looked like. `kind: "shell"` is that
// work, in this store, so it lands on the same panel, under the same fan-out
// wall, and with the same promise to wake whoever left it running.
//
// A record with no `kind` is an a2a job: the field arrived after the store did,
// and jobs already on disk must keep meaning what they meant. Read it through
// `jobKind()` rather than the raw field.
//
// One JSON file per job under <APX_HOME>/background-jobs/. Not a table: jobs are
// few, short-lived, and read one at a time by id, and a directory gives the
// delivery claim below a filesystem primitive that a row would not.
import fs from "node:fs";
import path from "node:path";
import { APX_HOME } from "#core/config/paths.js";
import { nowIso } from "#core/util/time.js";
import { readJson, writeJson } from "#core/util/json-file.js";
import { shortId } from "#core/util/ids.js";

export const BACKGROUND_JOBS_DIR = path.join(APX_HOME, "background-jobs");

/**
 * What is doing the work.
 *
 * `a2a` — another agent's turn. `shell` — a command this daemon spawned. The
 * distinction decides three things and nothing else: who can be killed to cancel
 * it (a turn's abort hook vs. a process group), what the row says, and where the
 * wake-up lands. Everything else about a job is the same for both.
 */
export const JOB_KINDS = Object.freeze({ A2A: "a2a", SHELL: "shell" });

/** A job's kind, defaulting to a2a for records written before kinds existed. */
export function jobKind(job) {
  return job?.kind || JOB_KINDS.A2A;
}

/**
 * How many jobs one agent may have open at once.
 *
 * The fan-out wall, and the reason it is a COUNT and not just a depth limit: a
 * depth limit stops a chain, but nothing stops one turn from opening twenty
 * jobs side by side, each of which wakes a turn that can open twenty more. The
 * a2a depth guard (`_depth`, wall at 3) bounds how DEEP this goes; this bounds
 * how WIDE. Three is enough to leave two things running and ask a third, and
 * small enough that hitting it is a signal the model should read rather than a
 * ceiling it silently lives under.
 */
export const MAX_OPEN_JOBS_PER_AGENT = 3;

/** Jobs that are over. A terminal job is never delivered again — see claimWake.
 *
 * `cancelled` is the one an OWNER causes. The other four are things that
 * happened to the job; this is a decision someone took about it, and it is kept
 * distinct from `failed` for the same reason a stopped turn is not an error: an
 * agent told "it failed" will try to fix something, and an agent told "you were
 * stopped" will ask what to do instead. */
export const TERMINAL_STATUSES = Object.freeze(["done", "failed", "timed_out", "lost", "cancelled"]);

/** Default wall-clock life of a job, matching the background budget the a2a
 *  route already advertises for a detached send. */
export const DEFAULT_JOB_TIMEOUT_S = 3600;

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function fileFor(id) {
  return path.join(BACKGROUND_JOBS_DIR, `${id}.json`);
}

/** The delivery claim marker. A SEPARATE file on purpose — see claimWake. */
function claimFileFor(id) {
  return path.join(BACKGROUND_JOBS_DIR, `${id}.wake`);
}

/**
 * Where a shell job's full output is kept.
 *
 * The record carries only the tail (a progress line and the last error); this
 * is everything the command printed. Beside the record rather than in the
 * project, because it is runtime noise nobody asked to have in their repo —
 * the same reason artifacts live under APX_HOME — and it is pruned with the
 * job it belongs to.
 */
export function jobLogPath(id) {
  return path.join(BACKGROUND_JOBS_DIR, `${id}.log`);
}

/**
 * Open a job. Returns the record.
 *
 * `daemon_pid` is stamped here and is what makes recovery decidable: a job whose
 * owning process is still alive is RUNNING, and one whose process is gone is
 * LOST. Without it the reconciler cannot tell a slow job from an orphaned one,
 * and would either kill live work or leave dead work open forever.
 */
export function openJob({
  project_id = null,
  from,
  to = null,
  thread = null,
  body = "",
  wake = false,
  timeout_s = DEFAULT_JOB_TIMEOUT_S,
  depth = 0,
  kind = JOB_KINDS.A2A,
  // Shell jobs only. `command`/`cwd` are what was run and where; `pid` is the
  // process GROUP leader, so cancelling can signal the whole tree rather than
  // the `sh -lc` wrapper that would leave ffmpeg orphaned behind it.
  command = null,
  cwd = null,
  pid = null,
  // Where the agent was when it left this running: `{ channel, conversation_id }`.
  // The wake-up goes back THERE — into the chat the owner is reading — instead
  // of somewhere the work has no context. A job with no origin is still woken;
  // it just opens a new thread to do it in.
  origin = null,
}) {
  if (!from) throw new Error("background job: from is required");
  // Only an a2a job has someone on the other end. A shell job's worker is a
  // process, and giving it a fake peer name is how a phantom agent gets a face
  // in the inbox — so `to` stays null and every reader branches on the kind.
  if (kind === JOB_KINDS.A2A && !to) throw new Error("background job: to is required for an a2a job");
  if (kind === JOB_KINDS.SHELL && !command) throw new Error("background job: command is required for a shell job");
  const ttl = Number(timeout_s) > 0 ? Number(timeout_s) : DEFAULT_JOB_TIMEOUT_S;
  const created = new Date();
  const id = shortId("bgjob");
  const job = {
    id,
    project_id: project_id ?? null,
    kind,
    from: String(from),
    to: to == null ? null : String(to),
    thread: thread || null,
    // Kept so a wake-up and the panel can both say what this job WAS without
    // re-reading the thread. A job the owner cannot name is a spinner.
    body: String(body || "").slice(0, 2000),
    wake: !!wake,
    depth: Number(depth) || 0,
    status: "running",
    daemon_pid: process.pid,
    created_at: created.toISOString(),
    deadline_at: new Date(created.getTime() + ttl * 1000).toISOString(),
    timeout_s: ttl,
    closed_at: null,
    result: null,
    // Shell-only, and absent on an a2a record rather than null on it: a field
    // that is always there is a field every reader has to decide about.
    ...(kind === JOB_KINDS.SHELL
      ? {
        command: String(command),
        cwd: cwd || null,
        pid: pid ?? null,
        tail: "",
        exit_code: null,
        origin: origin || null,
        log_path: jobLogPath(id),
      }
      : {}),
  };
  fs.mkdirSync(BACKGROUND_JOBS_DIR, { recursive: true });
  writeJson(fileFor(id), job);
  return job;
}

/** One job by id, or null. */
export function readJob(id) {
  if (!id || !SAFE_ID.test(String(id))) return null;
  return readJson(fileFor(id), null);
}

/**
 * Close a job with its outcome. Idempotent on the STATUS: a job that is already
 * terminal keeps the status and result it had, because the first answer is the
 * true one — a `lost` job whose daemon comes back must not be overwritten by a
 * late success from a promise nobody is holding any more.
 */
export function closeJob(id, { status = "done", result = "", exit_code = undefined } = {}) {
  const job = readJob(id);
  if (!job) return null;
  if (TERMINAL_STATUSES.includes(job.status)) return job;
  const closed = {
    ...job,
    status: TERMINAL_STATUSES.includes(status) ? status : "done",
    result: String(result || "").slice(0, 8000),
    closed_at: nowIso(),
    // A shell job's outcome in one number. Kept beside the prose because the
    // prose is the tail of the output, and "exit 1" is the part a panel shows
    // and a woken agent must not have to parse out of it.
    ...(exit_code === undefined ? {} : { exit_code: exit_code === null ? null : Number(exit_code) }),
  };
  writeJson(fileFor(id), closed);
  return closed;
}

/**
 * Patch a RUNNING job's progress. For the live half of a shell job: its pid the
 * moment it is known, and the tail of its output as it comes.
 *
 * Refuses a terminal job, and takes a WHITELIST of fields, for the same reason
 * `closeJob` keeps the first status it was given: a record that anything can
 * rewrite at any time is not a record. Progress is the only thing that changes
 * while a job runs — status, outcome and identity are settled elsewhere.
 */
export function updateJob(id, patch = {}) {
  const job = readJob(id);
  if (!job) return null;
  if (TERMINAL_STATUSES.includes(job.status)) return job;
  const next = { ...job };
  if (patch.pid !== undefined) next.pid = patch.pid == null ? null : Number(patch.pid);
  if (patch.tail !== undefined) next.tail = String(patch.tail || "");
  writeJson(fileFor(id), next);
  return next;
}

/**
 * Take ownership of waking the job's waiter. Returns true exactly once per job,
 * ever — for the whole life of the record, across processes.
 *
 * THE IDEMPOTENCY GUARANTEE, and why it is a file and not a field. Two things
 * can reach a finished job: the live promise that was running it, and the
 * reconciler that sweeps for orphans. Read-modify-write on the job record does
 * not settle that race — both can read `delivered: false` before either writes.
 * `open(…, "wx")` is a single atomic syscall that creates the marker or fails
 * with EEXIST, so exactly one caller wins and the loser learns it lost. That is
 * what stops the failure this whole feature exists to prevent from becoming its
 * own bug: an agent woken twice by the same result does the work twice.
 *
 * Claimed BEFORE the wake-up is sent, never after — the same order
 * `deletePendingCallback` uses at the top of call_runtime's deliverCallback.
 * A claim followed by a failed send loses one wake-up; a send followed by a
 * failed claim duplicates work. Losing one is recoverable and visible; doing the
 * work twice is neither.
 */
export function claimWake(id) {
  if (!id || !SAFE_ID.test(String(id))) return false;
  try {
    fs.mkdirSync(BACKGROUND_JOBS_DIR, { recursive: true });
    fs.closeSync(fs.openSync(claimFileFor(id), "wx"));
    return true;
  } catch {
    return false; // EEXIST — somebody already owns this wake-up
  }
}

/** Has this job's wake-up already been claimed? Read-only; claimWake is the
 *  one that decides. For surfaces that want to render "already delivered". */
export function wakeClaimed(id) {
  if (!id || !SAFE_ID.test(String(id))) return false;
  return fs.existsSync(claimFileFor(id));
}

/** Every job on disk, newest first. Corrupt files are skipped, not thrown. */
export function listJobs({ project_id = null, from = null, status = null, open_only = false } = {}) {
  let files;
  try {
    files = fs.readdirSync(BACKGROUND_JOBS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    const job = readJson(path.join(BACKGROUND_JOBS_DIR, f), null);
    if (!job?.id) continue;
    if (project_id != null && String(job.project_id) !== String(project_id)) continue;
    if (from && job.from !== from) continue;
    if (status && job.status !== status) continue;
    if (open_only && TERMINAL_STATUSES.includes(job.status)) continue;
    out.push(job);
  }
  // Newest first, with the id as a tiebreak — the same reasoning as byNewest()
  // in stores/tasks.js. Two jobs opened in the same MILLISECOND share a
  // created_at (this store keeps ms, so the collision is narrow but real: a
  // cascade opens several at once), and with nothing to break the tie the order
  // is whatever readdirSync handed us. A list that reshuffles between two
  // identical calls is worse than one that is merely arbitrary.
  //
  // It does NOT recover creation order for those ties: ids are random, not
  // monotonic. Same-ms jobs come back in a stable but arbitrary order, which is
  // the most this can honestly promise.
  return out.sort((a, b) => {
    const byTime = String(b.created_at || "").localeCompare(String(a.created_at || ""));
    return byTime !== 0 ? byTime : String(b.id || "").localeCompare(String(a.id || ""));
  });
}

/** How many jobs this agent has open right now. The MAX_OPEN_JOBS_PER_AGENT gate. */
export function countOpenJobs({ project_id = null, from }) {
  return listJobs({ project_id, from, open_only: true }).length;
}

/**
 * Repoint an agent slug on the jobs that are still OPEN in one project — the
 * half of an agent rename this store owns.
 *
 * Only open jobs, and that is the whole point: `from` and `to` on a running job
 * are live pointers (who gets woken, whose quota this counts against), while on
 * a closed one they are the record of a conversation that already happened.
 * Rewriting those would falsify history for no gain.
 *
 * Scoped by `project_id` because two projects may each own this slug, and a
 * rename in one must not reach into the other's queue.
 *
 * @returns {number} jobs touched
 */
export function renameJobAgent({ project_id = null, oldSlug, newSlug }) {
  if (!oldSlug || !newSlug || oldSlug === newSlug) return 0;
  let changed = 0;
  for (const job of listJobs({ project_id, open_only: true })) {
    if (job.from !== oldSlug && job.to !== oldSlug) continue;
    writeJson(fileFor(job.id), {
      ...job,
      from: job.from === oldSlug ? newSlug : job.from,
      to: job.to === oldSlug ? newSlug : job.to,
    });
    changed += 1;
  }
  return changed;
}

/** Drop a job's record and its claim marker. For tests and for pruning. */
export function deleteJob(id) {
  if (!id || !SAFE_ID.test(String(id))) return;
  try { fs.rmSync(fileFor(id), { force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(claimFileFor(id), { force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(jobLogPath(id), { force: true }); } catch { /* best-effort */ }
}

/**
 * Remove terminal jobs older than `days`. Called by the reconciler so the
 * directory does not grow forever; a closed job is history the thread already
 * holds in full, so nothing is lost by pruning the record of it.
 */
export function pruneJobs({ days = 7 } = {}) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const job of listJobs()) {
    if (!TERMINAL_STATUSES.includes(job.status)) continue;
    const closed = Date.parse(job.closed_at || job.created_at || "");
    if (Number.isFinite(closed) && closed < cutoff) {
      deleteJob(job.id);
      removed++;
    }
  }
  return removed;
}

/**
 * Is the process that owns this job still alive?
 *
 * `kill(pid, 0)` tests for existence without signalling. A false answer means
 * the daemon that held the promise is gone, so the work is gone with it — the
 * reconciler's cue to close the job `lost` rather than wait on a promise no
 * process is holding. A job owned by THIS process is trivially alive, which is
 * what keeps a reconciler tick from harvesting live work.
 */
export function ownerAlive(job) {
  const pid = Number(job?.daemon_pid);
  if (!Number.isFinite(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists and belongs to somebody else — alive either way.
    return e?.code === "EPERM";
  }
}

/** Is this job past its deadline? */
export function jobExpired(job, now = Date.now()) {
  const deadline = Date.parse(job?.deadline_at || "");
  return Number.isFinite(deadline) && deadline < now;
}
