import fs from "node:fs";
import path from "node:path";
import { confirmedProperty, resolveProject, safePathJoin } from "../helpers.js";

export default {
  name: "write_file",
  schema: {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a UTF-8 text file inside default or a project.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          path: { type: "string", description: "relative path inside the project" },
          content: { type: "string" },
          confirmed: confirmedProperty("true only after explicit user confirmation for this exact file write"),
        },
        required: ["path", "content"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, path: sub, content, confirmed = false }) => {
    await requirePermission("write_file", { dangerous: true, confirmed, args: { path: sub } });
    if (!sub) throw new Error("write_file: path required");
    const p = resolveProject(projects, project);
    const target = safePathJoin(p.path, sub);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    return { ok: true, path: target, bytes: Buffer.byteLength(content, "utf8") };
  },
};
