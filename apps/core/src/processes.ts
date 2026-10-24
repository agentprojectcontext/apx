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

/** How long a stop waits for the tree to be gone after its last signal; past it, the caller goes on. */
const STOP_WAIT_MS = 5000;

const exists = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Whether `gone()` came true within `ms`. */
async function until(gone: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!gone()) {
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, 25).unref());
  }
  return true;
}

/**
 * Stops a process and everything it started, and settles once it is gone (or after STOP_WAIT_MS), so a caller can
 * remove the folder it ran in. Unix: TERM to its group, KILL after `graceMs` (0: KILL now) if `alive` still says so.
 * Windows has no TERM a console program obeys: the tree is killed at once.
 */
export async function stopTree(
  pid: number,
  o: { graceMs?: number; alive?: () => boolean | Promise<boolean> } = {},
): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve) =>
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve()),
    );
    await until(() => !exists(pid), STOP_WAIT_MS);
    return;
  }
  const group = () => exists(-pid);
  const grace = o.graceMs ?? 3000;
  try {
    process.kill(-pid, grace === 0 ? "SIGKILL" : "SIGTERM");
  } catch {}
  if (grace > 0 && !(await until(() => !group(), grace))) {
    try {
      if (o.alive && !(await o.alive())) return;
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
  await until(() => !group(), STOP_WAIT_MS);
}

/**
 * What the system says of a process: `running` with when it started (with the pid, it says the process is still the
 * one APX started), `gone`, or `unknown` when the probe itself failed or timed out (a cold PowerShell can take
 * seconds): never read as gone.
 */
export type ProcessProbe = { state: "running"; start: string } | { state: "gone" } | { state: "unknown"; why: string };

/** Runs the probe program; the system's own by default, a stand-in in tests. Same callback as execFile's. */
export type ProbeRun = (
  file: string,
  args: string[],
  timeoutMs: number,
  done: (err: (Error & { code?: number | string | null; killed?: boolean }) | null, out: string) => void,
) => void;

const systemProbe: ProbeRun = (file, args, timeoutMs, done) =>
  execFile(file, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true }, (err, out) => done(err, out));

export function probeProcess(pid: number, timeoutMs = 10_000, run: ProbeRun = systemProbe): Promise<ProcessProbe> {
  const [file, args] =
    process.platform === "win32"
      ? [
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            // Exit 3 only when there is no such process, so any other failure stays unknown.
            `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (-not $p) { exit 3 }; $p.StartTime.ToUniversalTime().ToString('o')`,
          ],
        ]
      : ["ps", ["-p", String(pid), "-o", "lstart="]];
  const noSuch = process.platform === "win32" ? 3 : 1;
  return new Promise((resolve) =>
    run(file, args as string[], timeoutMs, (err, out) => {
      const start = out?.trim();
      if (!err) resolve(start ? { state: "running", start } : { state: "gone" });
      else if (err.code === noSuch && !err.killed) resolve({ state: "gone" });
      else resolve({ state: "unknown", why: err.killed ? `no answer in ${timeoutMs} ms` : err.message });
    }),
  );
}

/**
 * When the process started, or undefined once the system says it is gone. A probe that cannot tell is asked again,
 * with more time; still unknown, it throws rather than answer "gone".
 */
export async function processStart(
  pid: number,
  o: { attempts?: number; timeoutMs?: number; run?: ProbeRun } = {},
): Promise<string | undefined> {
  let why = "";
  for (let i = 0; i < (o.attempts ?? 3); i++) {
    const p = await probeProcess(pid, (o.timeoutMs ?? 10_000) * (i + 1), o.run);
    if (p.state === "running") return p.start;
    if (p.state === "gone") return undefined;
    why = p.why;
  }
  throw new Error(`cannot tell whether process ${pid} runs: ${why}`);
}
