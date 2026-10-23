// The folders an agent may use, and the one rule every APX tool (files, shell, sending a file) asks about a path:
// readable, writable or refused, the same whether the path is written relative or absolute.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Store } from "../domain/store.ts";
import { expandHome, insideReal, isInside, real, realpath } from "../paths.ts";

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
 * A folder inside a project's folder on disk (`cwd` relative to it, or absolute), links resolved, so an agent cannot be
 * pointed outside the project. Throws why not.
 */
export function folderInProject(store: Store, projectId: string | undefined, cwd: string | undefined): string {
  const project = projectId ? store.projects.get(projectId) : undefined;
  if (!project?.path || !project.present) throw new Error("needs a project whose folder is on disk");
  let root: string;
  let dir: string;
  try {
    root = realpath(project.path);
    dir = realpath(path.resolve(root, expandHome(cwd ?? ".")));
  } catch {
    throw new Error(`no folder ${cwd ?? project.path}`);
  }
  if (!isInside(root, dir)) throw new Error(`${cwd} is outside the project's folder`);
  if (!fs.statSync(dir).isDirectory()) throw new Error(`${cwd} is not a folder`);
  return dir;
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

/**
 * Where a built artifact's source lives (one folder per artifact under it): APX's side, never the owner's repo, and
 * apart from the artifact's memory (`artifacts/`), which only the core writes. See DECISIONS.md#d-118.
 */
export const artifactSources = (home: string, projectId: string | undefined) =>
  path.join(home, "artifact-sources", projectId ?? "global");

/**
 * Whether a command names APX's own folder, leaving out this project's artifact sources, which its agents may build in.
 */
export function namesApxHome(command: string, home: string, projectId: string | undefined): boolean {
  // A command may write a path with either slash (Git Bash on Windows): both spellings count.
  const both = (p: string) => [...new Set([p, p.split(path.sep).join("/"), p.split("/").join(path.sep)])];
  let rest = command;
  for (const src of both(artifactSources(home, projectId))) rest = rest.split(src).join("");
  return both(home).some((h) => rest.includes(h)) || /\.apx(2\b|\/v2\b)/.test(rest);
}

/** Every chat's temp folder sits here; one per APX home, so a test core never shares the owner's. */
export const scratchRoot = (home: string) =>
  path.join(os.tmpdir(), `apx-scratch-${createHash("sha256").update(home).digest("hex").slice(0, 8)}`);

/**
 * A folder an agent may use (`off`: one it may not, inside one it may; `lent`: the owner let it use it for one call;
 * `anywhere`: every path the roots before it leave but APX's home, readable, and writable for an agent that acts
 * outside on its own). The first is where relative paths start.
 */
export type Root = {
  dir: string;
  write: boolean;
  scratch: boolean;
  off?: boolean;
  lent?: boolean;
  anywhere?: { home: string };
};

/**
 * How far an agent's files reach outside the folders it works in (DECISIONS.md#d-106): `all` reads and changes any
 * folder but APX's home, `read` reads any and asks before changing outside, `card` asks before reading outside,
 * `fenced` keeps to its folders.
 */
export type Reach = "all" | "read" | "card" | "fenced";

/**
 * A thread as the folder rule sees it for one agent. Only engine/permissions.ts makes one: a thread read from the store
 * has no `reach`, so it cannot be judged here by mistake with less than the agent may do (DECISIONS.md#d-115).
 * `lent`: folders outside its own the owner let this one call read, or change with `lentWrite`.
 */
export type FolderThread = Parameters<typeof workDir>[2] &
  Parameters<typeof scratchDir>[2] & {
    reach: Reach;
    lent?: readonly string[] | undefined;
    lentWrite?: boolean | undefined;
    /** Folders outside its own the owner let this agent change for good (a folder card's "always"). */
    granted?: readonly string[] | undefined;
  };
type Thread = FolderThread;

/** The folders the owner added to a thread's project for its agents to read and never change. */
export function readOnlyFolders(store: Store, thread: { project_id?: string | undefined }): string[] {
  return (thread.project_id && store.projects.get(thread.project_id)?.read_only_folders) || [];
}

/**
 * The project's linked git worktrees, wherever they sit (`git worktree add ../x`): the same repository, so the same
 * project (DECISIONS.md#d-106). Only for a thread working in the project's own folder: one kept to a worktree stays in it.
 */
export function projectWorktrees(store: Store, thread: Parameters<typeof workDir>[2]): string[] {
  if (thread.cwd || !thread.project_id) return [];
  const p = store.projects.get(thread.project_id);
  if (!p?.path || !p.present) return [];
  const dir = path.join(p.path, ".git", "worktrees");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    let gitdir: string;
    try {
      gitdir = fs.readFileSync(path.join(dir, name, "gitdir"), "utf8").trim();
    } catch {
      continue;
    }
    const tree = path.dirname(path.resolve(dir, name, gitdir));
    // A worktree removed by hand leaves its entry behind until `git worktree prune`.
    if (fs.existsSync(path.join(tree, ".git")) && !isInside(p.path, tree)) out.push(tree);
  }
  return out;
}

/**
 * The owner's other projects and their worktrees, to change as freely as the agent's own folder in Auto: the owner
 * registered them, so moving between them is not acting outside (DECISIONS.md#d-108). Never one holding APX's home
 * or inside it; a thread kept to one folder stays in it.
 */
export function ownerProjects(store: Store, home: string, thread: Thread): Root[] {
  if (thread.cwd) return [];
  const apx = real(home);
  const out: Root[] = [];
  for (const p of store.projects.list()) {
    if (!p.path || !p.present || p.id === thread.project_id) continue;
    const at = real(p.path);
    if (isInside(at, apx) || isInside(apx, at)) continue;
    out.push({ dir: p.path, write: true, scratch: false });
    for (const tree of projectWorktrees(store, { project_id: p.id }))
      out.push({ dir: tree, write: true, scratch: false });
  }
  return out;
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
    { dir: artifactSources(home, thread.project_id), write: true, scratch: false },
    ...projectWorktrees(store, thread).map((dir) => ({ dir, write: true, scratch: false })),
    ...readOnlyFolders(store, thread).map((dir) => ({ dir, write: false, scratch: false })),
    ...sharedRoots(home),
    // After the read-only folders and other chats' temp folders, which keep their own rule inside these.
    ...(thread.reach === "read" ? ownerProjects(store, home, thread) : []),
    ...(thread.granted ?? []).map((dir) => ({ dir, write: true, scratch: false })),
    // Last, so other chats' temp folders stay closed even inside a folder lent for one call.
    ...(thread.lent ?? []).map((dir) => ({ dir, write: thread.lentWrite === true, scratch: false, lent: true })),
    // Last of all: the project's read-only folders and other chats' temp folders keep their own rule.
    ...(thread.reach === "all" || thread.reach === "read"
      ? [{ dir: path.parse(home).root, write: thread.reach === "all", scratch: false, anywhere: { home } }]
      : []),
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
    // Listed as read-only, a folder holding the project reads to its agents as if their own folder could not change.
    if (own && isInside(at, own)) throw new Error(`${given} holds the project's folder`);
    if (!out.some((o) => real(o) === at)) out.push(dir);
  }
  return out;
}

/**
 * Where a path lands (`base`: the folder it is in) and whether it may be changed, or why it is refused (`offer`: a read
 * outside, in a project: the folder holding it, which the owner may let the agent read).
 */
export type Access =
  | { at: string; base: string; scratch: boolean; write: boolean }
  | { refused: string; offer?: string };

/** Every refusal says what to do next, the same from every tool: it lands in context each time, so it stays short. */
export const refusal = {
  outside: (p: string) =>
    `${p} is outside the folders you can read: the folder you work in, your temp folder and the project's read-only folders. Work with what is there, or tell the owner which folder you need and why.`,
  unwritable: (p: string) =>
    `${p} is outside the folders you can change: write in the folder you work in or your temp folder, and tell the owner where it went.`,
  readOnly: (p: string) =>
    `${p} is in a read-only folder: it can be read, never changed. Write in the folder you work in or your temp folder instead.`,
  /** Outside a project there is no read-only folder to add. */
  alone: (p: string) =>
    `${p} is outside the folders you can read: the folder you work in and your temp folder. Work with what is there, or tell the owner which folder you need and why.`,
  apx: (p: string) =>
    `${p} is in APX's own folder, which no agent may use. Ask APX through its tools (list_agents, recall, search_chats) instead.`,
  unknown: (what: string) =>
    `cannot tell where ${what} writes, and this project has read-only folders: name the path plainly.`,
};

/**
 * Where a path really lands, as the system resolves it: each link followed before the `..` after it is applied
 * (`l/../x`, with `l` a link, lands beside the link's target, not beside `l`).
 */
export function physical(from: string, file: string): string {
  const root = path.isAbsolute(file) ? path.parse(file).root : "";
  let cur = real(root || from);
  let exists = true;
  // After the root: a drive's "C:" is part of the root, never a folder name.
  for (const part of file.slice(root.length).split(/[\\/]+/)) {
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
  const root = roots.find((r) => r.anywhere || insideReal(r.dir, lands));
  if (!root || root.off || root.lent || root.anywhere) {
    // A folder lent for one call, or every folder, never opens APX's home inside it.
    const apx = o.home ?? root?.anywhere?.home;
    if (apx && insideReal(apx, lands)) return { refused: refusal.apx(name) };
  }
  if (!root || root.off) {
    // Outside every folder it may use the owner may let it there: the card offers the folder holding the path.
    const offer = o.home && !root ? { offer: holding(lands) } : {};
    if (o.write) return { refused: refusal.unwritable(name), ...offer };
    return { refused: o.project === false ? refusal.alone(name) : refusal.outside(name), ...offer };
  }
  if (o.write && !root.write)
    // Anywhere but its folders is readable only: the owner is offered the folder holding the path for this call.
    return root.anywhere
      ? { refused: refusal.unwritable(name), offer: holding(lands) }
      : { refused: refusal.readOnly(name) };
  return { at, base: root.anywhere ? path.parse(lands).root : root.dir, scratch: root.scratch, write: root.write };
}

/** The nearest folder on disk holding a path: itself when it is one, else the folder of the file it names. */
function holding(p: string): string {
  let dir = p;
  while (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() && path.dirname(dir) !== dir)
    dir = path.dirname(dir);
  return dir;
}

/**
 * The folders outside the agent's own a call would read, found one at a time by lending each the folder rule offers
 * (`judgeWith` judges the call with those lent): [] when it needs none, or when it is refused for another reason.
 */
export function outsideFolders(judgeWith: (lent: string[]) => Access): string[] {
  const lent: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = judgeWith(lent);
    if (!("refused" in r)) return lent;
    if (!r.offer || lent.includes(r.offer)) return [];
    lent.push(r.offer);
  }
  return [];
}

/**
 * A tool's `outside` for paths the call reads (send_file, open_document, a drawing's references): the folders holding
 * them that the owner would have to lend it, so a mode that asks gets a card instead of a refusal.
 */
export function readsOutside(store: Store, home: string, thread: FolderThread, files: readonly string[]): string[] {
  const out = new Set<string>();
  for (const file of files)
    for (const dir of outsideFolders((lent) => folderAccess(store, home, { ...thread, lent: [...out, ...lent] }, file)))
      out.add(dir);
  return [...out];
}

/**
 * Adds folders to a project's read-only ones, checked as projects.update checks them (checkReadOnly); `dry` only
 * checks. Throws the first problem.
 */
export function addReadOnly(store: Store, home: string, projectId: string, folders: string[], dry = false): void {
  const project = store.projects.get(projectId);
  if (!project) throw new Error(`no project ${projectId}`);
  const all = checkReadOnly(home, project, [...(project.read_only_folders ?? []), ...folders]);
  if (!dry) store.projects.setReadOnlyFolders(projectId, all);
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
