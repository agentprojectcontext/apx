// "Where did that get to?" must not start the work again.
//
// Asked for status, the super-agent called the agent it had already left
// working — which does not read a status, it opens a whole new turn. That turn
// re-delegated the production to a third agent, and three agents sat waiting on
// each other while a render ran. When the sender already has a job open with
// that agent, a new hand-off returns the job instead, unless it is marked as a
// deliberate correction.
import { listJobs, JOB_KINDS } from "#core/stores/background-jobs.js";

const norm = (v) => String(v || "").trim().toLowerCase();

/** The sender's open a2a job with `to`, or null. */
export function openJobWith({ projectId = null, from, to }) {
  const want = norm(to);
  const open = listJobs({ project_id: projectId, from, open_only: true })
    .filter((j) => (j.kind || JOB_KINDS.A2A) === JOB_KINDS.A2A && norm(j.to) === want);
  return open[0] || null;
}

/** A short, model-facing view of a job: what, since when, where to watch it. */
export function jobStatus(job, now = Date.now()) {
  const since = job.created_at ? Math.max(0, Math.round((now - Date.parse(job.created_at)) / 60000)) : null;
  return {
    job_id: job.id,
    kind: job.kind || JOB_KINDS.A2A,
    ...(job.to ? { agent: job.to } : {}),
    status: job.status,
    ...(since != null ? { running_for_min: since } : {}),
    ...(job.thread ? { thread: job.thread } : {}),
    what: String(job.body || job.command || "").slice(0, 300),
    ...(job.tail ? { last_output: String(job.tail).split("\n").filter(Boolean).slice(-3).join("\n") } : {}),
  };
}

/** The reply a hand-off gets when the same pair already has a job open. */
export function alreadyRunningReply(job) {
  return {
    ok: true,
    already_running: jobStatus(job),
    note:
      `${job.to} is still working on what you already handed over (job ${job.id}). Nothing new was sent — ` +
      "you will be woken when it lands. If the owner asks where it is, tell them this. Only if you mean to " +
      "correct or extend that instruction, call again with `followup: true` and say so in the message.",
  };
}
