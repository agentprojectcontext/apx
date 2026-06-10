import { readAgents } from "../../../../core/apc/parser.js";
import { agentRow, resolveProject } from "../helpers.js";

export default {
  name: "list_agents",
  schema: {
    type: "function",
    function: {
      name: "list_agents",
      description: "List agents. If project is omitted, returns all agents grouped by project, including default.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "project id, name, path, or substring; omit to list all projects" },
        },
        required: [],
      },
    },
  },
  makeHandler: ({ projects }) => ({ project } = {}) => {
    const p = resolveProject(projects, project, { allowMulti: true });
    if (p) return readAgents(p.path).map(agentRow);
    return projects.list().map((entry) => {
      const e = projects.get(entry.id);
      return {
        project: {
          id: entry.id,
          kind: entry.id === 0 ? "default" : "project",
          name: entry.name,
          path: entry.path,
        },
        agents: readAgents(e.path).map(agentRow),
      };
    });
  },
};
