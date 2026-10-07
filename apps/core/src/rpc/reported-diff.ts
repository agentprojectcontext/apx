import fs from "node:fs";
import path from "node:path";
import { FILE_READ_LIMIT, type Params, type Result } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { badRequest, notFound } from "../errors.ts";
import { insideReal, real } from "../paths.ts";
import { workDir } from "../tools/shell.ts";

/** Historical snapshots need no live folder; legacy records may read only their chat's current work folder. */
export function reportedDiff(store: Store, home: string, p: Params<"files.diff">): Result<"files.diff"> {
  const message = p.message ? store.messages.get(p.message) : undefined;
  if (!message || message.thread_id !== p.thread || message.author.kind !== "agent")
    throw notFound("recorded changes in this chat");
  const part =
    p.part === undefined
      ? message.parts.find((part) => part.type === "changes" && part.files.some((f) => f.path === p.path))
      : message.parts[p.part];
  const file = part?.type === "changes" ? part.files.find((f) => f.path === p.path) : undefined;
  if (!file || part?.type !== "changes") throw notFound(`recorded change ${p.path}`);
  if (file.diff !== undefined)
    return { path: p.path, diff: file.diff, truncated: file.truncated ?? false, source: "recorded" };
  const thread = store.threads.get(p.thread);
  if (!thread) throw notFound(`thread ${p.thread}`);
  const base = workDir(store, home, thread);
  const abs = real(path.resolve(base, p.path));
  const hidden = (s: string) => s.split(/[\\/]/).some((segment) => segment.toLowerCase() === ".git");
  if (
    real(part.cwd) !== real(base) ||
    path.isAbsolute(p.path) ||
    !insideReal(base, p.path) ||
    hidden(p.path) ||
    hidden(path.relative(real(base), abs))
  )
    throw badRequest("recorded file is outside this chat's current work folder");
  let fd: number;
  try {
    fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch {
    throw notFound(`file ${p.path}`);
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw badRequest("not a regular file");
    const buffer = Buffer.alloc(Math.min(stat.size, FILE_READ_LIMIT));
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytes);
    if (text.includes(0)) throw badRequest("not a text file");
    return { path: p.path, diff: text.toString("utf8"), truncated: stat.size > bytes, source: "current" };
  } finally {
    fs.closeSync(fd);
  }
}
