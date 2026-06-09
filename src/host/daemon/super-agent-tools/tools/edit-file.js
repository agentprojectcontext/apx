import fs from "node:fs";
import { confirmedProperty, resolveProject, safePathJoin } from "../helpers.js";

export default {
  name: "edit_file",
  schema: {
    type: "function",
    function: {
      name: "edit_file",
      description: "Edit a UTF-8 text file inside default or a project by replacing one exact string with another.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          path: { type: "string", description: "relative path inside the project" },
          search: { type: "string", description: "exact text to replace" },
          replace: { type: "string", description: "replacement text" },
          all: { type: "boolean", description: "replace all matches; default false replaces one match" },
          confirmed: confirmedProperty("true only after explicit user confirmation for this exact file edit"),
        },
        required: ["path", "search", "replace"],
      },
    },
  },
  makeHandler: ({ projects, requirePermission }) => async ({ project, path, search, replace, all = false, confirmed = false }) => {
    await requirePermission("edit_file", { dangerous: true, confirmed, args: { path } });
    if (!path) throw new Error("edit_file: path required");
    if (!search) throw new Error("edit_file: search required");

    const p = resolveProject(projects, project);
    const target = safePathJoin(p.path, path);
    if (!fs.existsSync(target)) throw new Error(`file not found: ${path}`);
    const before = fs.readFileSync(target, "utf8");
    const matches = before.split(search).length - 1;
    if (matches === 0) throw new Error("search text not found");
    if (!all && matches > 1) {
      throw new Error(`search text appears ${matches} times; set all=true or use a more specific search`);
    }

    const after = all ? before.split(search).join(replace) : before.replace(search, replace);
    fs.writeFileSync(target, after, "utf8");
    return { ok: true, path: target, replacements: all ? matches : 1 };
  },
};
