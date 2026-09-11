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
// Read-only on purpose. A job ends when its work ends, when its deadline passes,
// or when the daemon holding it dies — all three decided by the reconciler, not
// by a caller. A "cancel" here would have to reach into a promise this process
// may not even own; stopping the WORK is what `POST /turns/abort` already does,
// on the turn the job opened.
import { listJobs, readJob, TERMINAL_STATUSES } from "#core/stores/background-jobs.js";
import { pageEnvelope } from "./shared.js";

export function register(api) {
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
}
