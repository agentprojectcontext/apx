import * as asana from "#core/integrations/plugins/asana.js";
import { resolveAsana, requireWorkspace, PROJECT_ARG } from "./_asana.js";

export default {
  name: "asana_list_projects",
  category: "integrations",
  schema: {
    type: "function",
    function: {
      name: "asana_list_projects",
      description: "List Asana projects in the connected workspace.",
      parameters: { type: "object", properties: { ...PROJECT_ARG } },
    },
  },
  makeHandler: ({ projects }) => async ({ project } = {}) => {
    const { token, config } = resolveAsana(projects, project);
    return { projects: await asana.listProjects(token, requireWorkspace(config)) };
  },
};
