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

export function resolveProject(projects, target, { allowMulti = false } = {}) {
  if (target === undefined || target === null || target === "") {
    if (allowMulti) return null;
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
