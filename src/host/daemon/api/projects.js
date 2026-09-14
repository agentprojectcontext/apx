import fs from "node:fs";
import path from "node:path";
import { initApf } from "#core/apc/scaffold.js";
import { apcProjectFile } from "#core/apc/paths.js";
import { installPack } from "#core/apc/agent-packs.js";

/** Persist the project's kind in .apc/project.json, where db.list() reads it. */
function setProjectKind(root, kind) {
  const file = apcProjectFile(root);
  try {
    const meta = JSON.parse(fs.readFileSync(file, "utf8"));
    meta.kind = String(kind);
    fs.writeFileSync(file, `${JSON.stringify(meta, null, 2)}\n`);
  } catch {
    // A project without a readable project.json was already refused by register().
  }
}

// Project lifecycle endpoints.
//   GET    /projects               list registered projects
//   POST   /projects               register a project by path
//   DELETE /projects/:id           unregister
//   POST   /projects/:id/rebuild   force a context rebuild from disk
//   POST   /projects/:id/relink    point it at a new folder, keeping its id
export function register(api, {
  projects, registries, addProjectGlobally, removeProjectGlobally,
  relinkProjectGlobally = () => false,
}) {
  api.get("/projects", (_req, res) => res.json(projects.list()));

  // Registering a project is three questions, not one: where it is, whether it
  // is even an APC project yet, and what kind of thing it is. Answering only
  // the first is what made "add project" fail with `not an APC project` on the
  // most common case there is — a folder that simply has not been initialized.
  api.post("/projects", (req, res) => {
    const { path: p, kind, name, init, team } = req.body || {};
    if (!p) return res.status(400).json({ error: "path required" });
    try {
      const root = path.resolve(String(p));
      if (init && !fs.existsSync(path.join(root, ".apc", "project.json"))) {
        initApf(root, { name: name || undefined });
      }
      const entry = projects.register(root);
      addProjectGlobally(entry.path);
      registries.ensure(entry);

      // The kind is not decoration: `company` is what unlocks the structure of
      // areas and roles, and what a company profile keys off.
      if (kind) setProjectKind(entry.path, kind);

      let installed = null;
      if (team) {
        try {
          installed = installPack(entry, team);
        } catch (e) {
          // A team that fails to install must not undo a registration that
          // already worked — say so and let the user retry from the agents tab.
          installed = { error: e.message };
        }
      }
      projects.rebuild(entry.id);
      res.status(201).json({ id: entry.id, path: entry.path, kind: kind || null, team: installed });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Unregister = forget it HERE and stop loading it NEXT TIME. It used to be
  // only the first half: `projects.unregister` drops the entry from the running
  // daemon's maps and nothing touched ~/.apx/config.json, which is what boot
  // reads. So a project you removed came back on the next restart, and one
  // whose folder was gone stayed in the file forever — 37 dead entries on this
  // machine, most of them e2e temp dirs the suite had to clean up by hand (see
  // web/e2e/throwaway.ts, which says exactly this).
  //
  // By PATH and never by id: the id here is the daemon's (registration order,
  // 0 = default), while `removeProject`'s numeric branch treats a number as a
  // 1-based INDEX into the config array. The same number means two different
  // entries, and the difference is silent.
  api.delete("/projects/:id", (req, res) => {
    const entry = projects.get?.(req.params.id) || null;
    const ok = projects.unregister(req.params.id);
    if (ok && entry?.path) removeProjectGlobally(entry.path);
    res.status(ok ? 204 : 404).end();
  });

  api.post("/projects/:id/rebuild", (req, res) => {
    try {
      const result = projects.rebuild(req.params.id);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Reattach a project that changed folder — the repair for the silent break
  // described in core/apc/project-presence.js. Keeps the id (and therefore the
  // storage, the routines, the tasks and every chat pointing at it), which is
  // exactly what remove+add did not.
  //
  // Omitting `path` asks the daemon to find it: a sibling folder whose
  // .apc/project.json carries the same apx_id. That is a match on identity, not
  // on name, so answering it automatically is safe.
  api.post("/projects/:id/relink", (req, res) => {
    const { path: to, force } = req.body || {};
    try {
      const entry = projects.get?.(req.params.id);
      if (!entry) return res.status(404).json({ error: `unknown project id ${req.params.id}` });

      let target = to ? String(to) : null;
      if (!target) {
        const moved = projects.findMoved(entry.id);
        if (!moved) {
          return res.status(400).json({
            error:
              `could not find where project #${entry.id} moved to — pass the new path explicitly. ` +
              `(Looked for a folder next to ${entry.path} carrying apx_id ${entry.apxId || "(none)"}.)`,
          });
        }
        target = moved.path;
      }

      const from = entry.path;
      const result = projects.relink(entry.id, target, { force: !!force });
      // Persist only once the in-memory move succeeded: writing the config for a
      // relink that threw would resurrect the wrong path on the next boot.
      const persisted = relinkProjectGlobally(from, result.path);
      registries?.ensure?.(projects.get(entry.id));
      res.json({ ok: true, persisted, ...result });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}
