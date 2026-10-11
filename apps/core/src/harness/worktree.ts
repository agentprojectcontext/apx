// The git metadata an agent's sandbox must be able to write for git to work in a linked worktree.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** What fetch, add and commit write in the shared git dir. See HISTORY.md#codex-linked-worktree */
const SHARED_GIT_WRITES = ["objects", "refs", "logs"] as const;

const realDir = (p: string): string | undefined => {
  try {
    const real = fs.realpathSync(p);
    return fs.statSync(real).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
};

/**
 * When `cwd` is inside a linked git worktree (its git dir is not the common dir): that worktree's git dir and the
 * common dir's `objects`, `refs` and `logs`, resolved through links. Never the common dir itself (config, hooks,
 * packed-refs), another worktree's metadata or a checkout. [] for a main checkout, a non-repo, or any failure.
 */
export async function linkedWorktreeWritableDirs(cwd: string): Promise<string[]> {
  // An inherited GIT_DIR or GIT_WORK_TREE (git exports them to hooks) would make git ignore cwd.
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("GIT_")) env[k] = v;
  try {
    const { stdout } = await run(
      "git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        "--no-optional-locks",
        "rev-parse",
        "--path-format=absolute",
        "--git-dir",
        "--git-common-dir",
      ],
      { cwd, env: { ...env, GIT_TERMINAL_PROMPT: "0" }, timeout: 10_000 },
    );
    const [gitDir, commonDir] = stdout
      .trim()
      .split("\n")
      .map((l) => realDir(l.trim()));
    // Only the layout `git worktree add` makes: <common>/worktrees/<name>.
    if (!gitDir || !commonDir || path.dirname(gitDir) !== path.join(commonDir, "worktrees")) return [];
    const shared = SHARED_GIT_WRITES.map((d) => realDir(path.join(commonDir, d)));
    // A shared dir that is a link out of the common dir would widen the grant: skip it.
    const inside = shared.filter((d): d is string => !!d && path.dirname(d) === commonDir);
    return [gitDir, ...inside];
  } catch {
    return [];
  }
}
