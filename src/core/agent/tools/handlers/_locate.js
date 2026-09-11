// Find the project a record lives in, given only its id.
//
// `list_tasks` and `list_commitments` both answer across every project and label
// each row with where it came from — but a model that then wants to READ or EDIT
// one has to carry that label back, and when it does not,
// `resolveProject(undefined)` hands back the default project and the record
// "does not exist". That failure is indistinguishable from a wrong id, so the
// model retries the same call and gives up with the work undone.
//
// So: an EXPLICIT project is honoured exactly as before, and an omitted one
// means "find it" — this turn's own project first, then every registered one.
// Whichever project it lands in is named in the reply, so nothing is silent, and
// an id that matches in two projects is an error that says so rather than a coin
// flip.
import { resolveProject } from "../helpers.js";

export function projectLabel(projects, p) {
  return projects.list().find((e) => e.id === p.id)?.name || p.path || String(p.id);
}

/**
 * @param {object} projects           the daemon's project registry
 * @param {object} opts
 * @param {string} [opts.project]     explicit project ref — id, name or path
 * @param {string} opts.id            record id or unique prefix
 * @param {(storagePath: string, id: string) => object|null} opts.read
 * @param {string} opts.kind          "task" | "commitment" — for the messages
 * @param {string} opts.example       a well-formed id, shown when nothing matches
 * @param {string} opts.lister        the tool that hands out ids
 * @returns {{project: object, record: object} | {error: string}}
 */
export function locateRecord(projects, { project, id, read, kind, example, lister }) {
  const ref = String(id || "").trim();
  if (!ref) return { error: `${kind} required` };

  if (project) {
    let p;
    try {
      p = resolveProject(projects, project);
    } catch (e) {
      return { error: e.message };
    }
    const record = read(p.storagePath, ref);
    if (!record) return { error: `${kind} not found in "${projectLabel(projects, p)}": ${ref}` };
    return { project: p, record };
  }

  let here = null;
  try {
    here = resolveProject(projects);
  } catch {
    here = null; // several projects and no default — the sweep below still works
  }
  if (here?.storagePath) {
    const record = read(here.storagePath, ref);
    if (record) return { project: here, record };
  }

  const hits = [];
  for (const entry of projects.list()) {
    const p = projects.get(entry.id);
    if (!p?.storagePath || (here && p.id === here.id)) continue;
    let record = null;
    try {
      record = read(p.storagePath, ref);
    } catch {
      continue; // one unreadable log must not blank the search
    }
    if (record) hits.push({ project: p, record });
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    const names = hits.map((h) => projectLabel(projects, h.project)).join(", ");
    return {
      error: `"${ref}" matches a ${kind} in ${hits.length} projects (${names}); pass project=<id|name> to say which.`,
    };
  }
  return {
    error:
      `${kind} not found: ${ref}. Searched every registered project. ` +
      `Ids look like "${example}" — a ≥3-char unique prefix works too. Call ${lister} to get one.`,
  };
}
