import fs from "node:fs";
import path from "node:path";
import { resolveProject, safePathJoin } from "../helpers.js";

export default {
  name: "list_files",
  schema: {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and subdirectories inside default or a project.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          path: { type: "string", description: "relative path inside the project; default '.'" },
        },
        required: [],
      },
    },
  },
  makeHandler: ({ projects }) => ({ project, path: sub = "." } = {}) => {
    const p = resolveProject(projects, project);
    const target = safePathJoin(p.path, sub);
    if (!fs.existsSync(target)) return { error: `path not found: ${sub}` };
    if (!fs.statSync(target).isDirectory()) return { error: `${sub} is not a directory` };

    return fs.readdirSync(target).map((name) => {
      const full = path.join(target, name);
      const stat = fs.statSync(full);
      return {
        name,
        type: stat.isDirectory() ? "dir" : "file",
        size: stat.size,
      };
    });
  },
};
