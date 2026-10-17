// The folders an agent may use, and the one rule every APX tool (files, shell, sending a file) asks about a path:
// readable, writable or refused, the same whether the path is written relative or absolute.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Store } from "../domain/store.ts";
import { expandHome, insideReal, isInside, real } from "../paths.ts";

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
 * Why a `cwd` an agent gave is not a folder to run in (a worktree removed since), or undefined: said plainly, never as
 * a refusal, so the agent does not read it as a permission it lacks.
 */
export function missingCwd(
  store: Store,
  home: string,
  thread: Parameters<typeof workDir>[2],
  cwd: string | undefined,
): string | undefined {
  if (cwd === undefined) return undefined;
  const base = workDir(store, home, thread);
  const at = path.resolve(base, expandHome(cwd));
  // The folder it works in is made on first use.
  if (at === base) return undefined;
  const stat = fs.statSync(at, { throwIfNoEntry: false });
  if (!stat) return `${cwd} does not exist`;
  return stat.isDirectory() ? undefined : `${cwd} is not a folder`;
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

/** A folder an agent may use (`off`: one it may not, inside one it may). The first is where relative paths start. */
export type Root = { dir: string; write: boolean; scratch: boolean; off?: boolean };

type Thread = Parameters<typeof workDir>[2] & Parameters<typeof scratchDir>[2];

/** The folders the owner added to a thread's project for its agents to read and never change. */
export function readOnlyFolders(store: Store, thread: { project_id?: string | undefined }): string[] {
  return (thread.project_id && store.projects.get(thread.project_id)?.read_only_folders) || [];
}

/** The system's temp folders, shared scratch space for commands (`/tmp/out.txt`), unless one holds APX's home. */
export function tempAreas(home: string): string[] {
  const out: string[] = [];
  for (const dir of ["/tmp", "/private/tmp", os.tmpdir()]) {
    if (!fs.existsSync(dir) || isInside(real(dir), real(home))) continue;
    if (!out.some((o) => real(o) === real(dir))) out.push(dir);
  }
  return out;
}

/** After a thread's own folders: other chats' temp folders stay closed, then the system's temp folders are scratch. */
function sharedRoots(home: string): Root[] {
  return [
    { dir: scratchRoot(home), write: false, scratch: true, off: true },
    ...tempAreas(home).map((dir) => ({ dir, write: true, scratch: true })),
  ];
}

/**
 * The folders of a thread's agent: where it works and its temp folder, both writable, then its project's read-only
 * folders, then the system's temp folders. The first that holds a path decides, so a read-only parent of the work
 * folder leaves the work folder writable, and a read-only folder in /tmp stays read-only.
 */
export function rootsOf(store: Store, home: string, thread: Thread): Root[] {
  return [
    { dir: workDir(store, home, thread), write: true, scratch: false },
    { dir: scratchDir(store, home, thread), write: true, scratch: true },
    ...readOnlyFolders(store, thread).map((dir) => ({ dir, write: false, scratch: false })),
    ...sharedRoots(home),
  ];
}

/** The same folders for an outside agent, which works in harnessDir instead of the project's folder. */
export function harnessRoots(store: Store, home: string, thread: Thread): Root[] {
  return [
    { dir: harnessDir(store, home, thread), write: true, scratch: false },
    ...rootsOf(store, home, thread).slice(1),
  ];
}

/**
 * A project's read-only folders as the owner gave them, checked: absolute (or `~/…`), on disk, a folder, not APX's home
 * nor in it nor holding it (its database and secrets), not in the project's own folder (already readable and writable
 * there, so listing it would only mislead). Duplicates are dropped. Throws the first problem.
 */
export function checkReadOnly(home: string, project: { path?: string | undefined }, folders: string[]): string[] {
  const apx = real(home);
  const own = project.path ? real(project.path) : undefined;
  const out: string[] = [];
  for (const given of folders) {
    const p = expandHome(given.trim());
    if (!path.isAbsolute(p)) throw new Error(`${given} is not an absolute path`);
    const dir = path.resolve(p);
    if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${given} is not a folder here`);
    const at = real(dir);
    if (isInside(at, apx) || isInside(apx, at)) throw new Error(`${given} holds or is inside APX's own folder`);
    // Read-only there would lock every chat's temp folder.
    if ([scratchRoot(home), "/tmp", "/private/tmp", os.tmpdir()].some((t) => isInside(at, real(t))))
      throw new Error(`${given} holds the system's temp folders`);
    if (own && isInside(own, at)) throw new Error(`${given} is already in the project's folder`);
    if (!out.some((o) => real(o) === at)) out.push(dir);
  }
  return out;
}

/** Where a path lands (`base`: the folder it is in) and whether it may be changed, or why it is refused. */
export type Access = { at: string; base: string; scratch: boolean; write: boolean } | { refused: string };

/** Every refusal says what to do next, the same from every tool: it lands in context each time, so it stays short. */
export const refusal = {
  outside: (p: string) =>
    `${p} is outside the folders you can read. If the task needs it, ask the owner with ask_owner to add it as a read-only folder of the project.`,
  unwritable: (p: string) =>
    `${p} is outside the folders you can change: write in the folder you work in or your temp folder.`,
  readOnly: (p: string) => `${p} is in a read-only folder: it can be read, never changed.`,
  /** Outside a project there is no read-only folder to add. */
  alone: (p: string) => `${p} is outside the folders you can read: the folder you work in and your temp folder.`,
  apx: (p: string) => `${p} is in APX's own folder, which no agent may use.`,
  unknown: (what: string) =>
    `cannot tell where ${what} writes, and this project has read-only folders: name the path plainly.`,
};

/**
 * Where a path really lands, as the system resolves it: each link followed before the `..` after it is applied
 * (`l/../x`, with `l` a link, lands beside the link's target, not beside `l`).
 */
export function physical(from: string, file: string): string {
  let cur = real(path.isAbsolute(file) ? path.parse(file).root : from);
  let exists = true;
  for (const part of file.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") {
      cur = path.dirname(cur);
      continue;
    }
    cur = path.join(cur, part);
    if (!exists) continue;
    try {
      if (fs.lstatSync(cur).isSymbolicLink()) cur = real(cur);
    } catch {
      exists = false;
    }
  }
  return cur;
}

export type JudgeOptions = {
  write?: boolean;
  /** The path as the agent wrote it, for the refusal. */
  name?: string;
  /** APX's home, refused in its own words. */
  home?: string;
  /** Whether the thread is in a project, where the owner can add a read-only folder. */
  project?: boolean;
};

/** The rule itself: `file` (relative to `from`, `~` for the user's home) once links are resolved, in a root or not. */
export function judge(roots: Root[], file: string, from: string, o: JudgeOptions = {}): Access {
  const name = o.name ?? file;
  const at = path.resolve(from, expandHome(file));
  const lands = physical(from, expandHome(file));
  const root = roots.find((r) => insideReal(r.dir, lands));
  if (!root || root.off) {
    if (o.home && insideReal(o.home, lands)) return { refused: refusal.apx(name) };
    if (o.write) return { refused: refusal.unwritable(name) };
    return { refused: o.project === false ? refusal.alone(name) : refusal.outside(name) };
  }
  if (o.write && !root.write) return { refused: refusal.readOnly(name) };
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
  const where = { home, project: Boolean(thread.project_id) };
  let from = roots[0]?.dir ?? home;
  if (o.cwd !== undefined) {
    const dir = judge(roots, o.cwd, from, where);
    if ("refused" in dir) return dir;
    from = dir.at;
  }
  const name = o.cwd === undefined || path.isAbsolute(file) ? file : path.join(o.cwd, file);
  return judge(roots, file, from, { ...where, write: o.write ?? false, name });
}
