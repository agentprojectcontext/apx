// Work agents left running, as seen from outside.
//
//   GET /jobs            — every job, newest first (?project_id, ?from, ?status, ?open)
//   GET /jobs/:id        — one job
//
// WHY THERE IS A ROUTE FOR THIS. A background job is the one piece of an agent's
// state that no other surface can show. A live TURN is in `active-turns.js` and
// the conversation GET carries it; a MESSAGE is in the ledger and the thread
// carries it. "Ansel is waiting on Roby, and has been since 17:31" is neither —
// it is a fact about the waiter, held in core/stores/background-jobs.js, and
// without a way to read it the owner sees an agent that looks idle and a peer
// that looks dead, which is exactly the picture the incident of 2026-09-11
// produced for ten minutes.
//
// AND ONE WRITE: cancel.
//
//   POST /jobs/:id/cancel  — stop the work, close the record, wake the waiter
//
// This route used to say, in this comment, that cancelling was not offered
// because it "would have to reach into a promise this process may not even
// own". That was true of the promise and false of the WORK: a background job's
// work is an ordinary a2a turn, registered in `active-turns.js` under its
// thread, and the abort hook the Stop button pulls reaches it exactly the same
// way. What was actually missing was the third step — telling the agent that
// asked to be woken — without which cancelling would leave it waiting forever
// for a result nobody was coming with. `cancelJob` does all three in order.
import { listJobs, readJob, TERMINAL_STATUSES } from "#core/stores/background-jobs.js";
import { cancelJob } from "#core/agent/a2a/background.js";
import { abortActiveTurn, threadTurnKey } from "../active-turns.js";
import { pageEnvelope, asyncRoute } from "./shared.js";

export function register(api, { projects, config, plugins, registries } = {}) {
  api.get("/jobs", (req, res) => {
    try {
      const rows = listJobs({
        project_id: req.query.project_id || null,
        from: req.query.from || null,
        status: req.query.status || null,
        // `?open=1` is the question a panel actually asks — what is running
        // right now — and it is not the same as "status=running", which would
        // miss nothing today but would the moment a non-terminal status exists.
        open_only: req.query.open === "1",
      });
      const envelope = pageEnvelope(rows, req.query);
      envelope.meta = {
        ...(envelope.meta || {}),
        open: rows.filter((j) => !TERMINAL_STATUSES.includes(j.status)).length,
      };
      res.json(envelope);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.get("/jobs/:id", (req, res) => {
    try {
      const job = readJob(req.params.id);
      if (!job) return res.status(404).json({ error: "job not found" });
      res.json(job);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  api.post("/jobs/:id/cancel", asyncRoute(async (req, res) => {
    const job = readJob(req.params.id);
    if (!job) return res.status(404).json({ error: "job not found" });
    // Already over. A 409 rather than a 200: the caller asked for a state change
    // that did not happen, and a panel that greys the row out on an optimistic
    // 200 would be lying about a job that finished a second before the click.
    if (TERMINAL_STATUSES.includes(job.status)) {
      return res.status(409).json({ error: `job already ${job.status}`, job });
    }
    const out = await cancelJob(req.params.id, {
      reason: typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim()
        : "",
      // The registry lives here, not in core (rule 8). A job's turn is keyed by
      // its thread on the a2a channel — the same key the thread's own Stop uses,
      // so the two buttons reach the same run rather than two ideas of it.
      abortFn: (j) => abortActiveTurn(threadTurnKey(j.project_id, "a2a", j.thread)),
      project: projectOfJob(projects, job.project_id),
      config,
      projects,
      plugins,
      registries,
    });
    if (!out.ok) return res.status(409).json({ error: out.reason, job: out.job || job });
    res.json(out);
  }));
}

/** The project record a job belongs to, for the wake-up to be filed in. A job
 *  whose project is gone still cancels — it just cannot wake anybody, and
 *  `deliverWake` says so rather than throwing. */
function projectOfJob(projects, projectId) {
  if (!projects || projectId == null) return null;
  try {
    return projects.get(projectId) || null;
  } catch {
    return null;
  }
}
