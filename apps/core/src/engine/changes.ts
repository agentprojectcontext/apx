// What a code thread's folder has uncommitted, per git, for the card at the end of a turn.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Part } from "@apx/protocol";

const run = promisify(execFile);
const MAX_FILES = 50;

/** Undefined when the folder is not in a git work tree, or nothing is uncommitted. */
export async function gitChanges(cwd: string): Promise<Extract<Part, { type: "changes" }> | undefined> {
  const git = (args: string[]) =>
    run("git", ["-C", cwd, ...args], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }).then((r) => r.stdout);
  let status: string;
  let numstat: string;
  try {
    [status, numstat] = await Promise.all([
      git(["status", "--porcelain=v1", "--untracked-files=all", "--", "."]),
      git(["diff", "HEAD", "--numstat", "--", "."]).catch(() => ""),
    ]);
  } catch {
    return undefined;
  }
  const counts = new Map<string, { added: number; removed: number }>();
  for (const line of numstat.split("\n")) {
    const [a, r, file] = line.split("\t");
    if (file && a !== "-") counts.set(file, { added: Number(a), removed: Number(r) });
  }
  const files = status
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const file = line.slice(3).split(" -> ").at(-1) ?? "";
      const c = counts.get(file);
      return { path: file, status: line.slice(0, 2).trim() || "M", ...(c ?? {}) };
    });
  if (!files.length) return undefined;
  return {
    type: "changes",
    cwd,
    files: files.slice(0, MAX_FILES),
    ...(files.length > MAX_FILES ? { more: files.length - MAX_FILES } : {}),
  };
}
