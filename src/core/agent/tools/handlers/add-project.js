import fs from "node:fs";
import path from "node:path";
import { readConfig, addProject as addProjectInConfig } from "#core/config/index.js";
import { initApf } from "#core/apc/scaffold.js";
import { projectMeta } from "../helpers.js";

function isApcProject(absPath) {
  return (
    fs.existsSync(path.join(absPath, "AGENTS.md")) &&
    fs.existsSync(path.join(absPath, ".apc", "project.json"))
  );
}

export default {
  name: "add_project",
  schema: {
    type: "function",
    function: {
      name: "add_project",
      description:
        "Register a project path with the APX daemon. If the path is not yet an APC project (missing AGENTS.md or .apc/project.json), the tool runs the init scaffold first and then registers it — one call covers both cases. Pass init=false to require the path to already be an APC project (strict mode).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "absolute or relative filesystem path to add" },
          name: { type: "string", description: "optional project name (used only when initializing a new APC project)" },
          init: { type: "boolean", description: "auto-create AGENTS.md and .apc/project.json if missing (default true)" },
        },
        required: ["path"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ path: projectPath, name, init = true, confirmed = false }) => {
    await requirePermission("add_project", { dangerous: true, confirmed, args: { path: projectPath } });
    if (!projectPath) throw new Error("add_project: path required");

    const abs = path.resolve(projectPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`add_project: path does not exist: ${abs}`);
    }

    let initialized = false;
    if (!isApcProject(abs)) {
      if (!init) {
        throw new Error(
          `not an APC project: ${abs} (no AGENTS.md / .apc/project.json). ` +
          `Pass init=true to scaffold it before registering.`
        );
      }
      initApf(abs, { name });
      initialized = true;
    }

    const cfg = readConfig();
    const result = addProjectInConfig(cfg, abs);
    const p = projects.register(result.project.path);
    return {
      ok: true,
      added: result.added,
      initialized,
      project: projectMeta(projects, p),
      normalized_path: abs,
    };
  },
};
