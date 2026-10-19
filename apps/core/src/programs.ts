// Finding a program the owner installed, also for a core started without the login shell's PATH (launchd, systemd).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where package managers put programs (Homebrew on both Mac kinds, Linuxbrew, the usual system folders). */
const USUAL_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin"];

/** The usual folders plus the user's own (~/.local/bin, where install.sh and pipx put programs). */
const usualDirs = () => [...USUAL_DIRS, path.join(os.homedir(), ".local", "bin")];

/**
 * A PATH with the usual program folders it lacks added at its end, those that exist. A core the desktop app or launchd
 * started gets only the system's folders, so the shells agents run would miss what the owner installed.
 */
export function withUsualDirs(envPath: string, dirs = usualDirs(), platform = process.platform): string {
  if (platform === "win32") return envPath;
  const have = new Set(envPath.split(path.delimiter).filter(Boolean));
  const add = dirs.filter((d) => !have.has(d) && fs.existsSync(d));
  return [envPath, ...add].filter(Boolean).join(path.delimiter);
}

export function findProgram(name: string, envPath = process.env.PATH ?? ""): string | undefined {
  const names = process.platform === "win32" ? [`${name}.exe`, name] : [name];
  for (const dir of [...envPath.split(path.delimiter), ...usualDirs()].filter(Boolean))
    for (const n of names) {
      const file = path.join(dir, n);
      try {
        fs.accessSync(file, fs.constants.X_OK);
        return file;
      } catch {}
    }
  return undefined;
}

/** Whether a shell finds `name` on this PATH: on Windows with any of PATHEXT's extensions (.exe, .cmd, .bat…). */
export function onPath(name: string, envPath = process.env.PATH ?? ""): boolean {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  return envPath
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => exts.some((e) => fs.existsSync(path.join(dir, `${name}${e.toLowerCase()}`))));
}
