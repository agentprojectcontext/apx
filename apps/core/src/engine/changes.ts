// What a folder has uncommitted, per git, for the chat's Changes panel; and what one turn changed there, for the card at
// its end (a snapshot when it starts, compared when it ends).
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ChangedFile, Part } from "@apx/protocol";

const run = promisify(execFile);
const MAX_FILES = 50;
/** The most of one file's diff the panel shows. */
const MAX_DIFF = 200 * 1024;

/** git, with the repo's own config unable to make it run anything: no fsmonitor, hooks, external diff or textconv. */
export const gitBoth = (cwd: string, args: string[], timeout = 10_000, env: Record<string, string> = {}) =>
  run(
    "git",
    ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "--no-optional-locks", "-C", cwd, ...args],
    // Never a prompt nobody can answer: a remote that needs credentials fails instead of waiting on a terminal.
    {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", ...env },
    },
  );
/** git's output (what it reports on stderr, as push and pull do, is in `gitBoth`). */
export const git = (cwd: string, args: string[], timeout = 10_000) => gitBoth(cwd, args, timeout).then((r) => r.stdout);

/**
 * Every uncommitted file under `cwd` (paths relative to it, git gives them from the repo's root) with its lines added
 * and removed; undefined outside a git work tree.
 */
export async function gitStatus(cwd: string): Promise<ChangedFile[] | undefined> {
  let status: string;
  let numstat: string;
  let prefix: string;
  try {
    [prefix, status, numstat] = await Promise.all([
      git(cwd, ["rev-parse", "--show-prefix"]).then((x) => x.trim()),
      git(cwd, ["status", "--porcelain=v1", "--untracked-files=all", "--", "."]),
      git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "HEAD", "--numstat", "--", "."]).catch(() => ""),
    ]);
  } catch {
    return undefined;
  }
  const counts = new Map<string, { added: number; removed: number }>();
  for (const line of numstat.split("\n")) {
    const [a, r, file] = line.split("\t");
    if (file && a !== "-") counts.set(file.split(" => ").at(-1) ?? file, { added: Number(a), removed: Number(r) });
  }
  return status
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const file = line.slice(3).split(" -> ").at(-1) ?? "";
      const c = counts.get(file);
      const rel = file.startsWith(prefix) ? file.slice(prefix.length) : file;
      return { path: rel.replace(/^"|"$/g, ""), status: line.slice(0, 2).trim() || "M", ...(c ?? {}) };
    });
}

/** Undefined when the folder is not in a git work tree, or nothing is uncommitted. */
export async function gitChanges(cwd: string): Promise<Extract<Part, { type: "changes" }> | undefined> {
  const files = await gitStatus(cwd);
  if (!files?.length) return undefined;
  return {
    type: "changes",
    cwd,
    files: files.slice(0, MAX_FILES),
    ...(files.length > MAX_FILES ? { more: files.length - MAX_FILES } : {}),
  };
}

/**
 * The folder as it is now, tracked and untracked (what .gitignore keeps out stays out), as a git tree; undefined
 * outside a work tree or when git cannot. A private index leaves the owner's staging area alone.
 */
export async function gitSnapshot(cwd: string): Promise<string | undefined> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-snapshot-"));
  const env = { GIT_INDEX_FILE: path.join(dir, "index") };
  try {
    // Outside this folder the snapshot is HEAD, so only what changes here can differ.
    await gitBoth(cwd, ["read-tree", "HEAD"], 10_000, env).catch(() => undefined);
    await gitBoth(cwd, ["add", "-A", "--", "."], 30_000, env);
    return (await gitBoth(cwd, ["write-tree"], 10_000, env)).stdout.trim() || undefined;
  } catch {
    return undefined;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** What changed under `cwd` since the snapshot `before` (paths relative to it); undefined when nothing did. */
export async function turnChanges(
  cwd: string,
  before: string,
): Promise<Extract<Part, { type: "changes" }> | undefined> {
  const after = await gitSnapshot(cwd);
  if (!after || after === before) return undefined;
  let prefix: string;
  let names: string;
  let numstat: string;
  try {
    [prefix, names, numstat] = await Promise.all([
      git(cwd, ["rev-parse", "--show-prefix"]).then((x) => x.trim()),
      git(cwd, ["diff-tree", "-r", "--no-renames", "--name-status", before, after, "--", "."]),
      git(cwd, [
        "diff-tree",
        "-r",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "--numstat",
        before,
        after,
        "--",
        ".",
      ]),
    ]);
  } catch {
    return undefined;
  }
  const counts = new Map<string, { added: number; removed: number }>();
  for (const line of numstat.split("\n")) {
    const [a, r, file] = line.split("\t");
    if (file && a !== "-") counts.set(file, { added: Number(a), removed: Number(r) });
  }
  const files: ChangedFile[] = names
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status = "M", file = ""] = line.split("\t");
      const rel = file.startsWith(prefix) ? file.slice(prefix.length) : file;
      return { path: rel, status, ...(counts.get(file) ?? {}) };
    });
  if (!files.length) return undefined;
  return {
    type: "changes",
    cwd,
    files: files.slice(0, MAX_FILES),
    ...(files.length > MAX_FILES ? { more: files.length - MAX_FILES } : {}),
  };
}

/** One file's unified diff against HEAD (a new file: all of it as added), cut at MAX_DIFF. */
export async function gitDiff(cwd: string, file: string): Promise<{ diff: string; truncated: boolean }> {
  const tracked = await git(cwd, ["ls-files", "--", file]).catch(() => "");
  let diff: string;
  if (tracked.trim()) {
    diff = await git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "HEAD", "--", file]).catch(() => "");
  } else {
    // `--no-index` exits 1 when the files differ, which they always do here.
    diff = await git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--no-index", "--", "/dev/null", file]).catch(
      (e: { stdout?: string }) => e.stdout ?? "",
    );
  }
  return diff.length > MAX_DIFF ? { diff: diff.slice(0, MAX_DIFF), truncated: true } : { diff, truncated: false };
}

/** A bounded turn snapshot, independent of the folder's repository or subsequent file changes. */
export async function textDiff(before: string, after: string, limit = 64_000, timeout = 1500) {
  if (before === after) return { diff: "", truncated: false, added: 0, removed: 0 };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-edit-diff-"));
  try {
    fs.writeFileSync(path.join(dir, "before"), before, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, "after"), after, { mode: 0o600 });
    const output = await git(
      dir,
      ["diff", "--no-ext-diff", "--no-textconv", "--no-index", "--", "before", "after"],
      timeout,
    ).catch((error: unknown) => {
      const failure = error as { code?: number; stdout?: string };
      if (failure.code === 1 && typeof failure.stdout === "string") return failure.stdout;
      throw error;
    });
    const start = output.indexOf("@@ ");
    if (start < 0) return undefined;
    const diff = output.slice(start);
    const added = diff.split("\n").filter((line) => line.startsWith("+")).length;
    const removed = diff.split("\n").filter((line) => line.startsWith("-")).length;
    return { diff: diff.slice(0, limit), truncated: diff.length > limit, added, removed };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
