// git_status — porcelain working-tree status for a project. Returns the raw
// porcelain text plus a structured list of files so the model doesn't have to
// re-parse it.
import { runGit, resolveGitCwd } from "./_git.js";

function parsePorcelain(text) {
  const files = [];
  for (const line of String(text).split("\n")) {
    if (!line) continue;
    // Format: XY <path>  (optionally `XY <orig> -> <renamed>` for renames)
    const xy = line.slice(0, 2);
    const rest = line.slice(3);
    const renameIdx = rest.indexOf(" -> ");
    let pathStr = rest;
    let origPath = null;
    if (renameIdx >= 0) {
      origPath = rest.slice(0, renameIdx);
      pathStr = rest.slice(renameIdx + 4);
    }
    files.push({
      staged: xy[0] !== " " && xy[0] !== "?",
      unstaged: xy[1] !== " ",
      untracked: xy === "??",
      status: xy.trim(),
      path: pathStr,
      ...(origPath ? { original_path: origPath } : {}),
    });
  }
  return files;
}

export default {
  name: "git_status",
  category: "code",
  schema: {
    type: "function",
    function: {
      name: "git_status",
      description:
        "Show the git working-tree status (staged + unstaged + untracked) for a project. Returns porcelain output plus a parsed list of files. Pass project (id/name/path) OR cwd. Use this BEFORE summarizing changes or BEFORE staging.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "project id, name, or path; falls back to the active project if omitted" },
          cwd: { type: "string", description: "explicit working directory (overrides project)" },
        },
      },
    },
  },
  makeHandler: (ctx) => async ({ project, cwd } = {}) => {
    const root = resolveGitCwd(ctx, { project, cwd });
    const r = await runGit(["status", "--porcelain=v1", "-uall"], { cwd: root });
    if (!r.ok) return { ok: false, error: r.stderr || `git status exited ${r.code}` };
    return {
      ok: true,
      cwd: root,
      files: parsePorcelain(r.stdout),
      raw: r.stdout,
    };
  },
};
