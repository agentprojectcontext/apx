import fs from "node:fs";
import { resolveProject, safePathJoin } from "../helpers.js";

// A page of a text file, numbered. The old tool returned the first 64 KB and
// nothing else: a larger file was unreadable past that point, and without line
// numbers the model had nothing to anchor an edit or a reference on.
const DEFAULT_LIMIT = 2000;
const MAX_LINE_CHARS = 2000;
const MAX_PAGE_CHARS = 100 * 1024;

export default {
  name: "read_file",
  schema: {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a text file inside default or a project. Returns up to `limit` lines starting at `offset`, " +
        "each prefixed with its line number and a tab (strip that prefix before quoting text in an edit). " +
        "Read large files in pages with `next_offset`; prefer one big page over many tiny ones.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string" },
          path: { type: "string", description: "relative path inside the project" },
          offset: { type: "number", description: "1-based line to start at (default 1)" },
          limit: { type: "number", description: `how many lines (default ${DEFAULT_LIMIT})` },
        },
        required: ["path"],
      },
    },
  },
  makeHandler: ({ projects }) => ({ project, path, offset = 1, limit = DEFAULT_LIMIT }) => {
    if (!path) throw new Error("read_file: path required");
    const p = resolveProject(projects, project);
    const target = safePathJoin(p.path, path);
    if (!fs.existsSync(target)) return { error: `file not found: ${path}` };
    const stat = fs.statSync(target);
    if (!stat.isFile()) return { error: `${path} is not a file` };

    const lines = fs.readFileSync(target, "utf8").split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    const total = lines.length;
    const from = Math.max(1, Math.floor(Number(offset) || 1));
    const want = Math.max(1, Math.floor(Number(limit) || DEFAULT_LIMIT));
    if (from > total && total > 0) return { error: `offset ${from} is past the end (${total} lines)`, total_lines: total };

    const width = String(Math.min(total, from + want - 1)).length;
    const out = [];
    let size = 0;
    let to = from - 1;
    for (let i = from - 1; i < Math.min(total, from - 1 + want); i++) {
      let line = lines[i];
      if (line.length > MAX_LINE_CHARS) line = `${line.slice(0, MAX_LINE_CHARS)}… (line truncated)`;
      const row = `${String(i + 1).padStart(width, " ")}\t${line}`;
      if (size + row.length > MAX_PAGE_CHARS && out.length) break;
      out.push(row);
      size += row.length + 1;
      to = i + 1;
    }
    const more = to < total;
    return {
      content: out.join("\n"),
      total_lines: total,
      from,
      to,
      truncated: more,
      ...(more ? { next_offset: to + 1 } : {}),
    };
  },
};
