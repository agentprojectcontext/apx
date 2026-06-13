// git_log — recent commits for a project. One-line format by default.
import { runGit, resolveGitCwd } from "./_git.js";

export default {
  name: "git_log",
  category: "code",
  schema: {
    type: "function",
    function: {
      name: "git_log",
      description:
        "List recent commits for a project. Defaults to the last 20 commits in one-line format. Pass path to limit to a file/directory, ref to start from a different commit/branch, or full=true for the full message + stats.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "project id, name, or path" },
          cwd: { type: "string", description: "explicit working directory (overrides project)" },
          limit: { type: "integer", description: "max commits to return (default 20, capped at 200)" },
          ref: { type: "string", description: "ref to start from (branch / commit / HEAD~N); defaults to HEAD" },
          path: { type: "string", description: "limit to commits touching this path" },
          full: { type: "boolean", description: "show full subject + body + stat instead of oneline" },
        },
      },
    },
  },
  makeHandler: (ctx) => async ({ project, cwd, limit = 20, ref, path: subPath, full } = {}) => {
    const root = resolveGitCwd(ctx, { project, cwd });
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    const args = ["log", `-n${safeLimit}`, "--no-color"];
    if (full) args.push("--format=fuller", "--stat");
    else args.push("--oneline", "--decorate=short");
    if (ref) args.push(ref);
    if (subPath) args.push("--", subPath);
    const r = await runGit(args, { cwd: root });
    if (!r.ok) return { ok: false, error: r.stderr || `git log exited ${r.code}` };
    return { ok: true, cwd: root, log: r.stdout, truncated: r.truncated };
  },
};
