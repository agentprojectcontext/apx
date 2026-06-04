import { listTasks } from "../../../../core/tasks-store.js";

export default {
  name: "list_tasks",
  schema: {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        "List tasks for a project. Use when the user asks 'what's pending', 'qué tengo que hacer', or to recall TODOs. Defaults to open tasks. Project resolves by id, name or absolute path.",
      parameters: {
        type: "object",
        required: ["project"],
        properties: {
          project:    { type: "string", description: "Project id, name, or path." },
          state:      { type: "string", enum: ["open", "done", "dropped", "all"], description: "Filter by state. Default 'open'." },
          tag:        { type: "string", description: "Filter by exact tag match." },
          agent:      { type: "string", description: "Filter by agent slug." },
          due_before: { type: "string", description: "Return only tasks due on or before this ISO date." },
          limit:      { type: "number", description: "Cap on rows returned. Default unlimited (clamped server-side)." },
        },
      },
    },
  },
  makeHandler: ({ projects }) => async ({ project: ref, state, tag, agent, due_before, limit }) => {
    if (!ref) return { error: "project required" };
    const all = projects.list();
    const r = String(ref);
    const found = all.find((p) =>
      String(p.id) === r || p.name === r || p.path === r
    );
    if (!found) return { error: `project not found: ${ref}` };
    const proj = projects.get(found.id);
    if (!proj) return { error: `project storage not loaded: ${ref}` };
    const rows = listTasks(proj.storagePath, {
      state: state || undefined,
      tag: tag || undefined,
      agent: agent || undefined,
      due_before: due_before || undefined,
      limit: typeof limit === "number" ? limit : undefined,
    });
    return rows.map((t) => ({
      id: t.id,
      state: t.state,
      title: t.title,
      tags: t.tags,
      due: t.due,
      agent: t.agent,
      created_at: t.created_at,
    }));
  },
};
