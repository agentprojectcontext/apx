// git_diff — show the diff for a project. Defaults to unstaged working-tree
// changes; pass staged=true for the index, or `ref` to diff against a commit.
import { runGit, resolveGitCwd } from "./_git.js";

export default {
  name: "git_diff",
  category: "code",
  schema: {
    type: "function",
    function: {
      name: "git_diff",
      description:
        "Show the git diff for a project. Defaults to UNSTAGED changes (working tree vs index). Set staged=true for the index vs HEAD, or pass ref (a commit, branch, or 'HEAD~1') to diff the working tree against that ref. Optional path argument limits the diff to a file/directory. Output is capped — use git_status first to choose what to diff if the change is large.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "project id, name, or path" },
          cwd: { type: "string", description: "explicit working directory (overrides project)" },
          staged: { type: "boolean", description: "diff the index vs HEAD instead of the working tree" },
          ref: { type: "string", description: "ref to diff against (commit / branch / HEAD~N)" },
          path: { type: "string", description: "limit the diff to this path (file or directory)" },
          stat: { type: "boolean", description: "summary only (--stat) instead of full diff" },
        },
      },
    },
  },
  makeHandler: (ctx) => async ({ project, cwd, staged, ref, path: subPath, stat } = {}) => {
    const root = resolveGitCwd(ctx, { project, cwd });
    const args = ["diff", "--no-color"];
    if (stat) args.push("--stat");
    if (staged) args.push("--staged");
    if (ref) args.push(ref);
    if (subPath) args.push("--", subPath);
    const r = await runGit(args, { cwd: root });
    if (!r.ok) return { ok: false, error: r.stderr || `git diff exited ${r.code}` };
    return {
      ok: true,
      cwd: root,
      diff: r.stdout,
      truncated: r.truncated,
      args: args.slice(1),
    };
  },
};
