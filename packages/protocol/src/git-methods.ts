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
  /** Its parents' shas: two or more for a merge. */
  parents: z.array(z.string()),
});
export type GitCommit = z.infer<typeof GitCommit>;

/**
 * Which repository of the project: its folder's own (absent), or one inside it by its path from the folder
 * ("apps/site"), as `git.repos` lists them.
 */
const At = { project: Id, repo: z.string().max(500).optional() };

/** Paths in a stage or unstage: relative to the repository's root, never outside it. */
const Paths = z.array(z.string().min(1).max(1000)).min(1).max(500);

export const gitMethods = {
  /**
   * The project's repository: its branch, how far it is from its upstream, and what is staged and not. `repo` false
   * when the folder is not in one.
   */
  "git.status": {
    params: z.object({ ...At }).strict(),
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
    params: z.object({ ...At, path: z.string().min(1).max(1000), staged: z.boolean().default(false) }).strict(),
    result: z.object({ path: z.string(), diff: z.string(), truncated: z.boolean() }),
    effect: false,
    access: "human",
  },
  "git.stage": {
    params: z.object({ ...At, paths: Paths }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  "git.unstage": {
    params: z.object({ ...At, paths: Paths }).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
  /**
   * Commits what is staged (`all`: every change, staged or not), with the repository's own author; `amend` rewrites the
   * last commit instead. The repository's hooks do not run.
   */
  "git.commit": {
    params: z
      .object({
        ...At,
        message: z.string().trim().min(1).max(10_000),
        all: z.boolean().default(false),
        amend: z.boolean().default(false),
      })
      .strict(),
    result: z.object({ sha: z.string() }),
    effect: true,
    access: "human",
  },
  /** The current branch's history, newest first, a page at a time. */
  "git.log": {
    params: z
      .object({
        ...At,
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
        ...At,
        sha: z.string().regex(/^[0-9a-f]{4,64}$/i),
      })
      .strict(),
    result: z.object({ commit: GitCommit, body: z.string(), files: z.array(GitFile) }),
    effect: false,
    access: "human",
  },
  /**
   * A commit message for what is staged (or, with nothing staged, every change), written by the auxiliary model; empty
   * when there is none set up.
   */
  "git.suggest_message": {
    params: z.object({ ...At }).strict(),
    result: z.object({ message: z.string() }),
    effect: false,
    access: "human",
  },
  /** The local branches (the current one first) and the remote ones. */
  "git.branches": {
    params: z.object({ ...At }).strict(),
    result: z.object({ current: z.string().optional(), local: z.array(z.string()), remote: z.array(z.string()) }),
    effect: false,
    access: "human",
  },
  /** Switches to a branch, or makes it from where the repository is (`create`); git refuses when changes would be lost. */
  "git.checkout": {
    params: z
      .object({
        ...At,
        branch: z
          .string()
          .min(1)
          .max(200)
          .regex(/^(?!-)[^\s~^:?*[\\]+$/),
        create: z.boolean().default(false),
        /** Where a new branch starts (a branch, tag or commit); where the repository is when absent. */
        from: z
          .string()
          .min(1)
          .max(200)
          .regex(/^(?!-)[^\s~^:?*[\\]+$/)
          .optional(),
      })
      .strict(),
    result: z.object({ branch: z.string() }),
    effect: true,
    access: "human",
  },
  /**
   * A repository action: pull, push (setting the upstream the first time), fetch, stash the changes or bring the last
   * stash back, undo the last commit keeping its changes staged, or abort a merge or rebase that stopped on a conflict.
   * Returns git's own words.
   */
  "git.run": {
    params: z
      .object({
        ...At,
        action: z.enum(["pull", "push", "fetch", "stash", "stash_pop", "undo_commit", "merge_abort", "rebase_abort"]),
      })
      .strict(),
    result: z.object({ output: z.string() }),
    effect: true,
    access: "human",
  },
  /**
   * A branch operation: merge or rebase the current branch onto `branch`, rename the current branch to `branch`, delete
   * a local branch (`force` for one not merged), or delete a remote one ("origin/feature").
   */
  "git.branch": {
    params: z
      .object({
        ...At,
        op: z.enum(["merge", "rebase", "rename", "delete", "delete_remote"]),
        branch: z
          .string()
          .min(1)
          .max(200)
          .regex(/^(?!-)[^\s~^:?*[\\]+$/),
        force: z.boolean().default(false),
      })
      .strict(),
    result: z.object({ output: z.string() }),
    effect: true,
    access: "human",
  },
  /**
   * The repositories of a project: its folder's own when it is in one, and those in folders inside it (a few levels
   * down, past dependencies and hidden folders), by their path from the folder ("" for its own).
   */
  "git.repos": {
    params: z.object({ project: Id }).strict(),
    result: z.object({ repos: z.array(z.object({ path: z.string(), branch: z.string().optional() })) }),
    effect: false,
    access: "human",
  },
  /** One file's change in a commit, against its first parent. */
  "git.commit_diff": {
    params: z
      .object({
        ...At,
        sha: z.string().regex(/^[0-9a-f]{4,64}$/i),
        path: z.string().min(1).max(1000),
      })
      .strict(),
    result: z.object({ path: z.string(), diff: z.string(), truncated: z.boolean() }),
    effect: false,
    access: "human",
  },
} as const;
