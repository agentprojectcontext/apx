// The Windows installers the updater leaves in the temp folder: each update downloads one (~130 MB) and runs it from
// there, so the ones already put in are removed instead of piling up.
import fs from "node:fs";
import path from "node:path";

const INSTALLER = /^APX-\d+\.\d+\.\d+(?:-[\w.]+)?-win-(?:x64|arm64)\.exe$/;

/** Of the files in a folder, the APX installers to remove: all but `keep`. */
export function oldInstallers(names: string[], keep?: string): string[] {
  return names.filter((n) => INSTALLER.test(n) && n !== keep);
}

/** Removes the APX installers in `dir` but `keep`; one still open (running) is left for the next time. */
export function removeOldInstallers(dir: string, keep?: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const n of oldInstallers(names, keep)) {
    try {
      fs.rmSync(path.join(dir, n), { force: true });
    } catch {
      // Windows keeps a running file: it goes the next time.
    }
  }
}
