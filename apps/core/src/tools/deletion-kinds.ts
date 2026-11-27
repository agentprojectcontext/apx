// Which deletions Auto runs without a card (DECISIONS.md#d-281): what is plainly the agent's own or regenerated runs,
// what loses the owner's work asks, and the rest goes to a small model that reads the task (engine/deletion-judge.ts).

import fs from "node:fs";
import path from "node:path";
import type { DeletionReason } from "@apx/protocol";
import { insideReal } from "../paths.ts";
import type { Deletion, GitLoss } from "./command-deletions.ts";
import { type GitFacts, gitFacts } from "./command-git-status.ts";

/** `run`: no card; `ask`: the owner's card; `judge`: the small model decides, and a card when it cannot. */
export type Verdict = "run" | "ask" | "judge";

/** One thing a command deletes and what Auto does with it, and why. */
export type Weighed = { what: string; verdict: Verdict; why: DeletionReason };

/** Each reason in a few words, as the judge reads it. */
export const REASON_TEXT: Record<DeletionReason, string> = {
  scratch: "the chat's temp folder",
  gone: "does not exist",
  output: "build or test output",
  made: "made during this task",
  container: "containers this run started",
  merged_branch: "a merged branch",
  merged_worktree: "a merged worktree with nothing unsaved",
  outside: "outside the owner's projects",
  owner: "the owner's, not made during this task",
  unmerged_branch: "a branch with work not merged",
  open_worktree: "a worktree with unsaved or unmerged work",
  git_work: "work git does not keep elsewhere",
  too_many: "more files than Auto looks at",
  runtime: "known only when it runs",
  no_match: "a pattern that matches nothing yet",
};

export type DeletionPlace = {
  /** Folders of the owner's projects the agent may change: a deletion outside them asks. */
  roots: string[];
  /** The chat's temp folder: the agent's own scratch work. */
  scratch: string;
  /** When this task (or else this run) began: what was made since is the agent's own. */
  since: number;
  /** Earlier commands of this run: containers they started are the agent's own. */
  earlier: string[];
};

/** Folders tools regenerate: builds, test coverage and reports, caches, installed packages. */
const OUTPUT = new Set([
  "coverage",
  ".nyc_output",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "target",
  "node_modules",
  "test-results",
  "playwright-report",
  "__pycache__",
  ".pytest_cache",
]);

/** How many entries of a folder are looked at to tell it is all new; a bigger one is not plainly the agent's. */
const WALK_LIMIT = 500;

/** How many files a glob may match to be weighed one by one; past it, the owner's card. */
const MATCH_LIMIT = 1000;

const GLOB = /[*?[]/;

/** Each thing a deletion removes, weighed; `git` answers what only the repository knows. */
export function weighDeletion(d: Deletion, at: DeletionPlace, git: GitFacts = gitFacts): Weighed[] {
  return [
    ...d.paths.flatMap((p) => weighPath(p, at)),
    ...d.git.flatMap((l) => (l.soft ? [] : [weighGit(l, git)])),
    ...d.later.map((w) => weighLater(w, at)),
  ];
}

/** What Auto does with the whole command: any `ask` asks, all `run` runs, else the judge. */
export const verdictOf = (weighed: Weighed[]): Verdict =>
  weighed.some((w) => w.verdict === "ask") ? "ask" : weighed.every((w) => w.verdict === "run") ? "run" : "judge";

/** A path, or each file a glob matches on disk: the shell removes those, never the pattern as written. */
function weighPath(p: string, at: DeletionPlace): Weighed[] {
  if (!GLOB.test(p)) return [weighOne(p, at, { verdict: "run", why: "gone" })];
  const found = globMatches(p);
  if (!found) return [{ what: p, verdict: "ask", why: "too_many" }];
  if (!found.length) return [weighOne(p, at, { verdict: "judge", why: "no_match" })];
  return found.map((f) => weighOne(f, at, { verdict: "run", why: "gone" }));
}

function weighOne(p: string, at: DeletionPlace, missing: Omit<Weighed, "what">): Weighed {
  const what = p;
  if (insideReal(at.scratch, p)) return { what, verdict: "run", why: "scratch" };
  const root = at.roots.find((r) => insideReal(r, p));
  if (!root) return { what, verdict: "ask", why: "outside" };
  if (!there(p)) return { what, ...missing };
  const inside = path.relative(root, p).split(path.sep);
  if (inside.some((part) => OUTPUT.has(part))) return { what, verdict: "run", why: "output" };
  if (madeSince(p, at.since)) return { what, verdict: "run", why: "made" };
  return { what, verdict: "ask", why: "owner" };
}

/**
 * What a glob matches on disk, the pattern itself included when a file has that name; undefined past MATCH_LIMIT.
 * It matches more than the shell would (hidden files, anything from a `[`), never less: a quoted `*` is weighed too.
 */
function globMatches(pattern: string): string[] | undefined {
  const { root } = path.parse(pattern);
  let found = [root];
  for (const part of pattern.slice(root.length).split(path.sep).filter(Boolean)) {
    if (!GLOB.test(part)) {
      found = found.map((f) => path.join(f, part));
      continue;
    }
    const like = segmentPattern(part);
    const next: string[] = [];
    for (const folder of found) {
      let names: string[];
      try {
        names = fs.readdirSync(folder);
      } catch {
        continue;
      }
      for (const name of names) if (like.test(name)) next.push(path.join(folder, name));
      if (next.length > MATCH_LIMIT) return undefined;
    }
    found = next;
  }
  const all = new Set(found.filter(there));
  if (there(pattern)) all.add(pattern);
  return [...all];
}

/** Whether something is at `p`, a link included (a path through a file is nothing). */
function there(p: string): boolean {
  try {
    return !!fs.lstatSync(p, { throwIfNoEntry: false });
  } catch {
    return false;
  }
}

/** One path segment of a glob as a regular expression: `*` any run, `?` one character, from a `[` on anything. */
function segmentPattern(part: string): RegExp {
  let out = "";
  for (const ch of part) {
    if (ch === "[") return new RegExp(`^${out}.*$`, "s");
    out += ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[\\^$.|+(){}\]]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "s");
}

function weighGit(l: GitLoss, git: GitFacts): Weighed {
  const what = `${l.what} ${l.target}`;
  if (l.what === "branch")
    return l.in && git.merged(l.in, l.target)
      ? { what, verdict: "run", why: "merged_branch" }
      : { what, verdict: "ask", why: "unmerged_branch" };
  if (l.what === "worktree")
    return git.cleanMerged(l.target)
      ? { what, verdict: "run", why: "merged_worktree" }
      : { what, verdict: "ask", why: "open_worktree" };
  return { what, verdict: "ask", why: "git_work" };
}

function weighLater(w: string, at: DeletionPlace): Weighed {
  const removed = /^docker\s+(?:container\s+)?rm\s+((?:-\S+\s+)*)([\w.-]+(?:\s+[\w.-]+)*)\s*$/.exec(w.trim());
  const started = removed?.[2]?.split(/\s+/).every((name) => at.earlier.some((c) => startsContainer(c, name)));
  if (started) return { what: w, verdict: "run", why: "container" };
  return { what: w, verdict: "judge", why: "runtime" };
}

const startsContainer = (command: string, name: string) =>
  new RegExp(`\\bdocker\\s+(?:container\\s+)?(?:run|create)\\b[^;&|]*--name[= ]${name.replace(/[.]/g, "\\.")}\\b`).test(
    command,
  );

/** Whether `p` and, for a folder, everything in it were made since `since` (by the clock of their creation). */
function madeSince(p: string, since: number): boolean {
  let seen = 0;
  const born = (f: string): boolean => {
    const s = fs.lstatSync(f, { throwIfNoEntry: false });
    // Some file systems keep no creation time (0): nothing then is plainly new.
    if (!s?.birthtimeMs || s.birthtimeMs < since) return false;
    if (++seen > WALK_LIMIT) return false;
    if (!s.isDirectory()) return true;
    return fs.readdirSync(f).every((name) => born(path.join(f, name)));
  };
  return born(p);
}
