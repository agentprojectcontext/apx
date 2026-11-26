// The folders an agent may use, and the one rule every APX tool (files, shell, sending a file) asks about a path:
// readable, writable or refused, the same whether the path is written relative or absolute.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Thread as StoredThread } from "@apx/protocol";
import { worksForOwner } from "../domain/owner-work.ts";
import type { Store } from "../domain/store.ts";
import { expandHome, insideReal, isInside, real, realpath, samePath } from "../paths.ts";
import { namedPaths } from "./command-paths.ts";

/**
 * APX's own folder for a project, so one project's files never land among another's: the project's folder when APX
 * made it (a project with no folder elsewhere lives in `projects/<name>`), else `projects/<id>`.
 */
function projectSide(home: string, project: { id: string; path?: string | undefined }) {
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
 * A folder for work done for the owner: in the project's folder (folderInProject), else in another of the owner's
 * registered projects or one of their worktrees (`project`: that one), else anywhere but APX's home when `anywhere`
 * (DECISIONS.md#d-271). A project whose files are restricted to its team stays its own, and a folder never holds or
 * sits in a read-only folder of the project or of `o.readOnly` (the caller's). Throws why not.
 */
export function ownerFolder(
  store: Store,
  home: string,
  projectId: string | undefined,
  cwd: string | undefined,
  o: { anywhere?: boolean; readOnly?: readonly string[] } = {},
): { dir: string; project?: string } {
  const found = placeFor(store, home, projectId, cwd, o.anywhere === true);
  // A session's folder is writable to it first, so one holding or in a read-only folder would open it.
  const locked = [...readOnlyFolders(store, { project_id: projectId }), ...(o.readOnly ?? [])].find(
    (d) => insideReal(d, found.dir) || insideReal(found.dir, d),
  );
  if (locked) throw new Error(`${cwd} is in or holds a read-only folder (${locked}), which can be read, never changed`);
  return found;
}

function placeFor(
  store: Store,
  home: string,
  projectId: string | undefined,
  cwd: string | undefined,
  anywhere: boolean,
): { dir: string; project?: string } {
  let inside: Error;
  try {
    return { dir: folderInProject(store, projectId, cwd) };
  } catch (err) {
    inside = err as Error;
  }
  const own = projectId ? store.projects.get(projectId) : undefined;
  const from = own?.path && own.present ? own.path : undefined;
  const given = cwd === undefined ? undefined : expandHome(cwd);
  if (!given || (!from && !path.isAbsolute(given))) throw inside;
  let dir: string;
  try {
    dir = realpath(path.resolve(from ?? "/", given));
  } catch {
    throw inside;
  }
  if (!fs.statSync(dir).isDirectory()) throw new Error(`${cwd} is not a folder`);
  const apx = real(home);
  if (isInside(apx, dir) || isInside(dir, apx))
    throw new Error(`${cwd} is in APX's own folder, which no agent may use`);
  const holder = store.projects
    .list()
    .filter((p) => p.path && p.present)
    .flatMap((p) => [p.path as string, ...projectWorktrees(store, p.id)].map((d) => ({ p, d: real(d) })))
    .filter(({ d }) => isInside(d, dir))
    .sort((x, y) => y.d.length - x.d.length)[0]?.p;
  const closed = [
    ...store.projectProtection.list().map((p) => p.project),
    ...store.agentMigrationPending.list().flatMap((p) => [p.source, p.destination]),
  ];
  if (holder && holder.id !== projectId && closed.includes(holder.id))
    throw new Error(`${cwd} belongs to a project whose files are restricted to its team`);
  if (holder) return holder.id === projectId ? { dir } : { dir, project: holder.id };
  if (anywhere) return { dir };
  throw new Error(`${inside.message}, and it is in none of the owner's projects or their worktrees`);
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
 * Read as text (either slash; any case on Windows) and as the paths it names, resolved, so a link or a Windows short
 * name (RUNNER~1) for the same folder counts too.
 */
export function namesApxHome(command: string, home: string, projectId: string | undefined): boolean {
  const sources = artifactSources(home, projectId);
  const fold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const both = (p: string) => [...new Set([p, p.split(path.sep).join("/"), p.split("/").join(path.sep)].map(fold))];
  let rest = fold(command);
  for (const src of both(sources)) rest = rest.split(src).join("");
  if (both(home).some((h) => rest.includes(h)) || /\.apx(2\b|[\\/]v2\b)/i.test(rest)) return true;
  const [apx, own] = [real(home), real(sources)];
  return namedPaths(command).some((n) => {
    const to = n.kind === "path" || n.kind === "cd" ? n.to?.path : undefined;
    if (!to || !path.isAbsolute(to)) return false;
    const at = real(path.resolve(to));
    return isInside(apx, at) && !isInside(own, at);
  });
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
  /** A project restriction takes precedence over broader or explicitly lent folders. */
  protected?: boolean;
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
    principal?: { project?: string | undefined; owner: boolean };
    lent?: readonly string[] | undefined;
    lentWrite?: boolean | undefined;
    /** Folders outside its own the owner let this agent change for good (a folder card's "always"). */
    granted?: readonly string[] | undefined;
    /** Kept to its project's folders and its own temp folder: the system's temp folders are closed too. */
    confined?: boolean | undefined;
    /** A code thread's write policy: one the owner made read-only keeps to its folder. */
    write?: StoredThread["write"];
  };
type Thread = FolderThread;

/** The folders the owner added to a thread's project for its agents to read and never change. */
export function readOnlyFolders(store: Store, thread: { project_id?: string | undefined }): string[] {
  return (thread.project_id && store.projects.get(thread.project_id)?.read_only_folders) || [];
}

/**
 * The project's linked git worktrees, wherever they sit (`git worktree add ../x`): the same repository, so the same
 * project (DECISIONS.md#d-106).
 */
function projectWorktrees(store: Store, projectId: string | undefined): string[] {
  if (!projectId) return [];
  const p = store.projects.get(projectId);
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
 * A thread kept to the one folder it works in: a code thread the owner made read-only, a fenced agent's or a consult's.
 * Any other code thread or worktree session reaches the owner's projects as other chats do (DECISIONS.md#d-271).
 */
const keptToFolder = (thread: Thread) =>
  Boolean(thread.cwd) && (thread.write === "read-only" || thread.reach === "fenced" || thread.confined === true);

/** The thread's own project beside the folder it works in: its folder (for a code thread) and its worktrees. */
function ownProject(store: Store, thread: Thread): Root[] {
  if (keptToFolder(thread)) return [];
  const p = thread.project_id ? store.projects.get(thread.project_id) : undefined;
  const dirs = [...(thread.cwd && p?.path && p.present ? [p.path] : []), ...projectWorktrees(store, thread.project_id)];
  return dirs.map((dir) => ({ dir, write: true, scratch: false }));
}

/**
 * The owner's other projects and their worktrees, to change as freely as the agent's own folder in Auto: the owner
 * registered them, so moving between them is not acting outside (DECISIONS.md#d-108). Never one holding APX's home
 * or inside it; a thread kept to one folder stays in it.
 */
function ownerProjects(store: Store, home: string, thread: Thread): Root[] {
  if (keptToFolder(thread)) return [];
  const apx = real(home);
  const out: Root[] = [];
  for (const p of store.projects.list()) {
    if (!p.path || !p.present || p.id === thread.project_id) continue;
    const at = real(p.path);
    if (isInside(at, apx) || isInside(apx, at)) continue;
    out.push({ dir: p.path, write: true, scratch: false });
    for (const tree of projectWorktrees(store, p.id)) out.push({ dir: tree, write: true, scratch: false });
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

/** Whether a chat (and every chat above it) works for the owner; an unknown chat does not. */
function ownersChat(store: Store, id: string): boolean {
  const t = store.threads.get(id);
  return !!t && worksForOwner(store, t);
}

/**
 * The owner's other chats' temp folders, readable and never changed, for an agent working for the owner that reads
 * outside on its own: what the owner dropped in another chat (DECISIONS.md#d-271). A contact's, a room's, an outside
 * app's or a chat of a project closed to this agent (`closed`) stays closed.
 */
function ownerChatsTemp(store: Store, home: string, thread: Thread, closed: ReadonlySet<string>): Root[] {
  if (thread.confined || (thread.reach !== "read" && thread.reach !== "all") || !ownersChat(store, thread.id))
    return [];
  const root = scratchRoot(home);
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const project = store.threads.get(name)?.project_id;
    if ((project && closed.has(project)) || !ownersChat(store, name)) return [];
    return [{ dir: path.join(root, name), write: false, scratch: true }];
  });
}

/**
 * After a thread's own folders: other chats' temp folders stay closed (but the owner's, read by the owner's agents),
 * then the system's temp folders are scratch, unless the thread is confined, where they hold other chats' files too.
 */
function sharedRoots(store: Store, home: string, thread: Thread, closed: ReadonlySet<string>): Root[] {
  return [
    ...ownerChatsTemp(store, home, thread, closed),
    { dir: scratchRoot(home), write: false, scratch: true, off: true },
    ...(thread.confined ? [] : tempAreas(home).map((dir) => ({ dir, write: true, scratch: true }))),
  ];
}

/**
 * The folders of a thread's agent: where it works and its temp folder, both writable, then its project's read-only
 * folders, then the system's temp folders. The first that holds a path decides, so a read-only parent of the work
 * folder leaves the work folder writable, and a read-only folder in /tmp stays read-only.
 */
export function rootsOf(store: Store, home: string, thread: Thread): Root[] {
  const restricted = thread.principal?.owner
    ? []
    : store.projectProtection
        .list()
        .filter((p) => p.project !== (thread.principal ? thread.principal.project : thread.project_id));
  const pending = thread.principal?.owner
    ? []
    : store.agentMigrationPending.list().flatMap((p) => [{ project: p.source }, { project: p.destination }]);
  const denied = [...restricted, ...pending].flatMap((p) => {
    const project = store.projects.get(p.project);
    return project?.path ? [project.path, ...projectWorktrees(store, p.project)] : [];
  });
  return [
    { dir: workDir(store, home, thread), write: true, scratch: false },
    ...denied.map((dir) => ({ dir, write: false, scratch: false, off: true, protected: true })),
    { dir: scratchDir(store, home, thread), write: true, scratch: true },
    { dir: artifactSources(home, thread.project_id), write: true, scratch: false },
    ...ownProject(store, thread),
    ...readOnlyFolders(store, thread).map((dir) => ({ dir, write: false, scratch: false })),
    ...sharedRoots(store, home, thread, new Set([...restricted, ...pending].map((p) => p.project))),
    // After the read-only folders and other chats' temp folders, which keep their own rule inside these.
    ...(thread.reach === "read"
      ? ownerProjects(store, home, thread).filter((r) => !denied.some((d) => insideReal(d, r.dir)))
      : []),
    ...(thread.granted ?? []).map((dir) => ({ dir, write: true, scratch: false })),
    // Last, so other chats' temp folders stay closed even inside a folder lent for one call.
    ...(thread.lent ?? []).map((dir) => ({ dir, write: thread.lentWrite === true, scratch: false, lent: true })),
    // Last of all: the project's read-only folders and other chats' temp folders keep their own rule.
    ...(thread.reach === "all" || thread.reach === "read"
      ? [{ dir: path.parse(home).root, write: thread.reach === "all", scratch: false, anywhere: { home } }]
      : []),
  ];
}

/**
 * The same folders for an outside agent, which works in harnessDir instead of the project's folder. The project's
 * folder stays as writable to it as to our own agents (DECISIONS.md#d-271): only its working folder moves, so the
 * repo's settings are not loaded unchecked. Never a folder holding APX's home.
 */
export function harnessRoots(store: Store, home: string, thread: Thread): Root[] {
  const [work, ...rest] = rootsOf(store, home, thread);
  const own = harnessDir(store, home, thread);
  const apx = real(home);
  const at = work && real(work.dir);
  const project = at && !samePath(at, real(own)) && !isInside(at, apx) && !isInside(apx, at) ? [work] : [];
  return [{ dir: own, write: true, scratch: false }, ...project, ...rest];
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
function physical(from: string, file: string): string {
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
  if (roots.some((r) => r.protected && insideReal(r.dir, lands)))
    return { refused: `${name} belongs to a project whose files are restricted to its team` };
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
