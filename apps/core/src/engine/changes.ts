// What a folder has uncommitted, per git: the card at the end of a code turn and the chat's Changes panel.
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
const git = (cwd: string, args: string[], timeout = 10_000) =>
  run(
    "git",
    ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "--no-optional-locks", "-C", cwd, ...args],
    { timeout, maxBuffer: 4 * 1024 * 1024 },
  ).then((r) => r.stdout);

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
