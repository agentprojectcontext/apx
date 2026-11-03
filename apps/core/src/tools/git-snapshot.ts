// Read an immutable tracked blob without giving a read-only agent a shell or following Git symlinks.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { isInside, real } from "../paths.ts";

const LIMIT = 1_000_000;
const runFile = promisify(execFile);
// Git environment overrides can point at a different repository or replace immutable objects.
const safeEnv = () => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_TERMINAL_PROMPT: "0",
});
const runGit = (cwd: string, args: string[]) =>
  runFile(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      `core.hooksPath=${os.devNull}`,
      "--no-optional-locks",
      "--no-lazy-fetch",
      "-C",
      cwd,
      ...args,
    ],
    {
      timeout: 5000,
      encoding: "buffer",
      maxBuffer: LIMIT + 4096,
      env: safeEnv(),
      windowsHide: true,
    },
  );

/** The caller already checked file access; only read that path, never a path or revision supplied to a shell. */
export async function readGitSnapshot(
  file: string,
  base: string,
  revision: string,
): Promise<{ text: string; blob: string } | { error: string }> {
  let cwd = path.dirname(file);
  // A tracked path may not exist in the current checkout; use its nearest accessible directory.
  while (isInside(base, cwd) && !fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
    const parent = path.dirname(cwd);
    if (parent === cwd) break;
    cwd = parent;
  }
  if (!isInside(base, cwd)) return { error: "refused: path is outside the accessible folder" };
  try {
    const run = async (...args: string[]) => (await runGit(cwd, args)).stdout.toString("utf8").replace(/\r?\n$/, "");
    const root = await run("rev-parse", "--show-toplevel");
    // An alternate object database can point at an unrelated project; do not read through it under this grant.
    const alternates = path.resolve(cwd, await run("rev-parse", "--git-path", "objects/info/alternates"));
    const alt = fs.lstatSync(alternates, { throwIfNoEntry: false });
    if (alt && (!alt.isFile() || alt.size > 0))
      return { error: "refused: Git alternate object stores require separate access" };
    const target = path.join(real(path.dirname(file)), path.basename(file));
    const relative = path.relative(real(root), target).split(path.sep).join("/");
    if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative))
      return { error: "refused: file is outside the Git worktree" };
    if ((await run("cat-file", "-t", revision)) !== "commit") return { error: "refused: revision is not a commit" };
    const commit = (await runGit(cwd, ["cat-file", "commit", revision])).stdout;
    const commitHash = createHash(revision.length === 40 ? "sha1" : "sha256")
      .update(`commit ${commit.length}\0`)
      .update(commit)
      .digest("hex");
    if (commitHash !== revision.toLowerCase()) return { error: "refused: Git commit identity mismatch" };
    const blob = await run("rev-parse", "--verify", `${revision}:${relative}`);
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(blob) || (await run("cat-file", "-t", blob)) !== "blob")
      return { error: "refused: snapshot path is not a file" };
    const size = Number(await run("cat-file", "-s", blob));
    if (!Number.isSafeInteger(size) || size < 0 || size > LIMIT)
      return { error: `refused: snapshot exceeds ${LIMIT} bytes` };
    // Do not trim content: the object identifier proves the bytes, including final newlines.
    const { stdout } = await runGit(cwd, ["cat-file", "blob", blob]);
    const digest = createHash(blob.length === 40 ? "sha1" : "sha256")
      .update(`blob ${stdout.length}\0`)
      .update(stdout)
      .digest("hex");
    if (stdout.length !== size || digest !== blob.toLowerCase())
      return { error: "refused: Git object identity mismatch" };
    if (stdout.subarray(0, 8000).includes(0)) return { error: "refused: snapshot is not a text file" };
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(stdout), blob };
  } catch {
    return { error: "snapshot unavailable: repository, commit or file was not found or could not be read" };
  }
}
