// Whether a path stays inside a folder. `isInside` compares paths as written (for paths already resolved);
// `insideReal` resolves symlinks first, so a link inside the folder cannot point the check somewhere else.
import fs from "node:fs";
import path from "node:path";

export function isInside(root: string, p: string): boolean {
  const r = path.resolve(root);
  const target = path.resolve(r, p);
  return target === r || target.startsWith(`${r}${path.sep}`);
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
