import { listCommitments, listCommitmentsAcrossProjects } from "#core/stores/commitments.js";

/**
 * Read back what is owed, to whom, by when.
 *
 * Cross-project by default. "What do I owe people this week" almost never
 * respects a repo boundary, and forcing the model to pick a project first is
 * how the anchors end up reporting one project's promises as if they were all
 * of them.
 */
export default {
  name: "list_commitments",
  schema: {
    type: "function",
    function: {
      name: "list_commitments",
      description:
        "List commitments — things promised to named people. Use for 'what do I owe X', " +
        "'what's overdue', or when preparing a meeting with someone. Searches ALL projects " +
        "unless a project is given. Distinct from list_tasks: these have a counterparty " +
        "waiting, and an overdue one costs trust.",
      parameters: {
        type: "object",
        properties: {
          project:      { type: "string", description: "Optional project id, name or path. Omit to search every project." },
          counterparty: { type: "string", description: "Filter by who is waiting — matches part of the name, case-insensitive." },
          state:        { type: "string", enum: ["open", "kept", "missed", "all"], description: "Defaults to open." },
          overdue:      { type: "boolean", description: "Only ones past their date and still open." },
          due_before:   { type: "string", description: "ISO date — only those due on or before it." },
          limit:        { type: "integer", description: "Max rows. Defaults to 50." },
        },
      },
    },
  },
  makeHandler: ({ projects }) => async (args = {}) => {
    const { project: ref, counterparty, state, overdue, due_before, limit } = args;
    const opts = {
      counterparty: counterparty || undefined,
      state: state || undefined,
      overdue: overdue === true || undefined,
      due_before: due_before || undefined,
      limit: Number.isFinite(limit) ? limit : 50,
    };

    if (ref) {
      const r = String(ref);
      const found = projects.list().find((p) => String(p.id) === r || p.name === r || p.path === r);
      if (!found) return { error: `project not found: ${ref}` };
      const proj = projects.get(found.id);
      if (!proj) return { error: `project storage not loaded: ${ref}` };
      return { commitments: listCommitments(proj.storagePath, opts).map(compact) };
    }

    const entries = [];
    for (const entry of projects.list()) {
      const p = projects.get(entry.id);
      if (!p?.storagePath) continue;
      entries.push({ id: entry.id, name: entry.name || entry.path, path: entry.path, storagePath: p.storagePath });
    }
    const { commitments, skipped } = listCommitmentsAcrossProjects(entries, opts);
    return {
      commitments: commitments.map(compact),
      // Say what could not be read rather than quietly reporting less.
      ...(skipped.length ? { skipped } : {}),
    };
  },
};

/** Only the fields worth spending prompt tokens on. */
function compact(c) {
  return {
    id: c.id,
    counterparty: c.counterparty,
    body: c.body,
    due: c.due,
    state: c.state,
    ...(c.project_name ? { project: c.project_name } : {}),
    ...(c.renegotiated_count ? { moved: c.renegotiated_count } : {}),
  };
}
