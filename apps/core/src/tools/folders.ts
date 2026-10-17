// The folders an agent may use, and the one rule every APX tool (files, shell, sending a file) asks about a path:
// readable, writable or refused, the same whether the path is written relative or absolute.
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { Store } from "../domain/store.ts";
import { expandHome, insideReal } from "../paths.ts";

/**
 * APX's own folder for a project, so one project's files never land among another's: the project's folder when APX
 * made it (a project with no folder elsewhere lives in `projects/<name>`), else `projects/<id>`.
 */
export function projectSide(home: string, project: { id: string; path?: string | undefined }) {
  const projects = path.join(home, "projects");
  const own = project.path && path.relative(projects, project.path);
  return own && !own.startsWith("..") && !path.isAbsolute(own)
    ? (project.path as string)
    : path.join(projects, project.id);
}

/**
 * Where an agent works in a thread: a code thread's own folder, else its project's folder when it is on disk, else
 * APX's side of the project, else (a chat outside a project) APX's work folder. Commands run and files are written
 * only inside it, or in the chat's temp folder (scratchDir).
 */
export function workDir(
  store: Store,
  home: string,
  thread: { cwd?: string | undefined; project_id?: string | undefined },
) {
  if (thread.cwd) return thread.cwd;
  const p = thread.project_id ? store.projects.get(thread.project_id) : undefined;
  if (!p) return path.join(home, "work");
  return p.path && p.present ? p.path : projectSide(home, p);
}

/**
 * Where an outside agent (Claude, Codex, an ACP agent) works: a code thread's folder, else APX's side of the project,
 * never the project's own folder (its settings there would apply unchecked), else APX's work folder.
 */
export function harnessDir(
  store: Store,
  home: string,
  thread: { cwd?: string | undefined; project_id?: string | undefined },
) {
  if (thread.cwd) return thread.cwd;
  const p = thread.project_id ? store.projects.get(thread.project_id) : undefined;
  return p ? projectSide(home, p) : path.join(home, "work");
}

/**
 * Where a chat keeps temporary files: a folder of its own (shared with the sub-chats it delegated to) in the system's
 * temp folder, outside the folder it works in and outside APX's home, so neither fills with downloads and test scripts.
 */
export function scratchDir(store: Store, home: string, thread: { id: string; parent_id?: string | undefined }) {
  let root = thread;
  for (let i = 0; root.parent_id && i < 10; i++) root = store.threads.get(root.parent_id) ?? { id: root.id };
  return path.join(scratchRoot(home), root.id.replace(/[^\w-]/g, "_"));
}

/** Every chat's temp folder sits here; one per APX home, so a test core never shares the owner's. */
export const scratchRoot = (home: string) =>
  path.join(os.tmpdir(), `apx-scratch-${createHash("sha256").update(home).digest("hex").slice(0, 8)}`);

/** A folder an agent may use. The first is where relative paths start. */
export type Root = { dir: string; write: boolean; scratch: boolean };

type Thread = Parameters<typeof workDir>[2] & Parameters<typeof scratchDir>[2];

/** The folders of a thread's agent: where it works and its temp folder, both writable. */
export function rootsOf(store: Store, home: string, thread: Thread): Root[] {
  return [
    { dir: workDir(store, home, thread), write: true, scratch: false },
    { dir: scratchDir(store, home, thread), write: true, scratch: true },
  ];
}

/** Where a path lands (`base`: the folder it is in) and whether it may be changed, or why it is refused. */
export type Access = { at: string; base: string; scratch: boolean; write: boolean } | { refused: string };

/**
 * The rule itself: `file` (relative to `from`, `~` for the user's home) once links are resolved, in a root or not.
 * `name` is the path as the agent wrote it, for the refusal.
 */
export function judge(roots: Root[], file: string, from: string, write = false, name = file): Access {
  const at = path.resolve(from, expandHome(file));
  const root = roots.find((r) => insideReal(r.dir, at));
  if (!root) return { refused: `${name} is outside the folder you work in and your temp folder` };
  if (write && !root.write) return { refused: `${name} is in a folder you can read, not change` };
  return { at, base: root.dir, scratch: root.scratch, write: root.write };
}

/**
 * What an agent may do with a path it names, from any tool. A relative path starts at `cwd` when given (itself
 * judged the same way), as a shell command runs there, else at the folder the agent works in.
 */
export function folderAccess(
  store: Store,
  home: string,
  thread: Thread,
  file: string,
  o: { cwd?: string | undefined; write?: boolean } = {},
): Access {
  const roots = rootsOf(store, home, thread);
  let from = roots[0]?.dir ?? home;
  if (o.cwd !== undefined) {
    const dir = judge(roots, o.cwd, from);
    if ("refused" in dir) return dir;
    from = dir.at;
  }
  const name = o.cwd === undefined || path.isAbsolute(file) ? file : path.join(o.cwd, file);
  return judge(roots, file, from, o.write, name);
}
