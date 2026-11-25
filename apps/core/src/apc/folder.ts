// The folder a project keeps APX's files in (`.agent/`), and the move from `.apc/`, the name earlier versions used: run
// by itself at start and on register; a project it could not move keeps working from `.apc/`. See DECISIONS.md#d-273
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Agents, project.json, memory, skills, MCP servers, recipes: the project's own APX files, next to AGENTS.md. */
export const AGENT_DIR = ".agent";
/** Where earlier APX versions (and v1) kept the same files. Goes with the move once no install has one. */
export const LEGACY_DIR = ".apc";
/** Folders inside either where agents keep git worktrees: a checkout of the code, never moved or guarded. */
export const CHECKOUTS: ReadonlySet<string> = new Set(["worktree", "worktrees"]);

const isLink = (p: string): boolean => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

const isDir = (p: string): boolean => {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** What `.apc/` still holds besides worktrees: what the move takes. Empty with no `.apc/` or a link there. */
function legacyEntries(root: string): string[] {
  const dir = path.join(root, LEGACY_DIR);
  if (!isDir(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((e) => !CHECKOUTS.has(e))
      .sort();
  } catch {
    return [];
  }
}

/** The project's files are only in `.apc/` (a move has not run or failed): it works from there until one succeeds. */
export const needsFolderMove = (root: string): boolean =>
  !isDir(path.join(root, AGENT_DIR)) && !isLink(path.join(root, AGENT_DIR)) && legacyEntries(root).length > 0;

/** Something in `.apc/` is still there to move or clear. */
export const hasLegacyFolder = (root: string): boolean => legacyEntries(root).length > 0;

export type FolderMove = {
  /** Files of `.apc/` that are now in `.agent/` (ones already there and equal count too). */
  files: number;
  /** `.apc/` is gone, or holds only worktrees (`kept`). */
  done: boolean;
  /** Worktree folders left in `.apc/`: a git checkout moves with `git worktree move`, never by copying. */
  kept: string[];
  /** Files `.agent/` already has with other content: nothing of `.apc/` was removed. */
  conflicts: string[];
};

/** Every file and link under `dir/rel`, as paths relative to `dir`. */
function walk(dir: string, rel: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...walk(dir, r));
    else if (e.isFile() || e.isSymbolicLink()) out.push(r);
  }
  return out;
}

/** Whether two entries are the same: equal bytes, or links to the same place. */
function same(a: string, b: string): boolean {
  try {
    const la = fs.lstatSync(a);
    const lb = fs.lstatSync(b);
    if (la.isSymbolicLink() || lb.isSymbolicLink())
      return la.isSymbolicLink() && lb.isSymbolicLink() && fs.readlinkSync(a) === fs.readlinkSync(b);
    return la.isFile() && lb.isFile() && la.size === lb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

/** A link is copied as the link it is, never followed: a repo must not pull another file of the machine in. */
function copyEntry(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (isLink(from)) fs.symlinkSync(fs.readlinkSync(from), to);
  else fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
}

/**
 * Moves a project's files from `.apc/` to `.agent/`: copies, checks that every file arrived equal, and only then
 * removes them from `.apc/`. With no `.agent/` yet the copy is made aside and renamed in at once, so a reindex never
 * sees half of it. Safe to run again: equal files count as
 * moved, and a file `.agent/` has with other content stops before anything is removed. Worktrees stay where they are.
 */
export function moveLegacyFolder(root: string): FolderMove {
  const abs = path.resolve(root);
  const from = path.join(abs, LEGACY_DIR);
  const to = path.join(abs, AGENT_DIR);
  for (const [p, name] of [
    [from, LEGACY_DIR],
    [to, AGENT_DIR],
  ] as const)
    if (isLink(p)) throw new Error(`${name} is a link: nothing moved`);
  if (fs.existsSync(to) && !isDir(to)) throw new Error(`a file named ${AGENT_DIR} is in the way: nothing moved`);
  const entries = legacyEntries(abs);
  const checkouts = () => (isDir(from) ? fs.readdirSync(from).filter((e) => CHECKOUTS.has(e)) : []);
  if (!entries.length) {
    clearEmpty(from);
    return { files: 0, done: true, kept: checkouts(), conflicts: [] };
  }
  const files = entries.flatMap((e) => (isDir(path.join(from, e)) ? walk(from, e) : [e]));
  if (!fs.existsSync(to)) {
    const aside = path.join(abs, `${AGENT_DIR}.moving-${randomBytes(4).toString("hex")}`);
    try {
      for (const f of files) copyEntry(path.join(from, f), path.join(aside, f));
      const differ = files.filter((f) => !same(path.join(from, f), path.join(aside, f)));
      if (differ.length) throw new Error(`the copy did not match: ${differ.join(", ")}`);
      fs.renameSync(aside, to);
    } catch (err) {
      fs.rmSync(aside, { recursive: true, force: true });
      throw err;
    }
  } else {
    const conflicts = files.filter(
      (f) => fs.existsSync(path.join(to, f)) && !same(path.join(from, f), path.join(to, f)),
    );
    if (conflicts.length) return { files: 0, done: false, kept: checkouts(), conflicts };
    for (const f of files) if (!fs.existsSync(path.join(to, f))) copyEntry(path.join(from, f), path.join(to, f));
  }
  const differ = files.filter((f) => !same(path.join(from, f), path.join(to, f)));
  if (differ.length)
    throw new Error(`nothing removed from ${LEGACY_DIR}: these did not arrive equal: ${differ.join(", ")}`);
  for (const e of entries) fs.rmSync(path.join(from, e), { recursive: true, force: true });
  clearEmpty(from);
  return { files: files.length, done: true, kept: checkouts(), conflicts: [] };
}

/** Removes `.apc/` once nothing but empty worktree folders is left; a worktree folder with anything in it stays. */
function clearEmpty(dir: string): void {
  if (!isDir(dir)) return;
  for (const e of fs.readdirSync(dir))
    if (CHECKOUTS.has(e) && isDir(path.join(dir, e)) && !fs.readdirSync(path.join(dir, e)).length)
      fs.rmdirSync(path.join(dir, e));
  if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
}

/**
 * The folder name a project's files are in now: `.agent`, or `.apc` while they could not be moved yet (that project keeps
 * working from there, reads and writes, until a move succeeds).
 */
export const ownDir = (root: string): string => (needsFolderMove(root) ? LEGACY_DIR : AGENT_DIR);

/** The folder a project's files are in now (see ownDir). */
export const projectDir = (root: string): string => path.join(root, ownDir(root));

/** What moving one project's folder did, as the owner is told it; nothing when there was nothing to move. */
export type FolderOutcome =
  | { state: "moved"; files: number; kept: string[] }
  | { state: "conflict"; conflicts: string[] }
  | { state: "failed"; error: string };

/** The move for one project, never throwing: what start and register run on every folder that still has `.apc/`. */
export function moveIfLegacy(root: string): FolderOutcome | undefined {
  if (!hasLegacyFolder(root)) return undefined;
  try {
    const r = moveLegacyFolder(root);
    if (r.conflicts.length) return { state: "conflict", conflicts: r.conflicts };
    return { state: "moved", files: r.files, kept: r.kept };
  } catch (err) {
    return { state: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
