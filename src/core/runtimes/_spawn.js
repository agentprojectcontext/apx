// Shared spawn helper: runs a command, pipes a string to stdin, captures
// stdout/stderr, returns when the process exits or the timeout fires.
// cross-spawn, not node:child_process. On Windows npm installs agent CLIs as
// `.cmd` shims, and CreateProcess cannot execute a batch file: `spawn("codex")`
// fails with ENOENT even though the same command works in a terminal. That took
// out every npm-installed runtime here — codex, gemini-cli, qwen-code, opencode,
// aider, cursor-agent — and detect.js with them, since it probes through this
// helper too. cross-spawn resolves the shim via PATHEXT and re-routes it through
// cmd.exe with the escaping that needs. On POSIX it delegates straight to
// child_process.spawn, so nothing changes there.
import spawn from "cross-spawn";

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export function runProcess({ command, args = [], stdin = "", cwd, env, timeoutMs = DEFAULT_TIMEOUT }) {
  return new Promise((resolve) => {
    // `cwd` moves the child's working directory but NOT its inherited `PWD`,
    // which still names wherever the daemon was started. Tools that trust `PWD`
    // over getcwd() — opencode does — then resolve the wrong project: an a2a
    // coding session asked to write a file wrote it into the daemon's checkout
    // instead of the caller's. Keep the two in agreement.
    const childEnv = { ...process.env, ...(env || {}) };
    if (cwd) childEnv.PWD = cwd;

    const child = spawn(command, args, {
      cwd,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr, error: err.message, killed });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, killed });
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}
