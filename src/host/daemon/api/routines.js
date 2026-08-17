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
import {
  listRoutines,
  getRoutine,
  upsertRoutine,
  deleteRoutine,
  setEnabled as setRoutineEnabled,
  runRoutineNow,
} from "#core/routines/index.js";
import { CHANNELS } from "#core/constants/channels.js";

export function register(api, { projects, registries, plugins, project, config }) {
  api.get("/projects/:pid/routines", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(listRoutines(p.storagePath));
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

  api.post("/projects/:pid/routines/:name/run", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const r = getRoutine(p.storagePath, req.params.name);
    if (!r) return res.status(404).json({ error: "routine not found" });
    try {
      const result = await runRoutineNow(
        { project: p, projects, plugins, registries, globalConfig: config },
        r
      );
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
