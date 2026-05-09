import path from "node:path";
import { readConfig, addProject as addProjectInConfig } from "../../../core/config.js";
import { confirmedProperty, projectMeta } from "../helpers.js";

export default {
  name: "add_project",
  schema: {
    type: "function",
    function: {
      name: "add_project",
      description: "Register an existing APC project path with the APX daemon. The path must contain AGENTS.md and .apc/project.json.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "absolute or relative filesystem path to an APC project" },
          confirmed: confirmedProperty("true only after explicit user confirmation for this exact project registration"),
        },
        required: ["path"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => ({ path: projectPath, confirmed = false }) => {
    requirePermission("add_project", { dangerous: true, confirmed });
    if (!projectPath) throw new Error("add_project: path required");

    const cfg = readConfig();
    const result = addProjectInConfig(cfg, projectPath);
    const p = projects.register(result.project.path);
    return {
      ok: true,
      added: result.added,
      project: projectMeta(projects, p),
      normalized_path: path.resolve(projectPath),
    };
  },
};
