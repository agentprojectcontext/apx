import { listArtifacts, readArtifact } from "#core/stores/artifacts.js";
import { resolveProject } from "../helpers.js";

export default {
  name: "list_artifacts",
  schema: {
    type: "function",
    function: {
      name: "list_artifacts",
      description:
        "List a project's artifacts — the managed files routines can run. Pass `name` to read one back " +
        "instead, which is how you check what an existing tool does before replacing it.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project id, name or path. Omit for the current one." },
          name: { type: "string", description: "Read this one's content instead of listing." },
        },
      },
    },
  },
  makeHandler: ({ projects }) => async ({ project, name } = {}) => {
    const p = resolveProject(projects, project);
    if (name) {
      const a = readArtifact(p.storagePath, name);
      return { name: a.name, path: a.path, content: a.content };
    }
    return listArtifacts(p.storagePath).map(({ name: n, size, modified }) => ({ name: n, size, modified }));
  },
};
