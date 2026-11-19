import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { badRequest } from "../errors.ts";
import { real, samePath, writeAtomic } from "../paths.ts";
import { migrationFilePath, readMigrationFile } from "./agent-migration-files.ts";

export type FileChange = {
  root: "source" | "destination";
  relative: string;
  before: string | null;
  after: string | null;
  mode: number;
};
export type FileJournal = {
  id: string;
  source: string;
  destination: string;
  changes: FileChange[];
  created_dirs: Array<{ root: "source" | "destination"; relative: string }>;
  state: "prepared" | "applied" | "committed" | "recovering" | "recovered";
};
const hash = (file: string) => createHash("sha256").update(readMigrationFile(file)).digest("hex");
const journalFile = (folder: string) => path.join(folder, "journal.json");
const save = (folder: string, journal: FileJournal) => writeAtomic(journalFile(folder), JSON.stringify(journal), 0o600);
const backup = (folder: string, name: string) => migrationFilePath(folder, name);
const current = (file: string) => (fs.existsSync(file) ? hash(file) : null);

/** Staged bytes live under the private core home, never in either project's context or version control. */
export function prepareFileJournal(folder: string, id: string, source: string, destination: string) {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(folder).isSymbolicLink()) throw badRequest("The recovery folder must not be a link");
  if (fs.existsSync(journalFile(folder))) throw badRequest("This move already has a recovery journal");
  const journal: FileJournal = {
    id,
    source: real(source),
    destination: real(destination),
    changes: [],
    created_dirs: [],
    state: "prepared",
  };
  const stage = (bytes: Uint8Array): string => {
    const name = `${randomBytes(12).toString("hex")}.bin`;
    fs.writeFileSync(backup(folder, name), bytes, { flag: "wx", mode: 0o600 });
    return name;
  };
  const change = (root: FileChange["root"], relative: string, bytes: Uint8Array | null, mode = 0o600) => {
    const absolute = migrationFilePath(root === "source" ? source : destination, relative);
    if (
      journal.changes.some(
        (c) =>
          c.root === root &&
          samePath(migrationFilePath(root === "source" ? source : destination, c.relative), absolute),
      )
    )
      throw badRequest("A selected file would be changed twice");
    const project = root === "source" ? source : destination;
    for (let parent = path.dirname(relative); parent !== "."; parent = path.dirname(parent)) {
      const dir = migrationFilePath(project, parent);
      if (
        !fs.existsSync(dir) &&
        !journal.created_dirs.some((d) => d.root === root && samePath(migrationFilePath(project, d.relative), dir))
      )
        journal.created_dirs.push({ root, relative: parent });
    }
    const stat = fs.existsSync(absolute) ? fs.lstatSync(absolute) : undefined;
    if (stat && !stat.isFile()) throw badRequest("A selected destination is not an ordinary file");
    const before = stat ? stage(readMigrationFile(absolute)) : null;
    const after = bytes ? stage(bytes) : null;
    journal.changes.push({ root, relative, before, after, mode: stat ? stat.mode & 0o777 : mode });
  };
  return { journal, change, persist: () => save(folder, journal) };
}

function journalAccess(folder: string, journal: FileJournal, reverse: boolean) {
  if (!samePath(real(journal.source), journal.source) || !samePath(real(journal.destination), journal.destination))
    throw badRequest("A project folder changed since the move was prepared");
  const expected = (c: FileChange) => (reverse ? c.after : c.before);
  const desired = (c: FileChange) => (reverse ? c.before : c.after);
  const target = (c: FileChange) =>
    migrationFilePath(c.root === "source" ? journal.source : journal.destination, c.relative);
  const digest = (name: string | null) => (name ? hash(backup(folder, name)) : null);
  // A partial prior attempt may already have installed the desired bytes; an unrelated edit never gets replaced.
  const check = (c: FileChange) => {
    const present = current(target(c));
    if (present !== digest(expected(c)) && present !== digest(desired(c)))
      throw badRequest("A work file changed; keep the recovery backup and resolve the conflict");
  };
  return { check, target, desired, digest };
}

export function checkFileJournal(folder: string, journal: FileJournal, reverse = false) {
  const { check } = journalAccess(folder, journal, reverse);
  for (const change of journal.changes) check(change);
}

/** A crash is recoverable after each individual rename or unlink, including before its receipt was saved. */
export function applyFileJournal(folder: string, journal: FileJournal, reverse = false) {
  const { check, target, desired, digest } = journalAccess(folder, journal, reverse);
  checkFileJournal(folder, journal, reverse);
  journal.state = reverse ? "recovering" : "prepared";
  save(folder, journal);
  const changes = reverse ? [...journal.changes].reverse() : journal.changes;
  for (const change of changes) {
    check(change);
    const file = target(change);
    const wanted = desired(change);
    if (current(file) === digest(wanted)) continue;
    if (!wanted) {
      fs.unlinkSync(file);
      continue;
    }
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const before = fs.lstatSync(dir);
    const tmp = path.join(dir, `.migration-${randomBytes(12).toString("hex")}.tmp`);
    fs.copyFileSync(backup(folder, wanted), tmp, fs.constants.COPYFILE_EXCL);
    try {
      fs.chmodSync(tmp, change.mode);
      check(change);
      const after = fs.lstatSync(dir);
      if (after.isSymbolicLink() || before.ino !== after.ino || before.dev !== after.dev)
        throw badRequest("The work folder changed during the move");
      fs.renameSync(tmp, target(change));
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  if (reverse) removeCreatedDirectories(journal);
  journal.state = reverse ? "recovered" : "applied";
  save(folder, journal);
}

function removeCreatedDirectories(journal: FileJournal) {
  const depth = (relative: string) => relative.split(/[\\/]/).length;
  for (const directory of [...journal.created_dirs].sort((a, b) => depth(b.relative) - depth(a.relative))) {
    const root = directory.root === "source" ? journal.source : journal.destination;
    const dir = migrationFilePath(root, directory.relative);
    try {
      // Remove only empty folders this journal introduced; never unrelated work or pre-existing folders.
      fs.rmdirSync(dir);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(String(error.code)))
      )
        throw error;
    }
  }
}

export function commitFileJournal(folder: string, journal: FileJournal) {
  journal.state = "committed";
  save(folder, journal);
}
