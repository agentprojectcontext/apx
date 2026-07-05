import * as asana from "#core/integrations/plugins/asana.js";
import { resolveAsana, requireWorkspace, PROJECT_ARG } from "./_asana.js";

export default {
  name: "asana_create_task",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "asana_create_task",
      description: "Create an Asana task in the connected workspace.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Task title" },
          notes: { type: "string", description: "Task description/notes" },
          project_gid: { type: "string", description: "Optional Asana project gid to add the task to" },
          assignee: { type: "string", description: "Optional assignee (user gid or 'me')" },
          due_on: { type: "string", description: "Optional due date (YYYY-MM-DD)" },
          ...PROJECT_ARG,
        },
        required: ["name"],
      },
    },
  },
  makeHandler: ({ projects }) => async ({ project, name, notes, project_gid, assignee, due_on } = {}) => {
    const { token, config } = resolveAsana(projects, project);
    const task = await asana.createTask(token, {
      workspaceGid: requireWorkspace(config),
      name,
      notes,
      projectGid: project_gid,
      assignee,
      dueOn: due_on,
    });
    return { task };
  },
};
