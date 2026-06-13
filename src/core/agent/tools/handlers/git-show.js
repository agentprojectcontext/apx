// git_show — inspect a single commit (or branch tip): subject, author, files
// changed, full diff.
import { runGit, resolveGitCwd } from "./_git.js";

export default {
  name: "git_show",
  category: "code",
  schema: {
    type: "function",
    function: {
      name: "git_show",
      description:
        "Show a single git commit (or any ref) — message, author, files changed, and full diff. Use `ref` to point at a commit hash, branch, or HEAD~N. Defaults to HEAD.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "project id, name, or path" },
          cwd: { type: "string", description: "explicit working directory (overrides project)" },
          ref: { type: "string", description: "ref to show (commit / branch / HEAD~N); defaults to HEAD" },
          stat: { type: "boolean", description: "show stat summary instead of full diff" },
        },
      },
    },
  },
  makeHandler: (ctx) => async ({ project, cwd, ref = "HEAD", stat } = {}) => {
    const root = resolveGitCwd(ctx, { project, cwd });
    const args = ["show", "--no-color"];
    if (stat) args.push("--stat");
    args.push(ref);
    const r = await runGit(args, { cwd: root });
    if (!r.ok) return { ok: false, error: r.stderr || `git show exited ${r.code}` };
    return { ok: true, cwd: root, ref, output: r.stdout, truncated: r.truncated };
  },
};
