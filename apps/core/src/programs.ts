// Finding a program the owner installed, also for a core started without the login shell's PATH (launchd, systemd).
import fs from "node:fs";
import path from "node:path";

/** Where package managers put programs (Homebrew on both Mac kinds, Linuxbrew, the usual system folders). */
const USUAL_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin"];

export function findProgram(name: string, envPath = process.env.PATH ?? ""): string | undefined {
  const names = process.platform === "win32" ? [`${name}.exe`, name] : [name];
  for (const dir of [...envPath.split(path.delimiter), ...USUAL_DIRS].filter(Boolean))
    for (const n of names) {
      const file = path.join(dir, n);
      try {
        fs.accessSync(file, fs.constants.X_OK);
        return file;
      } catch {}
    }
  return undefined;
}
