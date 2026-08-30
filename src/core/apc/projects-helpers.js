// Helpers that need the running daemon's projects registry to do their work
// (projectMeta + resolveProject). Pure / config-only helpers live in
// core/agent/tools/helpers.js.
import path from "node:path";

export function projectMeta(projects, entry) {
  const meta = projects.list().find((p) => p.id === entry.id);
  return {
    id: entry.id,
    name: meta?.name || path.basename(entry.path),
    path: entry.path,
  };
}

/**
 * The registry, scoped to the project a turn BELONGS to.
 *
 * `resolveProject` used to read an omitted `project` argument as "the default
 * project", which is right for the super-agent (it orchestrates across all of
 * them) and wrong for anyone who lives in one. A routine run by Magui in Appsi
 * called `run_shell tail work/marketing/magui/brain.md` and got
 * `~/.apx/projects/default` — her own notes, one directory over, reported as
 * "No such file or directory". Every scheduled run since had been working from
 * an empty memory and writing its entry where nobody reads it.
 *
 * Scoping at the registry — rather than threading a project through all 30-odd
 * handlers — means a tool that takes an optional `project` keeps its exact
 * signature and simply defaults to the right one. An EXPLICIT argument still
 * wins, `project: "default"` still means the default project, and an unscoped
 * registry behaves exactly as before.
 *
 * The wrapper delegates through the prototype chain: the registry keeps one set
 * of entries and one cache, and a scope is a view of it, never a copy.
 */
export function scopeProjects(projects, projectId) {
  if (!projects || projectId === undefined || projectId === null) return projects;
  const self = projects.get?.(projectId);
  if (!self) return projects;
  return Object.assign(Object.create(projects), { current: () => self });
}

export function resolveProject(projects, target, { allowMulti = false } = {}) {
  if (target === undefined || target === null || target === "") {
    if (allowMulti) return null;
    // Whose turn this is, when the caller said (see `scopeProjects`). Ahead of
    // the default project, because "the project I belong to" is what an agent
    // means by an unqualified path — and behind an explicit argument, which is
    // handled below and still addresses any project by id, name or path.
    const scoped = projects.current?.();
    if (scoped) return scoped;
    const defaultProject = projects.get(0);
    if (defaultProject) return defaultProject;
    const all = projects.list();
    if (all.length === 1) return projects.get(all[0].id);
    throw new Error(`multiple projects registered (${all.length}); specify project=<id|name|path>`);
  }

  const tgt = String(target);
  if (tgt.toLowerCase() === "default") {
    const defaultProject = projects.get(0);
    if (!defaultProject) throw new Error("default project not available");
    return defaultProject;
  }

  if (typeof target === "number" || /^\d+$/.test(tgt)) {
    const entry = projects.get(parseInt(tgt, 10));
    if (!entry) throw new Error(`project id ${target} not found`);
    return entry;
  }

  const all = projects.list();
  const byPath = all.find((p) => p.path === path.resolve(tgt));
  if (byPath) return projects.get(byPath.id);

  const byName = all.find((p) => p.name === tgt);
  if (byName) return projects.get(byName.id);

  const tgtLow = tgt.toLowerCase();
  const fuzzy = all.filter(
    (p) => p.name.toLowerCase().includes(tgtLow) || p.path.toLowerCase().includes(tgtLow)
  );
  if (fuzzy.length === 1) return projects.get(fuzzy[0].id);
  if (fuzzy.length > 1) {
    throw new Error(`project "${tgt}" is ambiguous; matches: ${fuzzy.map((p) => p.name).join(", ")}`);
  }
  throw new Error(`project "${tgt}" not found`);
}
