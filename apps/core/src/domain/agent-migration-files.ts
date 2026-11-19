import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { badRequest } from "../errors.ts";
import { isInside, real, realpath, samePath } from "../paths.ts";

export type MigrationFile = { from: string; to: string; digest: string; bytes: number; mode: number };
export type MigrationFiles = {
  source: string;
  destination: string;
  files: MigrationFile[];
  bytes: number;
  revision: string;
};

export function readMigrationFile(file: string, limit = 256 * 1024 * 1024): Buffer {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(limit))
      throw badRequest("Only bounded ordinary work files can be moved");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!read) throw badRequest("A work file changed while preparing the move");
      offset += read;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const current = fs.lstatSync(file, { bigint: true });
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      current.isSymbolicLink() ||
      before.ino !== current.ino ||
      before.dev !== current.dev
    )
      throw badRequest("A work file changed while preparing the move");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
const digest = (file: string) => createHash("sha256").update(readMigrationFile(file)).digest("hex");
const forbidden = (name: string) =>
  [".git", ".apc", "node_modules"].includes(name) || /^\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i.test(name);

/** Every existing component is checked, not only the final file's real location. */
export function migrationFilePath(root: string, relative: string): string {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some((part) => !part || part === "." || part === "..")
  )
    throw badRequest("Choose a relative file or folder inside the project");
  const result = path.resolve(root, ...relative.split(/[\\/]/));
  if (!isInside(root, result) || samePath(root, result)) throw badRequest("The selected path leaves the project");
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink())
    throw badRequest("Linked project folders cannot be moved");
  let current = root;
  for (const part of relative.split(/[\\/]/)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw badRequest("Linked files and folders cannot be moved");
    } catch (err) {
      if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) throw err;
    }
  }
  return result;
}

/** Explicit selections only; project-wide context, credentials and dependencies never follow an agent implicitly. */
export function inventoryMigrationFiles(
  sourceRoot: string,
  destinationRoot: string,
  selections: string[],
): MigrationFiles {
  const source = realpath(sourceRoot);
  const destination = real(destinationRoot);
  if (isInside(source, destination) || isInside(destination, source))
    throw badRequest("Choose separate project folders");
  const files: MigrationFile[] = [];
  const seen = new Map<string, string[]>();
  let bytes = 0;
  const visit = (relative: string): void => {
    if (relative.split(/[\\/]/).some(forbidden))
      throw badRequest("Project definitions, credentials and dependencies are not moved as work files");
    const from = migrationFilePath(source, relative);
    const to = migrationFilePath(destination, relative);
    if (fs.existsSync(to)) throw badRequest("A selected work file or folder already exists in the destination");
    const stat = fs.lstatSync(from);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(from).sort()) visit(path.join(relative, entry));
      return;
    }
    if (!stat.isFile()) throw badRequest("Only ordinary work files can be moved");
    const key = path.relative(source, from).split(path.sep).join("/");
    const bucket = key.toLowerCase();
    const candidates = seen.get(bucket) ?? [];
    if (candidates.some((file) => samePath(file, from))) return;
    seen.set(bucket, [...candidates, from]);
    bytes += stat.size;
    if (files.length >= 10_000 || bytes > 256 * 1024 * 1024)
      throw badRequest("Move at most 10,000 work files and 256 MB at a time");
    files.push({ from: key, to: key, digest: digest(from), bytes: stat.size, mode: stat.mode & 0o777 });
  };
  for (const selection of [...selections].sort()) visit(selection);
  const revision = createHash("sha256").update(JSON.stringify({ source, destination, files })).digest("hex");
  return { source, destination, files, bytes, revision };
}
