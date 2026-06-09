import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveProject, safePathJoin } from "../helpers.js";

const execFileAsync = promisify(execFile);

export default {
  name: "search_files",
  schema: {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for text patterns inside project files using ripgrep or grep.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The text or regex pattern to search for." },
          project: { type: "string" },
          path: { type: "string", description: "relative path inside the project to restrict search; default '.'" },
        },
        required: ["query"],
      },
    },
  },
  makeHandler: ({ projects }) => async ({ query, project, path: sub = "." } = {}) => {
    const p = resolveProject(projects, project);
    const target = safePathJoin(p.path, sub);

    try {
      const { stdout } = await execFileAsync("rg", ["-n", "--no-heading", "--color=never", query, target], {
        cwd: p.path,
        maxBuffer: 5 * 1024 * 1024,
      });
      return formatResults(stdout);
    } catch (e) {
      if (e.code === "ENOENT" || e.message.includes("ENOENT")) {
        try {
          const { stdout } = await execFileAsync("grep", ["-rn", query, target], {
            cwd: p.path,
            maxBuffer: 5 * 1024 * 1024,
          });
          return formatResults(stdout);
        } catch (e2) {
           if (e2.code === 1) return { result: "No matches found." };
           throw new Error(`grep failed: ${e2.message}`);
        }
      }
      if (e.code === 1) return { result: "No matches found." };
      return { error: `search failed: ${e.message}` };
    }
  },
};

function formatResults(stdout) {
  if (!stdout) return { result: "No matches found." };
  const lines = stdout.split('\n').slice(0, 100);
  const out = lines.join('\n');
  if (lines.length >= 100) {
    return { result: out + '\n...(truncated)' };
  }
  return { result: out };
}

