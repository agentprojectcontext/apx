import { countTasks, listTasks, listTasksAcrossProjects } from "#core/stores/tasks.js";
import { resolveOwnerName } from "#core/identity/self.js";

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
 *
 * An EMPTY filtered list is never returned bare: `{state:"all",status:"pending"}`
 * over a board of one running and one blocked task is zero rows, and the model
 * reported "the project has no tasks". The empty answer carries the filters it
 * applied and the project's real counts, so "no matches" cannot read as "empty".
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
        "Never loop over projects calling this per project. Defaults to open tasks. " +
        "For 'how is the project going' / a status overview pass `summary: true`: it returns counts per " +
        "status (custom columns included), open vs closed and what waits on the owner — never conclude " +
        "'there are no tasks' from a filtered list.",
      parameters: {
        type: "object",
        properties: {
          project:    { type: "string", description: "Optional project id, name or path. Omit to search every project." },
          state:      { type: "string", enum: ["open", "done", "dropped", "all"], description: "Filter by state. Default 'open'." },
          // No enum: an install can configure its own columns, and an enum of the
          // four built-ins made every custom column unreachable.
          status:     { type: "string", description: "Workflow column of an open task: pending, running, in_review, blocked, or a custom column id." },
          tag:        { type: "string", description: "Filter by exact tag match." },
          agent:      { type: "string", description: "Filter by agent slug." },
          due_before: { type: "string", description: "Return only tasks due on or before this ISO date." },
          parent:     { type: "string", description: "Return only the SUBTASKS of this task id. Pass an empty string for top-level tasks only." },
          limit:      { type: "number", description: "Cap on rows returned. Default 100." },
          summary:    { type: "boolean", description: "Return counts per state/status instead of rows. Ignores the other filters." },
        },
      },
    },
  },
  makeHandler: ({ projects }) => async (args = {}) => {
    const { project: ref, state, status, tag, agent, due_before, limit, parent, summary } = args;
    const ownerName = resolveOwnerName();
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
      const name = found.name || found.path || String(found.id);
      if (summary) return { scope: "project", project: name, ...countTasks(proj.storagePath, { owner_name: ownerName }) };
      const rows = listTasks(proj.storagePath, opts);
      // Non-empty keeps the bare array callers already read.
      if (rows.length) return rows.map(compact);
      return noMatches({ filters: effectiveFilters(opts), counts: countTasks(proj.storagePath, { owner_name: ownerName }), project: name });
    }

    const entries = [];
    for (const entry of projects.list()) {
      const p = projects.get(entry.id);
      if (!p?.storagePath) continue;
      entries.push({ id: entry.id, name: entry.name || entry.path, path: entry.path, storagePath: p.storagePath });
    }

    if (summary) {
      const out = [];
      const skipped = [];
      for (const e of entries) {
        try { out.push({ project: e.name, ...countTasks(e.storagePath, { owner_name: ownerName }) }); }
        catch (err) { skipped.push({ id: e.id, error: err?.message || String(err) }); }
      }
      return { scope: "all_projects", projects: out, ...(skipped.length ? { skipped } : {}) };
    }

    const { tasks, skipped } = listTasksAcrossProjects(entries, opts);
    const base = {
      tasks: tasks.map(compact),
      // Say what could not be read rather than quietly reporting less — an
      // anchor that says "nothing due" because a store failed to open is worse
      // than one that says it could not check.
      ...(skipped.length ? { skipped } : {}),
    };
    if (tasks.length) return base;
    let open = 0;
    let total = 0;
    for (const e of entries) {
      try { const c = countTasks(e.storagePath); open += c.open; total += c.total; } catch { /* already in skipped */ }
    }
    return { ...base, ...noMatches({ filters: effectiveFilters(opts), counts: { open, total } }) };
  },
};

/** The filters that actually narrowed the query, defaults spelled out. */
function effectiveFilters(opts) {
  const f = { state: opts.state || "open" };
  for (const k of ["status", "tag", "agent", "due_before"]) if (opts[k]) f[k] = opts[k];
  if (opts.parent !== undefined) f.parent = opts.parent || "(top-level only)";
  return f;
}

/** An empty result that says what was asked and what actually exists. */
function noMatches({ filters, counts, project = null }) {
  const scope = project ? `project ${project}` : "all projects";
  return {
    tasks: [],
    matched: 0,
    filters,
    ...(project ? { project, project_counts: counts } : { totals: counts }),
    note: counts.total
      ? `No task matches these filters, but ${scope} has ${counts.total} task(s), ${counts.open} open. ` +
        "Say 'nothing matches', not 'there are no tasks'. Use summary:true for the full picture."
      : `${scope} has no tasks at all.`,
  };
}

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
