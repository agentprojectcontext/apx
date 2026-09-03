import { listTasks, listTasksAcrossProjects } from "#core/stores/tasks.js";

/**
 * Tasks, across every project by default.
 *
 * `project` USED TO BE REQUIRED, and that was the bug. The cross-project fold
 * has existed in core since C2 and is exposed over HTTP and in the CLI, but the
 * agent could not reach it — so a chief-of-staff routine asked "what is due
 * today" by calling this once per registered project. On this install that was
 * eleven calls, eleven prompt round-trips, and a morning anchor that ran out of
 * iterations before it managed to say anything.
 *
 * Omitting `project` now means "everywhere", matching list_commitments. Passing
 * one keeps the old behaviour exactly.
 */
export default {
  name: "list_tasks",
  schema: {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        "List tasks. Use when the user asks 'what's pending', 'qué tengo que hacer', or to recall TODOs. " +
        "Searches ALL projects unless you pass `project` — for anything cross-project " +
        "(what is due today, what is overdue, a morning summary) OMIT it and call this ONCE. " +
        "Never loop over projects calling this per project. Defaults to open tasks.",
      parameters: {
        type: "object",
        properties: {
          project:    { type: "string", description: "Optional project id, name or path. Omit to search every project." },
          state:      { type: "string", enum: ["open", "done", "dropped", "all"], description: "Filter by state. Default 'open'." },
          status:     { type: "string", enum: ["pending", "running", "in_review", "blocked"], description: "Workflow sub-status of an open task." },
          tag:        { type: "string", description: "Filter by exact tag match." },
          agent:      { type: "string", description: "Filter by agent slug." },
          due_before: { type: "string", description: "Return only tasks due on or before this ISO date." },
          parent:     { type: "string", description: "Return only the SUBTASKS of this task id. Pass an empty string for top-level tasks only." },
          limit:      { type: "number", description: "Cap on rows returned. Default 100." },
        },
      },
    },
  },
  makeHandler: ({ projects }) => async (args = {}) => {
    const { project: ref, state, status, tag, agent, due_before, limit, parent } = args;
    const opts = {
      ...(parent !== undefined ? { parent } : {}),
      state: state || undefined,
      status: status || undefined,
      tag: tag || undefined,
      agent: agent || undefined,
      due_before: due_before || undefined,
      limit: typeof limit === "number" ? limit : 100,
    };

    if (ref) {
      const r = String(ref);
      const found = projects.list().find((p) => String(p.id) === r || p.name === r || p.path === r);
      if (!found) return { error: `project not found: ${ref}` };
      const proj = projects.get(found.id);
      if (!proj) return { error: `project storage not loaded: ${ref}` };
      return listTasks(proj.storagePath, opts).map(compact);
    }

    const entries = [];
    for (const entry of projects.list()) {
      const p = projects.get(entry.id);
      if (!p?.storagePath) continue;
      entries.push({ id: entry.id, name: entry.name || entry.path, path: entry.path, storagePath: p.storagePath });
    }
    const { tasks, skipped } = listTasksAcrossProjects(entries, opts);
    return {
      tasks: tasks.map(compact),
      // Say what could not be read rather than quietly reporting less — an
      // anchor that says "nothing due" because a store failed to open is worse
      // than one that says it could not check.
      ...(skipped.length ? { skipped } : {}),
    };
  },
};

/** Only the fields worth spending prompt tokens on. */
function compact(t) {
  return {
    id: t.id,
    state: t.state,
    status: t.status,
    title: t.title,
    tags: t.tags,
    due: t.due,
    agent: t.agent,
    created_at: t.created_at,
    // Only when they say something — a "0 subtasks, 0 comments" pair on every
    // row is prompt tokens spent to communicate nothing.
    ...(t.subtask_count ? { subtasks: `${t.subtask_done}/${t.subtask_count}` } : {}),
    ...(t.comment_count ? { comments: t.comment_count } : {}),
    ...(t.parent ? { parent: t.parent } : {}),
    ...(t.project_name ? { project: t.project_name } : {}),
  };
}
