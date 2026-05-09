import fs from "node:fs";
import { resolveProject, safePathJoin } from "../helpers.js";

export default {
  name: "read_file",
  schema: {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file inside default or a project. Returns first 64KB.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          path: { type: "string", description: "relative path inside the project" },
        },
        required: ["path"],
      },
    },
  },
  makeHandler: ({ projects }) => ({ project, path }) => {
    if (!path) throw new Error("read_file: path required");
    const p = resolveProject(projects, project);
    const target = safePathJoin(p.path, path);
    if (!fs.existsSync(target)) return { error: `file not found: ${path}` };
    const stat = fs.statSync(target);
    if (!stat.isFile()) return { error: `${path} is not a file` };
    return {
      content: fs.readFileSync(target, "utf8").slice(0, 64 * 1024),
      truncated: stat.size > 64 * 1024,
    };
  },
};
