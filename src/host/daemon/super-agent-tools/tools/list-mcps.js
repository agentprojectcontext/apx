import { resolveProject } from "../helpers.js";

export default {
  name: "list_mcps",
  schema: {
    type: "function",
    function: {
      name: "list_mcps",
      description: "List MCPs. If project is omitted, returns all MCPs grouped by project, including default.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "project id/name/path; omit to list all projects" },
        },
        required: [],
      },
    },
  },
  makeHandler: ({ projects, registries }) => ({ project } = {}) => {
    const row = (m) => ({
      name: m.name,
      source: m.source,
      transport: m.transport,
      enabled: !!m.enabled,
      command: m.command,
      url: m.url,
    });

    const p = resolveProject(projects, project, { allowMulti: true });
    if (p) {
      if (!registries) throw new Error("MCP registry unavailable");
      return registries.for(p).list().map(row);
    }

    return projects.list().map((entry) => {
      const e = projects.get(entry.id);
      return {
        project: {
          id: entry.id,
          kind: entry.id === 0 ? "default" : "project",
          name: entry.name,
          path: entry.path,
        },
        mcps: registries ? registries.for(e).list().map(row) : [],
      };
    });
  },
};
