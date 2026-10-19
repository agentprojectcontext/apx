import fs from "node:fs";
import path from "node:path";

function contained(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** A sandboxed stand-in for system trash used only by the e2e core. */
export function fakeDesktopTrash(rootPath: string, record: string) {
  return async (abs: string): Promise<void> => {
    const root = fs.realpathSync(rootPath);
    const target = fs.realpathSync(abs);
    if (!contained(root, target)) throw new Error("refusing to trash a path outside the e2e project");

    const fakeTrash = `${record}.trash`;
    fs.mkdirSync(fakeTrash, { recursive: true });
    const destination = path.join(fakeTrash, `${path.basename(abs)}-${Date.now()}`);
    fs.appendFileSync(record, `${JSON.stringify(abs)}\n`);
    fs.renameSync(abs, destination);
  };
}
