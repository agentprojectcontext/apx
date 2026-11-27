// What a `git restore` (or `git checkout -- paths`) would overwrite where it runs: the files with edits git does not
// keep yet. A file deleted in the working tree comes back, which loses nothing (DECISIONS.md#d-266).
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * The files under `targets` (relative to `dir`) whose edits a restore overwrites, absolute; `staged` when it restores
 * the index too. Undefined when git cannot say (no repository, no git, too slow): the caller then counts them all.
 */
export type Overwritten = (dir: string, targets: string[], staged: boolean) => string[] | undefined;

/** Working-tree states a restore overwrites: modified or of another type. `D` is a deletion it brings back. */
const EDITED = new Set(["M", "T"]);
/** Index states a restore of the index throws away: staged edits and staged new files. */
const STAGED = new Set(["M", "T", "A"]);

const git = (dir: string, args: string[]) =>
  execFileSync("git", ["--no-optional-locks", "-C", dir, ...args], {
    encoding: "utf8",
    timeout: 3000,
    maxBuffer: 8 << 20,
    stdio: ["ignore", "pipe", "ignore"],
  });

export const overwritten: Overwritten = (dir, targets, staged) => {
  try {
    // Status paths are relative to the repository's top; the prefix turns them relative to `dir`, as written.
    const prefix = git(dir, ["rev-parse", "--show-prefix"]).trim();
    const out = git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=no", "--no-renames", "--", ...targets]);
    const lost: string[] = [];
    for (const entry of out.split("\0")) {
      if (entry.length < 4) continue;
      const [x = " ", y = " "] = entry;
      if (EDITED.has(y) || (staged && STAGED.has(x)))
        lost.push(path.resolve(dir, path.posix.relative(prefix || ".", entry.slice(3))));
    }
    return lost;
  } catch {
    return undefined;
  }
};

/** What a deletion card's classifier asks git: whether a branch or a worktree only holds work already merged. */
export type GitFacts = {
  /** The branch's commits are all in the checked-out branch of `dir`. */
  merged(dir: string, branch: string): boolean;
  /** The worktree has no change git does not keep (untracked files included), and its commit is merged. */
  cleanMerged(worktree: string): boolean;
};

const quiet = (dir: string, args: string[]) => {
  try {
    return git(dir, args);
  } catch {
    return undefined;
  }
};

export const gitFacts: GitFacts = {
  merged: (dir, branch) => quiet(dir, ["merge-base", "--is-ancestor", `refs/heads/${branch}`, "HEAD"]) !== undefined,
  cleanMerged(worktree) {
    if (quiet(worktree, ["status", "--porcelain", "--untracked-files=all"]) !== "") return false;
    const head = quiet(worktree, ["rev-parse", "HEAD"])?.trim();
    // The first worktree listed is the main checkout: its branch is where merged work is.
    const main = /^worktree (.+)$/m.exec(quiet(worktree, ["worktree", "list", "--porcelain"]) ?? "")?.[1];
    return !!head && !!main && quiet(main, ["merge-base", "--is-ancestor", head, "HEAD"]) !== undefined;
  },
};
