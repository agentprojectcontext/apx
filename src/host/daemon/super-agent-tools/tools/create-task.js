import { createTask } from "#core/stores/tasks.js";

export default {
  name: "create_task",
  schema: {
    type: "function",
    function: {
      name: "create_task",
      description:
        "Create a TODO task in a project. Use when the user asks you to remember something to do later, take note of a follow-up, or track a pending item. Project resolves by id, name or absolute path — call list_projects first if unsure.",
      parameters: {
        type: "object",
        required: ["project", "title"],
        properties: {
          project: { type: "string", description: "Project id, name, or path." },
          title:   { type: "string", description: "Short imperative title for the task." },
          body:    { type: "string", description: "Optional longer description." },
          tags:    { type: "array", items: { type: "string" }, description: "Optional tags." },
          due:     { type: "string", description: "Optional ISO date (YYYY-MM-DD) the task is due by." },
          agent:   { type: "string", description: "Optional agent slug responsible for the task." },
          source:  { type: "string", description: "Where the task came from (telegram, desktop, …). Defaults to the calling channel." },
        },
      },
    },
  },
  makeHandler: ({ projects }) => async ({ project: ref, title, body, tags, due, agent, source }) => {
    if (!ref) return { error: "project required" };
    if (!title) return { error: "title required" };
    const all = projects.list();
    const r = String(ref);
    const found = all.find((p) =>
      String(p.id) === r || p.name === r || p.path === r
    );
    if (!found) return { error: `project not found: ${ref}` };
    const proj = projects.get(found.id);
    if (!proj) return { error: `project storage not loaded: ${ref}` };
    const task = createTask(proj.storagePath, {
      title,
      body: body || null,
      tags: Array.isArray(tags) ? tags : [],
      due: due || null,
      agent: agent || null,
      source: source || "super-agent",
    });
    return {
      id: task.id,
      project: { id: proj.id, name: proj.name },
      title: task.title,
      state: task.state,
    };
  },
};
