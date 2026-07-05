import * as asana from "#core/integrations/plugins/asana.js";
import { resolveAsana, PROJECT_ARG } from "./_asana.js";

export default {
  name: "asana_update_task",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "asana_update_task",
      description: "Update an Asana task's fields (rename, complete, reschedule, reassign).",
      parameters: {
        type: "object",
        properties: {
          task_gid: { type: "string", description: "Asana task gid" },
          name: { type: "string" },
          notes: { type: "string" },
          completed: { type: "boolean" },
          due_on: { type: "string", description: "YYYY-MM-DD" },
          assignee: { type: "string" },
          ...PROJECT_ARG,
        },
        required: ["task_gid"],
      },
    },
  },
  makeHandler: ({ projects }) => async ({ project, task_gid, name, notes, completed, due_on, assignee } = {}) => {
    const { token } = resolveAsana(projects, project);
    const task = await asana.updateTask(token, task_gid, { name, notes, completed, dueOn: due_on, assignee });
    return { task };
  },
};
