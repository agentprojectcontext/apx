import * as asana from "#core/integrations/plugins/asana.js";
import { resolveAsana, PROJECT_ARG } from "./_asana.js";

export default {
  name: "asana_list_tasks",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "asana_list_tasks",
      description: "List tasks in an Asana project.",
      parameters: {
        type: "object",
        properties: {
          project_gid: { type: "string", description: "Asana project gid (from asana_list_projects)" },
          completed: { type: "boolean", description: "Include completed tasks (default false)" },
          ...PROJECT_ARG,
        },
        required: ["project_gid"],
      },
    },
  },
  makeHandler: ({ projects }) => async ({ project, project_gid, completed = false } = {}) => {
    const { token } = resolveAsana(projects, project);
    return { tasks: await asana.listTasks(token, project_gid, completed) };
  },
};
