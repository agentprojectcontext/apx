// Shared spawn helper: runs a command, pipes a string to stdin, captures
// stdout/stderr, returns when the process exits or the timeout fires.
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export function runProcess({ command, args = [], stdin = "", cwd, env, timeoutMs = DEFAULT_TIMEOUT }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...(env || {}) },
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
