export default {
  name: "list_projects",
  schema: {
    type: "function",
    function: {
      name: "list_projects",
      description: "List the APX default project and every registered APC project. Returns id, kind, name, path, and agent count.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  makeHandler: ({ projects }) => () => {
    return projects.list().map((p) => ({
      id: p.id,
      kind: p.id === 0 ? "default" : "project",
      name: p.name,
      path: p.path,
      agents: p.agents,
    }));
  },
};
