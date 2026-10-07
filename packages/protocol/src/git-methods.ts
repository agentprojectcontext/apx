// A project's repository as the owner works it from the panel: what changed, staged or not, committing it, and history.
import { z } from "zod";
import { Id } from "./domain.ts";

/** A changed file: its path from the repository's root, git's status letter, and lines added and removed. */
export const GitFile = z.object({
  path: z.string(),
  /** M modified, A added, D deleted, R renamed, U unmerged, ? untracked. */
  status: z.string(),
  /** A rename's old path. */
  from: z.string().optional(),
  added: z.number().int().optional(),
  removed: z.number().int().optional(),
});
export type GitFile = z.infer<typeof GitFile>;

export const GitCommit = z.object({
  sha: z.string(),
  subject: z.string(),
  author: z.string(),
  /** ISO date the commit was authored. */
  at: z.string(),
  /** Branches and tags pointing at it ("main", "origin/main", "tag: v2.0.7"). */
  refs: z.array(z.string()),
});
export type GitCommit = z.infer<typeof GitCommit>;

/** Paths in a stage or unstage: relative to the repository's root, never outside it. */
const Paths = z.array(z.string().min(1).max(1000)).min(1).max(500);

export const gitMethods = {
  /**
   * The project's repository: its branch, how far it is from its upstream, and what is staged and not. `repo` false
   * when the folder is not in one.
   */
  "git.status": {
    params: z.object({ project: Id }).strict(),
    result: z.object({
      repo: z.boolean(),
      root: z.string().optional(),
      branch: z.string().optional(),
      upstream: z.string().optional(),
      ahead: z.number().int().optional(),
      behind: z.number().int().optional(),
      staged: z.array(GitFile),
      unstaged: z.array(GitFile),
    }),
    effect: false,
    access: "human",
  },
  /** One file's diff: what is staged (`staged`) or what is not yet; an untracked file shows whole as added. */
  "git.diff": {
    params: z.object({ project: Id, path: z.string().min(1).max(1000), staged: z.boolean().default(false) }).strict(),
    result: z.object({ path: z.string(), diff: z.string(), truncated: z.boolean() }),
    effect: false,
    access: "human",
  },
  "git.stage": {
    params: z.object({ project: Id, paths: Paths }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  "git.unstage": {
    params: z.object({ project: Id, paths: Paths }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  /** Commits what is staged, with the repository's own author; the repository's hooks do not run. */
  "git.commit": {
    params: z.object({ project: Id, message: z.string().trim().min(1).max(10_000) }).strict(),
    result: z.object({ sha: z.string() }),
    effect: true,
    access: "human",
  },
  /** The current branch's history, newest first, a page at a time. */
  "git.log": {
    params: z
      .object({
        project: Id,
        limit: z.number().int().min(1).max(200).default(50),
        skip: z.number().int().min(0).default(0),
      })
      .strict(),
    result: z.object({ commits: z.array(GitCommit), more: z.boolean() }),
    effect: false,
    access: "human",
  },
  /** A commit: its message whole, and the files it changed with their lines. */
  "git.show": {
    params: z
      .object({
        project: Id,
        sha: z.string().regex(/^[0-9a-f]{4,64}$/i),
      })
      .strict(),
    result: z.object({ commit: GitCommit, body: z.string(), files: z.array(GitFile) }),
    effect: false,
    access: "human",
  },
  /** One file's change in a commit, against its first parent. */
  "git.commit_diff": {
    params: z
      .object({
        project: Id,
        sha: z.string().regex(/^[0-9a-f]{4,64}$/i),
        path: z.string().min(1).max(1000),
      })
      .strict(),
    result: z.object({ path: z.string(), diff: z.string(), truncated: z.boolean() }),
    effect: false,
    access: "human",
  },
} as const;
