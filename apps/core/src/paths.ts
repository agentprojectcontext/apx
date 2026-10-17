// Whether a path stays inside a folder. `isInside` compares paths as written (for paths already resolved);
// `insideReal` resolves symlinks first, so a link inside the folder cannot point the check somewhere else.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** A path under the user's home as "~/…", the way the panel shows it; any other path as it is. */
export function tildeHome(p: string, home = os.homedir()): string {
  return p === home || p.startsWith(`${home}${path.sep}`) ? `~${p.slice(home.length)}` : p;
}

/** "~/…" back to the user's home; any other path as it is. */
export function expandHome(p: string, home = os.homedir()): string {
  return /^~(?=$|[/\\])/.test(p) ? path.join(home, p.slice(1)) : p;
}

export function isInside(root: string, p: string): boolean {
  const r = path.resolve(root);
  const target = path.resolve(r, p);
  return target === r || target.startsWith(r.endsWith(path.sep) ? r : `${r}${path.sep}`);
}

/** The real location of a path that may not exist yet: its nearest existing ancestor resolved, the rest appended. */
export function real(p: string): string {
  let cur = p;
  const rest: string[] = [];
  for (let i = 0; i < 64; i++) {
    try {
      return path.join(fs.realpathSync(cur), ...rest.reverse());
    } catch {
      rest.push(path.basename(cur));
      const up = path.dirname(cur);
      if (up === cur) return p;
      cur = up;
    }
  }
  return p;
}

/** Whether `p` (relative to `base`) is inside `base` once links are resolved. */
export function insideReal(base: string, p: string): boolean {
  return isInside(real(base), real(path.resolve(base, p)));
}

/**
 * Writes a file atomically: a fresh temp file beside it, created exclusively (an existing path or a planted symlink
 * makes it fail instead of being followed), then renamed over the target. The folder is checked again right before
 * the rename, so swapping it for a link in between is refused too.
 */
export function writeAtomic(file: string, text: string, mode?: number): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const before = fs.lstatSync(dir);
  const tmp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  fs.writeFileSync(tmp, text, { flag: "wx", ...(mode !== undefined ? { mode } : {}) });
  try {
    const now = fs.lstatSync(dir);
    if (now.isSymbolicLink() || now.ino !== before.ino)
      throw new Error(`refusing to write: ${dir} changed while writing`);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
