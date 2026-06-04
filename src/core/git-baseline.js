// Git baseline helper for the Code module's "changes" view.
//
// A code session records a snapshot of the project's working tree when it
// starts (the "baseline"). The changes tab later diffs the CURRENT working
// tree against that baseline, so it shows ONLY what the session touched — not
// every pre-existing uncommitted change.
//
// Both snapshots are taken into a TEMPORARY git index (GIT_INDEX_FILE), so we
// never touch the user's real index or working tree. `git add -A` honours
// .gitignore, so ignored paths (node_modules, dist, …) stay out of the diff.
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

function git(cwd, args, extraEnv = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...extraEnv },
  });
}

function gitSafe(cwd, args, extraEnv = {}) {
  try {
    return git(cwd, args, extraEnv);
  } catch {
    return null;
  }
}

export function isGitRepo(cwd) {
  if (!cwd) return false;
  const out = gitSafe(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return (out || "").trim() === "true";
}

// Best-effort `git init` so the Code "changes" diff has something to compare
// against. Non-destructive: it only creates an empty .git (no commit, no index
// changes). Returns true if the directory is a git repo afterwards. Callers
// must guard against initializing dirs that shouldn't be repos (e.g. the apx
// home / default project).
export function initGitRepo(cwd) {
  if (!cwd) return false;
  if (isGitRepo(cwd)) return true;
  gitSafe(cwd, ["init"]);
  return isGitRepo(cwd);
}

function headSha(cwd) {
  const out = gitSafe(cwd, ["rev-parse", "HEAD"]);
  return out ? out.trim() : null;
}

// Write the CURRENT working-tree state (tracked + untracked, minus .gitignore)
// to a fresh tree object using a throwaway index. Returns the tree sha.
function snapshotTree(cwd) {
  const tmpIndex = path.join(os.tmpdir(), `apx-code-idx-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    // Seed the temp index from HEAD when there is one (empty repos have none).
    if (headSha(cwd)) gitSafe(cwd, ["read-tree", "HEAD"], env);
    git(cwd, ["add", "-A"], env);
    return git(cwd, ["write-tree"], env).trim();
  } finally {
    try {
      fs.rmSync(tmpIndex, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Capture a baseline of the project's working tree. Non-mutating.
 * Returns { baselineCommit, baselineTree } or null when cwd isn't a git repo.
 */
export function captureBaseline(cwd) {
  if (!isGitRepo(cwd)) return null;
  let baselineTree;
  try {
    baselineTree = snapshotTree(cwd);
  } catch {
    return null;
  }
  // The commit object is best-effort (handy for debugging); the tree alone is
  // enough to diff against. Force an identity so commit-tree never fails on a
  // machine without user.name/email configured.
  const idEnv = {
    GIT_AUTHOR_NAME: "apx",
    GIT_AUTHOR_EMAIL: "apx@local",
    GIT_COMMITTER_NAME: "apx",
    GIT_COMMITTER_EMAIL: "apx@local",
  };
  const parent = headSha(cwd);
  const args = ["commit-tree", baselineTree, "-m", "apx code session baseline"];
  if (parent) args.push("-p", parent);
  const commit = gitSafe(cwd, args, idEnv);
  return { baselineCommit: commit ? commit.trim() : null, baselineTree };
}

const STATUS_MAP = { A: "added", M: "modified", D: "deleted", T: "modified" };

/**
 * Diff the current working tree against a recorded baseline tree.
 * Returns an array of { path, status, additions, deletions, patch }.
 * Renames are split into add+delete (--no-renames) so the UI stays simple.
 */
export function diffAgainstBaseline(cwd, baselineTree) {
  if (!baselineTree || !isGitRepo(cwd)) return [];
  let currentTree;
  try {
    currentTree = snapshotTree(cwd);
  } catch {
    return [];
  }
  if (currentTree === baselineTree) return [];

  const base = ["diff", "--no-color", "--no-renames", baselineTree, currentTree];

  // numstat: "<add>\t<del>\t<path>" (counts are "-" for binary files).
  const counts = new Map();
  const numstat = gitSafe(cwd, [...base, "--numstat"]) || "";
  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const [add, del, ...rest] = line.split("\t");
    const p = rest.join("\t");
    if (p) counts.set(p, { additions: add === "-" ? null : Number(add), deletions: del === "-" ? null : Number(del) });
  }

  // name-status drives the file list + status; patch is fetched per file.
  const nameStatus = gitSafe(cwd, [...base, "--name-status"]) || "";
  const files = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const [code, ...rest] = line.split("\t");
    const p = rest.join("\t");
    if (!p) continue;
    const status = STATUS_MAP[code[0]] || "modified";
    const patch = gitSafe(cwd, [...base, "--", p]) || "";
    const c = counts.get(p) || { additions: null, deletions: null };
    files.push({ path: p, status, additions: c.additions, deletions: c.deletions, patch });
  }
  return files;
}
