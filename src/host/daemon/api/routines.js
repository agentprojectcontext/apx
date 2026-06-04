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
} from "../routines.js";

export function register(app, { projects, registries, plugins, project, config }) {
  app.get("/projects/:pid/routines", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    res.json(listRoutines(p.storagePath));
  });

  app.get("/projects/:pid/routines/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const r = getRoutine(p.storagePath, req.params.name);
    if (!r) return res.status(404).json({ error: "routine not found" });
    res.json(r);
  });

  app.post("/projects/:pid/routines", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    try {
      // Accepts every field including the pipeline extensions
      // (pre_commands, post_commands, skip_prompt_on).
      const r = upsertRoutine(p.storagePath, req.body || {});
      res.status(201).json(r);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/projects/:pid/routines/:name", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const ok = deleteRoutine(p.storagePath, req.params.name);
    res.status(ok ? 204 : 404).end();
  });

  app.post("/projects/:pid/routines/:name/enable", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    setRoutineEnabled(p.storagePath, req.params.name, true);
    res.json({ ok: true });
  });

  app.post("/projects/:pid/routines/:name/disable", (req, res) => {
    const p = project(req, res);
    if (!p) return;
    setRoutineEnabled(p.storagePath, req.params.name, false);
    res.json({ ok: true });
  });

  app.post("/projects/:pid/routines/:name/run", async (req, res) => {
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
