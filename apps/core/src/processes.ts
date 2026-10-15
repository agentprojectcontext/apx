// Commands APX runs for agents and routines, on every system: which shell runs them and how a whole process tree is
// stopped. Unix runs sh in a process group of its own; Windows runs Git Bash when it is installed, else PowerShell.
import { type ChildProcess, execFile, type StdioOptions, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type CommandShell = {
  file: string;
  args: (command: string) => string[];
  /** What the shell tool tells the model it writes. */
  name: "sh" | "PowerShell";
};

type Env = Record<string, string | undefined>;
type Exists = (file: string) => boolean;

/** Windows' environment names ignore case; a plain object does not. */
const envOf = (env: Env, key: string) => env[Object.keys(env).find((k) => k.toUpperCase() === key) ?? key];

const win = path.win32;

/** Git for Windows' bash, from the git on the PATH or its usual folders. Never System32's bash.exe: that is WSL. */
export function findGitBash(env: Env = process.env, exists: Exists = fs.existsSync): string | undefined {
  const roots: string[] = [];
  for (const dir of (envOf(env, "PATH") ?? "").split(";").filter(Boolean)) {
    if (!exists(win.join(dir, "git.exe"))) continue;
    // <root>\cmd\git.exe, <root>\bin\git.exe or <root>\mingw64\bin\git.exe
    const up = win.dirname(dir);
    roots.push(/^mingw(32|64)$/i.test(win.basename(up)) ? win.dirname(up) : up);
  }
  for (const base of ["ProgramW6432", "PROGRAMFILES", "PROGRAMFILES(X86)"]) {
    const at = envOf(env, base);
    if (at) roots.push(win.join(at, "Git"));
  }
  const local = envOf(env, "LOCALAPPDATA");
  if (local) roots.push(win.join(local, "Programs", "Git"));
  const user = envOf(env, "USERPROFILE");
  if (user) roots.push(win.join(user, "scoop", "apps", "git", "current"));
  return roots.map((r) => win.join(r, "bin", "bash.exe")).find((f) => exists(f));
}

function findPowerShell(env: Env, exists: Exists): string {
  for (const dir of (envOf(env, "PATH") ?? "").split(";").filter(Boolean)) {
    const pwsh = win.join(dir, "pwsh.exe");
    if (exists(pwsh)) return pwsh;
  }
  const builtIn = win.join(
    envOf(env, "SYSTEMROOT") ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  return exists(builtIn) ? builtIn : "powershell.exe";
}

/** The shell agents' and routines' commands run in on this system. */
export function commandShell(
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
  exists: Exists = fs.existsSync,
): CommandShell {
  if (platform !== "win32") return { file: "/bin/sh", args: (c) => ["-c", c], name: "sh" };
  const bash = findGitBash(env, exists);
  if (bash) return { file: bash, args: (c) => ["-c", c], name: "sh" };
  // Encoded, so quotes in the command survive Windows' command-line parsing.
  return {
    file: findPowerShell(env, exists),
    args: (c) => [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(c, "utf16le").toString("base64"),
    ],
    name: "PowerShell",
  };
}

/** Starts `command` in this system's shell; on Unix in its own process group, so stopTree also stops what it starts. */
export function spawnCommand(
  command: string,
  o: { cwd: string; env: Record<string, string>; stdio: StdioOptions },
): ChildProcess {
  const sh = commandShell();
  return spawn(sh.file, sh.args(command), {
    cwd: o.cwd,
    env: o.env,
    stdio: o.stdio,
    // On Windows a detached child gets a console window of its own; taskkill /T reaches its tree anyway.
    detached: process.platform !== "win32",
    windowsHide: true,
  });
}

/**
 * Stops a process and everything it started. Unix: TERM to its group, KILL after `graceMs` (0: KILL now) if `alive`
 * still says so. Windows has no TERM a console program obeys: the tree is killed at once.
 */
export function stopTree(pid: number, o: { graceMs?: number; alive?: () => boolean | Promise<boolean> } = {}): void {
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  const grace = o.graceMs ?? 3000;
  try {
    process.kill(-pid, grace === 0 ? "SIGKILL" : "SIGTERM");
  } catch {}
  if (grace === 0) return;
  setTimeout(async () => {
    try {
      if (!o.alive || (await o.alive())) process.kill(-pid, "SIGKILL");
    } catch {}
  }, grace).unref();
}

/** When the process started, as the system says it: with the pid, it says the process is still the one APX started. */
export function processStart(pid: number): Promise<string | undefined> {
  const [file, args] =
    process.platform === "win32"
      ? [
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`,
          ],
        ]
      : ["ps", ["-p", String(pid), "-o", "lstart="]];
  return new Promise((resolve) =>
    execFile(file, args, { encoding: "utf8", timeout: 10_000, windowsHide: true }, (err, out) =>
      resolve(err ? undefined : out.trim() || undefined),
    ),
  );
}
