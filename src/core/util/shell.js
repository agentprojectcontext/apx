// How to hand a command line to the platform's shell.
//
// WHY THIS IS A FILE AND NOT THREE INLINE CALLS. `spawn("sh", ["-lc", cmd])`
// was written out in three places — the run_shell tool and both of the routine
// runner's command hooks — and on Windows there is no `sh` unless the user
// happens to have Git Bash on PATH.
//
// What that produced was not an error message. `spawn` fails asynchronously
// with ENOENT, and an unlistened `error` event on a ChildProcess is thrown from
// inside the tick that would have gone on to emit `close` — so `close` never
// arrives and a caller waiting for it waits forever. The daemon logs the
// uncaught ENOENT and keeps running by design, so nothing anywhere says the
// turn is dead. Reported from the outside on 2026-09-18 as an action that
// "hangs waiting and will not let you interrupt or cancel". See the header of
// `run_shell`'s `run()` for the measurement, including the probe that hid it.
//
// npm installs this package on Windows without complaint (there is no `os`
// field in package.json) and `core/daemon/service.js` registers a Windows
// startup entry, so Windows is a platform this ships to. One home for the
// decision, and all three callers get the fix.
//
// THE WINDOWS FORM IS NODE'S OWN. `cmd.exe /d /s /c "…"` with
// `windowsVerbatimArguments` is what `child_process.exec` itself uses: /d skips
// AutoRun commands from the registry, /s plus the wrapping quotes give cmd its
// documented "strip the outer pair and take the rest literally" rule, and
// verbatim arguments stop Node re-quoting a string cmd has already been told
// how to read. Rolling our own quoting is how a command with an inner quote in
// it — the case actually reported — ends up mangled.
//
// LOGIN SHELL OR NOT is a real distinction, not a detail to normalise away. The
// tool wants a login shell (`-lc`) because the daemon can be started by launchd
// with a bare PATH that has no ffmpeg and no npx, and the user's profile is
// what puts them back. A routine's pre/post hook wants the plain `-c` it has
// always had. cmd.exe has no equivalent, so the flag is simply ignored there.

/**
 * The shell invocation for `command` on this platform.
 *
 * @param {string} command                 the command line, as written
 * @param {object} [opts]
 * @param {boolean} [opts.login=false]     use a login shell (POSIX only)
 * @param {string} [opts.platform]         override, for tests
 * @param {object} [opts.env]              override, for tests
 * @returns {{file: string, args: string[], options: object}}
 *          spread `options` into the spawn options — it is empty off Windows.
 */
export function shellCommand(command, { login = false, platform = process.platform, env = process.env } = {}) {
  const line = String(command ?? "");
  if (platform === "win32") {
    return {
      file: env?.ComSpec || env?.comspec || "cmd.exe",
      args: ["/d", "/s", "/c", `"${line}"`],
      options: { windowsVerbatimArguments: true },
    };
  }
  return {
    file: "sh",
    args: [login ? "-lc" : "-c", line],
    options: {},
  };
}

/** How long a killed process gets to die politely before SIGKILL.
 *
 *  Shared by every caller that kills one, because the failure it prevents is
 *  the same everywhere: SIGTERM is a REQUEST, and a child that ignores it (or
 *  whose orphaned grandchild holds the pipes open) leaves a `close` that never
 *  arrives and a promise that never settles. The escalation is what turns a
 *  timeout into an actual ceiling. */
export const KILL_GRACE_MS = 5000;

/**
 * Kill a child, and mean it.
 *
 * Signals the process GROUP when the child was spawned detached, so a shell
 * that launched ffmpeg takes ffmpeg with it — killing `sh` alone leaves the
 * real work running while every panel says it stopped.
 *
 * @param {import("node:child_process").ChildProcess} child
 * @param {{group?: boolean, graceMs?: number}} [opts]
 * @returns {() => void} cancels the pending SIGKILL — call it once the child is
 *          known to be gone, so a finished process cannot leave a live timer
 *          behind holding a reference to it.
 */
export function killChild(child, { group = false, graceMs = KILL_GRACE_MS } = {}) {
  const signal = (sig) => {
    try {
      if (group && child.pid) process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      // Already gone, or never started. Either way there is nothing to kill.
    }
  };
  signal("SIGTERM");
  const timer = setTimeout(() => signal("SIGKILL"), graceMs);
  timer.unref?.();
  return () => clearTimeout(timer);
}
