// Per-project scheduled tasks. Storage lives in ~/.apx/projects/<id>/routines.json
// (never inside the repo's .apc/).
//
//   GET    /projects/:pid/routines
//   GET    /projects/:pid/routines/:name
//   POST   /projects/:pid/routines
//   DELETE /projects/:pid/routines/:name
//   POST   /projects/:pid/routines/:name/enable
//   POST   /projects/:pid/routines/:name/disable
//   POST   /projects/:pid/routines/:name/run
//   GET    /projects/:pid/routines/:name/run   → the run in flight, if any
//   GET    /projects/:pid/routines/:name/runs  → the runs already made
import {
  listRoutines,
  getRoutine,
  upsertRoutine,
  deleteRoutine,
  setEnabled as setRoutineEnabled,
  runRoutineNow,
} from "#core/routines/index.js";
import { getRoutineRun, listRoutineRuns } from "#core/routines/active-runs.js";
import { listRoutineRunLog } from "#core/routines/run-log.js";
import { CHANNELS } from "#core/constants/channels.js";
import { asyncRoute } from "./shared.js";

export function register(api, { projects, registries, plugins, project, config }) {
  api.get("/projects/:pid/routines", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    // `running` is runtime state, not stored state: which of these the daemon
    // has open RIGHT NOW. Without it the list could only ever show the last
    // finished run, so a routine working away for four minutes looked idle to
    // every surface except the tab that pressed Play.
    const open = new Map(listRoutineRuns(p.storagePath).map((r) => [r.routine, r]));
    res.json(listRoutines(p.storagePath).map((r) => {
      const run = open.get(r.name);
      return run ? { ...r, running: true, run_started_at: run.started_at } : r;
    }));
  });

  // The live record of a run in flight: which phase, which steps so far, what
  // the model has said. 200 with `{ run: null }` when nothing is running — a
  // routine that is idle is an answer, not a 404.
  api.get("/projects/:pid/routines/:name/run", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json({ run: getRoutineRun(p.storagePath, req.params.name) });
  });

  // A routine's run history. Reading it means knowing that a run is a ledger
  // row with a particular meta on it, and that a "routine updated" row is NOT
  // one — knowledge that belongs in core/routines/run-log.js, not in a panel.
  api.get("/projects/:pid/routines/:name/runs", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    res.json(listRoutineRunLog(p.storagePath, req.params.name, { limit }));
  });

  api.get("/projects/:pid/routines/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const r = getRoutine(p.storagePath, req.params.name);
    if (!r) return res.status(404).json({ error: "routine not found" });
    res.json(r);
  });

  api.post("/projects/:pid/routines", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      // Accepts every field including the pipeline extensions
      // (pre_commands, post_commands, skip_prompt_on).
      const existed = !!getRoutine(p.storagePath, (req.body || {}).name);
      const r = upsertRoutine(p.storagePath, req.body || {});
      // Say it happened, where it happened. A routine appearing in a list on a
      // screen nobody has open is not the same as being told one now exists —
      // and "what did that just create?" is the question people actually ask
      // after asking for something to be set up.
      p.logMessage?.({
        channel: CHANNELS.ROUTINE,
        direction: "out",
        type: "system",
        actor_id: "apx:routine",
        author: "apx",
        body: existed
          ? `routine ${r.name} updated (${r.kind}, ${r.schedule})`
          : `routine ${r.name} created (${r.kind}, ${r.schedule})`,
        meta: {
          event: existed ? "routine_updated" : "routine_created",
          routine: r.name,
          routine_id: r.id,
          kind: r.kind,
          schedule: r.schedule,
          enabled: r.enabled !== false,
        },
      });
      res.status(201).json(r);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  api.delete("/projects/:pid/routines/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const ok = deleteRoutine(p.storagePath, req.params.name);
    res.status(ok ? 204 : 404).end();
  });

  api.post("/projects/:pid/routines/:name/enable", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    setRoutineEnabled(p.storagePath, req.params.name, true);
    res.json({ ok: true });
  });

  api.post("/projects/:pid/routines/:name/disable", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    setRoutineEnabled(p.storagePath, req.params.name, false);
    res.json({ ok: true });
  });

  api.post("/projects/:pid/routines/:name/run", asyncRoute(async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const r = getRoutine(p.storagePath, req.params.name);
    if (!r) return res.status(404).json({ error: "routine not found" });
    try {
      const result = await runRoutineNow(
        { project: p, projects, plugins, registries, globalConfig: config, trigger: "manual" },
        r
      );
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }));
}
