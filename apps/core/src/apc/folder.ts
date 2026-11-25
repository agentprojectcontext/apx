// The folder a project keeps APX's files in (`.agent/`), and the one-time move from `.apc/`, the name earlier
// versions used. `.apc/` is never read for definitions: it is only found, to offer the move. See DECISIONS.md#d-273
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

/**
 * The project's files are only in `.apc/`: its index stays as it was and the move is offered. Once `.agent/` exists,
 * `.apc/` is not read at all; what is left there goes with `apx doctor --fix`.
 */
export const needsFolderMove = (root: string): boolean =>
  !fs.existsSync(path.join(root, AGENT_DIR)) && legacyEntries(root).length > 0;

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
 * removes them from `.apc/` (`keep` leaves them, for a v1 that still reads them). With no `.agent/` yet the copy is
 * made aside and renamed in at once, so a reindex never sees half of it. Safe to run again: equal files count as
 * moved, and a file `.agent/` has with other content stops before anything is removed. Worktrees stay where they are.
 */
export function moveLegacyFolder(root: string, o: { keep?: boolean } = {}): FolderMove {
  const abs = path.resolve(root);
  const from = path.join(abs, LEGACY_DIR);
  const to = path.join(abs, AGENT_DIR);
  for (const [p, name] of [
    [from, LEGACY_DIR],
    [to, AGENT_DIR],
  ] as const)
    if (isLink(p)) throw new Error(`${name} is a link: nothing moved`);
  const entries = legacyEntries(abs);
  const checkouts = () => (isDir(from) ? fs.readdirSync(from).filter((e) => CHECKOUTS.has(e)) : []);
  if (!entries.length) {
    if (!o.keep) clearEmpty(from);
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
  if (o.keep) return { files: files.length, done: false, kept: checkouts(), conflicts: [] };
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
 * `.agent/` of a project, for a write. Refused while the project's files are only in `.apc/`: starting `.agent/` there
 * would leave them unread instead of moving them.
 */
export function agentDirFor(root: string): string {
  if (needsFolderMove(root))
    throw new Error(
      `this project's agents and settings are still in ${LEGACY_DIR}/: move them to ${AGENT_DIR}/ first (Move on the project's page, or apx doctor --fix)`,
    );
  return path.join(root, AGENT_DIR);
}
